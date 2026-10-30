import "server-only";

import { cityQuery } from "@/lib/agent/tools";
import { formatFor } from "@/lib/engine/formats";
import { scorePartners } from "@/lib/engine/partners";
import { rankBrands, rankPlaces } from "@/lib/engine/places";
import type { Category, City, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooSource } from "@/lib/qloo/source";

import { metroPool, resolveEntity, view, type CallView } from "./shared";

/**
 * Tour planner, one stop at a time: a venue, a support act or sponsors for one city, only when
 * the user clicks for it (one Qloo call, plus the fanbase search, which is usually cached). Same
 * queries and engine ranking as the takeover's room step (lib/agent/tools.ts plan_room).
 */

export type SuggestKind = "venue" | "support" | "sponsor";
export const SUGGEST_KINDS: readonly SuggestKind[] = ["venue", "support", "sponsor"];

export interface Suggestion {
  name: string;
  qlooId: string;
  /** 0–1, the engine's score. */
  score: number;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface SuggestResult {
  kind: SuggestKind;
  city: { id: string; name: string };
  picks: Suggestion[];
  /** Labelled when the engine had to relax or found nothing. */
  fallback: boolean;
  reason: string;
  calls: CallView[];
  mock: boolean;
}

const TOP = 3;
const two = (x: number) => x.toFixed(2);

export function cityById(id: string): City | null {
  return metroPool().find((c) => c.id === id) ?? null;
}

/** The fanbase as an Entity: searched by name and picked by id; a minimal one when the search does not return it. */
async function fanbaseEntity(id: string, name: string, category: Category, source: QlooSource, opts: { runId: string }, calls: CallView[]): Promise<Entity> {
  if (name) {
    const r = await resolveEntity(name, FANBASE_CATEGORIES, id, source, opts, calls);
    if (r.kind === "resolved" && r.entity.id === id) return r.entity;
  }
  return { id, name: name || id, category, popularity: 0 };
}

export async function suggestForStop(
  input: { fanbaseId: string; fanbaseName: string; category: Category; city: City; kind: SuggestKind },
  source: QlooSource,
  opts: { runId: string },
): Promise<SuggestResult> {
  const calls: CallView[] = [];
  const fanbase = await fanbaseEntity(input.fanbaseId, input.fanbaseName, input.category, source, opts, calls);
  const where = cityQuery(input.city);
  const base = { kind: input.kind, city: { id: input.city.id, name: input.city.name }, calls, mock: source.mock };

  if (input.kind === "venue") {
    const format = formatFor(fanbase);
    const res = await source.places([fanbase.id], where, format.venueTags, opts);
    calls.push(view(res.meta));
    const ranked = rankPlaces(res.data, format.venueTags, TOP, format.avoidTags);
    return {
      ...base,
      picks: ranked.picks.map((p) => ({
        name: p.place.name,
        qlooId: p.place.id,
        score: p.score,
        confidence: p.confidence,
        evidence: `Qloo affinity ${two(p.evidence.affinity)}${p.evidence.matchedTags.length ? ` · tagged ${p.evidence.matchedTags.join(", ")}` : " · no venue tag matched"}`,
      })),
      fallback: ranked.fallback,
      reason: ranked.reason,
    };
  }
  if (input.kind === "support") {
    // Musicians get artists as openers; everyone else gets people (comedians, hosts).
    const category: Category = fanbase.category === "artist" ? "artist" : "person";
    const res = await source.candidates([fanbase.id], category, where, opts);
    calls.push(view(res.meta));
    const ranked = scorePartners(res.data, { count: TOP, minCategories: 1, excludeIds: [fanbase.id] });
    return {
      ...base,
      picks: ranked.picks.map((p) => ({
        name: p.entity.name,
        qlooId: p.entity.id,
        score: p.score,
        confidence: p.confidence,
        evidence: `Qloo affinity ${two(p.evidence.affinity)} · ${two(p.evidence.relativeAffinity)} against other ${category === "artist" ? "artists" : "people"} · popularity ${two(p.evidence.popularity)}`,
      })),
      fallback: ranked.fallback,
      reason: ranked.reason,
    };
  }
  const res = await source.brands([fanbase.id], where, opts);
  calls.push(view(res.meta));
  const ranked = rankBrands(res.data, TOP);
  return {
    ...base,
    picks: ranked.picks.map((p) => ({
      name: p.brand.name,
      qlooId: p.brand.id,
      score: p.score,
      confidence: p.confidence,
      evidence: `Qloo affinity ${two(p.evidence.affinity)} · ${two(p.evidence.relativeAffinity)} against other brands · popularity ${two(p.evidence.popularity)}`,
    })),
    fallback: ranked.fallback,
    reason: ranked.reason,
  };
}
