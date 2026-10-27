import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { formatFor } from "@/lib/engine/formats";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import { scorePartners } from "@/lib/engine/partners";
import { rankPlaces } from "@/lib/engine/places";
import type { Category, Entity } from "@/lib/engine/types";
import { cityQuery } from "@/lib/agent/tools";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooSource } from "@/lib/qloo/source";
import { kvGet, kvSet } from "@/lib/server/kv";

import { describeFailure, metroPool, resolveEntity, view, type CallView, type Choice } from "./shared";

export interface LineupAct {
  id: string;
  name: string;
  category: Category;
  /** Qloo affinity among the headliner's fans. */
  affinity: number;
  /** 0–1 partner score (relative affinity × gentle mainstream discount). */
  score: number;
}

export interface LineupDraft {
  draftId: string;
  headliner: Pick<Entity, "id" | "name" | "category">;
  acts: LineupAct[];
  hosts: LineupAct[];
  city: { name: string; country: string } | null;
  venue: string | null;
  calls: CallView[];
  mock: boolean;
}

export interface SavedLineup {
  id: string;
  title: string;
  headliner: LineupDraft["headliner"];
  acts: LineupAct[];
  host: LineupAct | null;
  city: LineupDraft["city"];
  venue: string | null;
  /** Mean affinity of the chosen acts and host among the headliner's fans, 0–100. */
  crowdFit: number;
  mock: boolean;
  createdAt: string;
}

export type LineupResult =
  | { status: "choose"; question: string; choices: Choice[]; mock: boolean }
  | { status: "none"; mock: boolean }
  | ({ status: "done" } & LineupDraft);

const DRAFT_TTL = 24 * 60 * 60;
const SAVED_TTL = 30 * 24 * 60 * 60;
const draftKey = (id: string) => `takeover:lineup:draft:v1:${id}`;
const savedKey = (id: string) => `takeover:lineup:v1:${id}`;

const toAct = (p: { entity: { id: string; name: string; category: Category; affinity: number }; score: number }): LineupAct => ({
  id: p.entity.id,
  name: p.entity.name,
  category: p.entity.category,
  affinity: p.entity.affinity,
  score: p.score,
});

/** Mean Qloo affinity, as the 0–100 "crowd fit" on the poster. */
export function crowdFit(acts: readonly Pick<LineupAct, "affinity">[]): number {
  const known = acts.map((a) => a.affinity).filter((a) => Number.isFinite(a));
  return known.length ? Math.round((known.reduce((s, a) => s + a, 0) / known.length) * 100) : 0;
}

/**
 * Lineup builder: support acts (artists) and a host (people) the headliner's fans over-index on,
 * the headliner's strongest city in its home market and a venue there. Five Qloo calls; the
 * suggestions are kept for a day so a saved poster can only use them.
 */
export async function suggestLineup(query: string, entityId: string | undefined, source: QlooSource, opts: { runId: string }): Promise<LineupResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, FANBASE_CATEGORIES, entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, mock: source.mock };
  const h = resolved.entity;
  const format = formatFor(h);
  const market = marketFor(h.homeCountry) ?? marketFor(DEFAULT_MARKET)!;

  const list = async (category: Category, count: number) => {
    try {
      const res = await source.candidates([h.id], category, undefined, opts);
      calls.push(view(res.meta));
      return scorePartners(res.data, { count, minCategories: 1, excludeIds: [h.id] }).picks.filter((p) => p.entity.name !== h.name).map(toAct);
    } catch (err) {
      console.warn("[tools/lineup] candidates failed:", describeFailure(err));
      return [];
    }
  };
  const [acts, hosts, heat] = await Promise.all([
    list("artist", 8),
    list("person", 4),
    source.heatmap([h.id], market.name, opts).then(
      (r) => (calls.push(view(r.meta)), r.data),
      () => null,
    ),
  ]);

  const pool = metroPool().filter((c) => c.country === market.code);
  const top = heat ? scoreCities(heat, heat, pool, format.minPopulation).find((c) => c.combined > 0) : undefined;
  let venue: string | null = null;
  if (top) {
    try {
      const res = await source.places([h.id], cityQuery(top.city), format.venueTags, opts);
      calls.push(view(res.meta));
      venue = rankPlaces(res.data, format.venueTags, 1, format.avoidTags).picks[0]?.place.name ?? null;
    } catch (err) {
      console.warn("[tools/lineup] venue failed:", describeFailure(err));
    }
  }

  // Qloo lists some musicians as people too; a support act is not also offered as host.
  const actNames = new Set(acts.map((a) => a.name.toLowerCase()));
  const draft: LineupDraft = {
    draftId: crypto.randomUUID(),
    headliner: { id: h.id, name: h.name, category: h.category },
    acts,
    hosts: hosts.filter((x) => !actNames.has(x.name.toLowerCase())),
    city: top ? { name: top.city.name, country: top.city.country } : null,
    venue,
    calls,
    mock: source.mock,
  };
  await kvSet(draftKey(draft.draftId), draft, DRAFT_TTL);
  return { status: "done", ...draft };
}

/** Saves a poster from a draft's own suggestions; anything not suggested is refused. */
export async function saveLineup(
  draftId: string,
  actIds: readonly string[],
  hostId: string | null,
  title: string,
): Promise<SavedLineup | { error: string }> {
  const draft = await kvGet<LineupDraft>(draftKey(draftId));
  if (!draft) return { error: "These suggestions have expired. Build the lineup again." };
  const acts = actIds.map((id) => draft.acts.find((a) => a.id === id)).filter((a): a is LineupAct => Boolean(a)).slice(0, 4);
  if (acts.length !== actIds.length || acts.length === 0) return { error: "Pick one to four support acts from the suggestions." };
  const host = hostId ? (draft.hosts.find((h) => h.id === hostId) ?? null) : null;
  if (hostId && !host) return { error: "Pick the host from the suggestions." };
  const saved: SavedLineup = {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 40) || `${draft.headliner.name} & Friends`,
    headliner: draft.headliner,
    acts,
    host,
    city: draft.city,
    venue: draft.venue,
    crowdFit: crowdFit(host ? [...acts, host] : acts),
    mock: draft.mock,
    createdAt: new Date().toISOString(),
  };
  await kvSet(savedKey(saved.id), saved, SAVED_TTL);
  return saved;
}

export async function loadLineup(id: string): Promise<SavedLineup | null> {
  return /^[0-9a-f-]{36}$/.test(id) ? kvGet<SavedLineup>(savedKey(id)) : null;
}
