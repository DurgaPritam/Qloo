import "server-only";

import { crowdFit as engineCrowdFit, mutual, type AffinityMatrix, type Tier } from "@/lib/engine/lineup";
import { ENGINE_CONFIG } from "@/lib/engine/config";
import type { Category, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { kvGet, kvSet } from "@/lib/server/kv";

import { describeFailure, resolveEntity, view, type CallView, type Choice } from "./shared";

/**
 * Lineup optimizer, server side: names → Qloo entities, then the pool's pairwise Qloo affinities
 * (each act's fans asked about the others, one call per act and category), kept for a day as a
 * draft. The optimizer runs in the browser on that matrix (lib/engine/lineup.ts); a saved poster is
 * re-scored here from the draft, never from numbers the browser sends.
 */
export interface LineupAct {
  id: string;
  name: string;
  category: Category;
  /** On a poster: the act's mean mutual Qloo affinity with the rest of the bill, 0–1. */
  affinity: number;
  score: number;
}

export interface SavedLineup {
  id: string;
  title: string;
  headliner: Pick<Entity, "id" | "name" | "category">;
  acts: LineupAct[];
  host: LineupAct | null;
  city: { name: string; country: string } | null;
  venue: string | null;
  /** The engine's crowd fit of the whole bill, 0–100. */
  crowdFit: number;
  mock: boolean;
  createdAt: string;
}

export interface PoolEntity {
  id: string;
  name: string;
  category: Category;
}

export interface PoolDraft {
  draftId: string;
  acts: PoolEntity[];
  matrix: AffinityMatrix;
  calls: CallView[];
  mock: boolean;
}

export type ResolvedName = { name: string; status: "resolved"; entity: PoolEntity } | { name: string; status: "choose"; question: string; choices: Choice[] } | { name: string; status: "none" };

export const MAX_POOL = ENGINE_CONFIG.lineup.maxPool;
const DRAFT_TTL = 24 * 60 * 60;
const SAVED_TTL = 30 * 24 * 60 * 60;
const draftKey = (id: string) => `takeover:lineup:pool:v2:${id}`;
const savedKey = (id: string) => `takeover:lineup:v1:${id}`;

/** One Qloo search per name (none when the id is already known from a pick). */
export async function resolveActs(names: readonly { name: string; entityId?: string }[], source: QlooSource, opts: { runId: string }): Promise<ResolvedName[]> {
  const out: ResolvedName[] = [];
  for (const n of names.slice(0, MAX_POOL)) {
    const calls: CallView[] = [];
    try {
      const r = await resolveEntity(n.name, FANBASE_CATEGORIES, n.entityId, source, opts, calls);
      if (r.kind === "resolved") out.push({ name: n.name, status: "resolved", entity: { id: r.entity.id, name: r.entity.name, category: r.entity.category } });
      else if (r.kind === "choose") out.push({ name: n.name, status: "choose", question: r.question, choices: r.choices });
      else out.push({ name: n.name, status: "none" });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn("[tools/lineup] resolve failed:", describeFailure(err));
      out.push({ name: n.name, status: "none" });
    }
  }
  return out;
}

/** The pool's pairwise affinities: for each act, its fans asked about every other act, by category. */
export async function scorePool(acts: readonly PoolEntity[], source: QlooSource, opts: { runId: string }): Promise<PoolDraft> {
  const pool = [...new Map(acts.slice(0, MAX_POOL).map((a) => [a.id, a])).values()];
  const matrix: AffinityMatrix = {};
  const calls: CallView[] = [];
  for (const act of pool) {
    const others = pool.filter((o) => o.id !== act.id);
    const byCategory = new Map<Category, string[]>();
    for (const o of others) byCategory.set(o.category, [...(byCategory.get(o.category) ?? []), o.id]);
    matrix[act.id] = {};
    for (const [category, ids] of byCategory) {
      try {
        const res = await source.affinitiesOf([act.id], ids, category, opts);
        calls.push(view(res.meta));
        const found = new Map(res.data.map((c) => [c.id, c.affinity]));
        // Asked and not returned: Qloo has no affinity for it.
        for (const id of ids) matrix[act.id][id] = found.get(id) ?? null;
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        console.warn("[tools/lineup] affinities failed:", describeFailure(err));
      }
    }
  }
  const draft: PoolDraft = { draftId: crypto.randomUUID(), acts: pool, matrix, calls, mock: source.mock };
  await kvSet(draftKey(draft.draftId), draft, DRAFT_TTL);
  return draft;
}

export async function poolDraft(id: string): Promise<PoolDraft | null> {
  return /^[0-9a-f-]{36}$/.test(id) ? kvGet<PoolDraft>(draftKey(id)) : null;
}

const RANK: Record<Tier, number> = { A: 0, B: 1, C: 2 };

/**
 * A poster from the optimizer's bill: only acts from the draft, the headliner being the top-tier
 * act (then the best connected), every fit computed here from the draft's Qloo matrix.
 */
export async function savePoster(draftId: string, actIds: readonly string[], tiers: Record<string, Tier>, title: string): Promise<SavedLineup | { error: string }> {
  const draft = await poolDraft(draftId);
  if (!draft) return { error: "This pool has expired. Score it again." };
  const chosen = [...new Set(actIds)].map((id) => draft.acts.find((a) => a.id === id)).filter((a): a is PoolEntity => Boolean(a));
  if (chosen.length !== new Set(actIds).size || chosen.length < 2) return { error: "Pick at least two acts from the scored pool." };
  if (chosen.length > 6) return { error: "A poster fits up to six acts." };
  const ids = chosen.map((a) => a.id);
  const meanWith = (id: string) => {
    const others = ids.filter((x) => x !== id);
    return others.reduce((s, o) => s + (mutual(draft.matrix, id, o) ?? 0), 0) / others.length;
  };
  const ordered = [...chosen].sort((a, b) => RANK[tiers[a.id] ?? "C"] - RANK[tiers[b.id] ?? "C"] || meanWith(b.id) - meanWith(a.id) || a.id.localeCompare(b.id));
  const [head, ...rest] = ordered;
  const saved: SavedLineup = {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 40) || `${head.name} & Friends`,
    headliner: head,
    acts: rest.map((a) => ({ ...a, affinity: meanWith(a.id), score: meanWith(a.id) })),
    host: null,
    city: null,
    venue: null,
    crowdFit: Math.round(engineCrowdFit(ids, draft.matrix) * 100),
    mock: draft.mock,
    createdAt: new Date().toISOString(),
  };
  await kvSet(savedKey(saved.id), saved, SAVED_TTL);
  return saved;
}

export async function loadLineup(id: string): Promise<SavedLineup | null> {
  return /^[0-9a-f-]{36}$/.test(id) ? kvGet<SavedLineup>(savedKey(id)) : null;
}
