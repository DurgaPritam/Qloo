import "server-only";

import { bestLineup, MAX_POOL, type LineupCandidate, type LineupPick } from "@/lib/engine/lineup";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { scorePartners } from "@/lib/engine/partners";
import type { Category, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooCallOptions } from "@/lib/qloo/client";
import type { QlooSource } from "@/lib/qloo/source";
import { kvGet, kvSet } from "@/lib/server/kv";

import { describeFailure, resolveEntity, view, type CallView, type Choice } from "./shared";

/**
 * The Lineup optimizer's candidates: acts the headliner's fans over-index on, in the headliner's
 * own category (comedians for a comedian) and one other, each with its Qloo affinity as fit. Kept
 * server-side for a day, so a saved lineup's fits are Qloo's, never the browser's.
 */
export interface PoolAct {
  id: string;
  name: string;
  category: string;
  /** 0–100: Qloo affinity among the headliner's fans. */
  fit: number;
}

export interface LineupDraft {
  draftId: string;
  headliner: Pick<Entity, "id" | "name" | "category">;
  pool: PoolAct[];
  planId: string | null;
  city: string | null;
  calls: CallView[];
  mock: boolean;
}

export type PoolResult = { status: "choose"; question: string; choices: Choice[] } | { status: "none" } | ({ status: "done" } & LineupDraft);

const TTL = 24 * 60 * 60;
const key = (id: string) => `takeover:lineup-opt:draft:v1:${id}`;
const other = (c: Category): Category => (c === "person" ? "artist" : "person");
const label = (c: Category) => {
  const l = CATEGORY_LABEL[c] ?? c;
  return l.charAt(0).toUpperCase() + l.slice(1);
};

export async function lineupPool(
  headliner: { entity: Pick<Entity, "id" | "name" | "category"> } | { query: string; entityId?: string },
  ctx: { planId: string | null; city: string | null },
  source: QlooSource,
  opts: QlooCallOptions,
): Promise<PoolResult> {
  const calls: CallView[] = [];
  let h: Pick<Entity, "id" | "name" | "category">;
  if ("entity" in headliner) h = headliner.entity;
  else {
    const r = await resolveEntity(headliner.query, FANBASE_CATEGORIES, headliner.entityId, source, opts, calls);
    if (r.kind === "none") return { status: "none" };
    if (r.kind === "choose") return { status: "choose", question: r.question, choices: r.choices };
    h = r.entity;
  }
  const list = async (category: Category, count: number) => {
    try {
      const res = await source.candidates([h.id], category, undefined, opts);
      calls.push(view(res.meta));
      return scorePartners(res.data, { count, minCategories: 1, excludeIds: [h.id] }).picks.map((p) => ({
        id: p.entity.id,
        name: p.entity.name,
        category: label(p.entity.category),
        fit: Math.round(p.entity.affinity * 100),
      }));
    } catch (err) {
      console.warn("[tools/lineup-pool] candidates failed:", describeFailure(err));
      return [];
    }
  };
  const [same, rest] = await Promise.all([list(h.category, 10), list(other(h.category), 6)]);
  const seen = new Set([h.name.toLowerCase()]);
  const pool = [...same, ...rest]
    .filter((a) => Number.isFinite(a.fit) && !seen.has(a.name.toLowerCase()) && seen.add(a.name.toLowerCase()))
    .sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name))
    .slice(0, MAX_POOL);
  const draft: LineupDraft = { draftId: crypto.randomUUID(), headliner: { id: h.id, name: h.name, category: h.category }, pool, planId: ctx.planId, city: ctx.city, calls, mock: source.mock };
  await kvSet(key(draft.draftId), draft, TTL);
  return { status: "done", ...draft };
}

export async function lineupDraft(id: string): Promise<LineupDraft | null> {
  return /^[0-9a-f-]{36}$/.test(id) ? kvGet<LineupDraft>(key(id)) : null;
}

export type Tier = "A" | "B" | "C";

/** The user's fees and choices, applied to the draft's own Qloo fits: the lineup the engine picks. */
export function lineupFromDraft(
  draft: LineupDraft,
  input: { budget: number; slots: number; fees: Record<Tier, number>; tiers: Record<string, Tier>; headlinerTier: Tier },
): LineupPick | null {
  const fee = (t: Tier | undefined) => input.fees[t ?? "B"] ?? 0;
  const head: LineupCandidate = { id: draft.headliner.id, name: draft.headliner.name, fit: null, fee: fee(input.headlinerTier) };
  return bestLineup(
    head,
    draft.pool.map((a) => ({ id: a.id, name: a.name, fit: a.fit, fee: fee(input.tiers[a.id]) })),
    { slots: input.slots, budget: input.budget },
  );
}
