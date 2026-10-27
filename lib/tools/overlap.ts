import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { overlapLevel, type OverlapLevel } from "@/lib/engine/overlap";
import type { CityScore, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooSource } from "@/lib/qloo/source";

import { audienceProfiles, type AudienceProfile } from "./audience";
import { describeFailure, metroPool, resolveEntity, view, type CallView, type Choice } from "./shared";

const MIN_POPULATION = 150_000;

export type OverlapResult =
  | { status: "choose"; side: "a" | "b"; query: string; question: string; choices: Choice[]; calls: CallView[]; mock: boolean }
  | { status: "none"; side: "a" | "b"; query: string; calls: CallView[]; mock: boolean }
  | {
      status: "done";
      a: Entity;
      b: Entity;
      /** Affinity of B among A's fans, and of A among B's; null when Qloo returns none. */
      bAmongA: number | null;
      aAmongB: number | null;
      level: OverlapLevel;
      market: Market;
      cities: CityScore[];
      audiences: AudienceProfile[];
      calls: CallView[];
      mock: boolean;
    };

/**
 * Fan overlap checker: how strongly each side's fans over-index on the other (Qloo affinity
 * with filter.results.entities), where both are strong (two heatmaps in A's home market) and who
 * the fans are (demographics). Up to 8 Qloo calls.
 */
export async function checkOverlap(
  qa: string,
  qb: string,
  ids: { a?: string; b?: string },
  source: QlooSource,
  opts: { runId: string },
): Promise<OverlapResult> {
  const calls: CallView[] = [];
  const [ra, rb] = await Promise.all([
    resolveEntity(qa, FANBASE_CATEGORIES, ids.a, source, opts, calls),
    resolveEntity(qb, FANBASE_CATEGORIES, ids.b, source, opts, calls),
  ]);
  for (const [side, r, query] of [["a", ra, qa], ["b", rb, qb]] as const) {
    if (r.kind === "none") return { status: "none", side, query, calls, mock: source.mock };
    if (r.kind === "choose") return { status: "choose", side, query, question: r.question, choices: r.choices, calls, mock: source.mock };
  }
  const a = (ra as Extract<typeof ra, { kind: "resolved" }>).entity;
  const b = (rb as Extract<typeof rb, { kind: "resolved" }>).entity;
  const market = marketFor(a.homeCountry) ?? marketFor(DEFAULT_MARKET)!;

  const affinity = (signal: Entity, target: Entity) =>
    source.affinityOf([signal.id], target.id, target.category, opts).then(
      (res) => {
        calls.push(view(res.meta));
        return res.data && Number.isFinite(res.data.affinity) ? res.data.affinity : null;
      },
      (err) => {
        console.warn("[tools/overlap] affinity failed:", describeFailure(err));
        return null;
      },
    );
  const heat = (e: Entity) =>
    source.heatmap([e.id], market.name, opts).then(
      (res) => {
        calls.push(view(res.meta));
        return res.data;
      },
      (err) => {
        console.warn("[tools/overlap] heatmap failed:", describeFailure(err));
        return null;
      },
    );

  const [bAmongA, aAmongB, ha, hb, audiences] = await Promise.all([
    affinity(a, b),
    affinity(b, a),
    heat(a),
    heat(b),
    audienceProfiles([a.id, b.id], source, opts, calls),
  ]);
  const pool = metroPool().filter((c) => c.country === market.code);
  const cities = ha && hb ? scoreCities(ha, hb, pool, MIN_POPULATION).filter((c) => c.combined > 0).slice(0, 6) : [];
  return {
    status: "done",
    a,
    b,
    bAmongA,
    aAmongB,
    level: overlapLevel([bAmongA, aAmongB]),
    market,
    cities,
    audiences,
    calls,
    mock: source.mock,
  };
}
