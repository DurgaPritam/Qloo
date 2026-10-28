import { scoreCityHeat, type Heat } from "./cities";
import { overlapLevel, type OverlapLevel } from "./overlap";
import type { Category, City, Confidence } from "./types";

/** One act on a roster, with what Qloo said about the others among its fans. */
export interface RosterActSignal {
  id: string;
  name: string;
  category: Category;
  /**
   * Qloo affinity of each other act (by entity id) among this act's fans: the act was the signal
   * and the others were filter.results.entities. Absent or null: Qloo returned nothing for it.
   */
  affinities: Readonly<Record<string, number | null>>;
  /** ISO code of the market the act's heat was measured in. */
  market?: string;
  /** Per-city heat in that market (lib/engine/cities.ts, cityHeat). */
  heat?: ReadonlyMap<string, Heat>;
}

type ActRef = Pick<RosterActSignal, "id" | "name" | "category">;

export interface RosterPair {
  rank: number;
  a: ActRef;
  b: ActRef;
  /** Shared-audience score, 0–100: the mean of the directions Qloo returned, × 100. */
  score: number;
  level: OverlapLevel;
  confidence: Confidence;
  evidence: {
    /** Affinity of B among A's fans. */
    bAmongA: number | null;
    /** Affinity of A among B's fans. */
    aAmongB: number | null;
  };
  /** Where both fanbases are strongest, inside their shared home market. */
  city: { id: string; name: string; country: string; combined: number; confidence: Confidence } | null;
  cityNote: string;
}

export interface UnscoredPair {
  a: ActRef;
  b: ActRef;
  reason: string;
}

/** Smallest city a pair's shared city may be, as in the Fan overlap tool. */
export const ROSTER_PAIR_MIN_POPULATION = 150_000;

const known = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const weakest = (cs: readonly Confidence[]): Confidence => cs.reduce((w, c) => (RANK[c] < RANK[w] ? c : w), "high");

/**
 * Every pair of acts on a roster, ranked by shared audience. A pair's score uses both directions
 * (B among A's fans and A among B's), so it is the same whichever act comes first. With one
 * direction missing the other is used alone and the confidence is capped at medium; with both
 * missing the pair is listed as unscored, never given a number.
 */
export function scoreRosterPairs(
  acts: readonly RosterActSignal[],
  cities: readonly City[],
  opts: { minPopulation?: number } = {},
): { pairs: RosterPair[]; unscored: UnscoredPair[] } {
  const minPopulation = opts.minPopulation ?? ROSTER_PAIR_MIN_POPULATION;
  const unique = acts.filter((act, i) => acts.findIndex((x) => x.id === act.id) === i);
  const scored: Omit<RosterPair, "rank">[] = [];
  const unscored: UnscoredPair[] = [];

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const result = scorePair(unique[i], unique[j], cities, minPopulation);
      if ("reason" in result) unscored.push(result);
      else scored.push(result);
    }
  }

  const pairKey = (p: { a: ActRef; b: ActRef }) => [p.a.id, p.b.id].sort((x, y) => x.localeCompare(y)).join("|");
  const pairs = scored
    .sort((x, y) => y.score - x.score || RANK[y.confidence] - RANK[x.confidence] || pairKey(x).localeCompare(pairKey(y)))
    .map((p, i) => ({ ...p, rank: i + 1 }));
  return { pairs, unscored };
}

const BY_LEVEL: Record<OverlapLevel, Confidence> = { strong: "high", clear: "medium", some: "low", unknown: "low" };

function scorePair(A: RosterActSignal, B: RosterActSignal, cities: readonly City[], minPopulation: number): Omit<RosterPair, "rank"> | UnscoredPair {
  const a = ref(A);
  const b = ref(B);
  const bAmongA = known(A.affinities[B.id]) ? A.affinities[B.id]! : null;
  const aAmongB = known(B.affinities[A.id]) ? B.affinities[A.id]! : null;
  const directions = [bAmongA, aAmongB].filter((x): x is number => x !== null);
  if (directions.length === 0) return { a, b, reason: "Qloo returned no affinity between these two in either direction." };
  const mean = directions.reduce((s, x) => s + x, 0) / directions.length;
  const level = overlapLevel([bAmongA, aAmongB]);
  const confidence = directions.length === 2 ? BY_LEVEL[level] : weakest([BY_LEVEL[level], "medium"]);
  return { a, b, score: Math.round(mean * 100), level, confidence, evidence: { bAmongA, aAmongB }, ...sharedCity(A, B, cities, minPopulation) };
}

function ref(act: RosterActSignal): ActRef {
  return { id: act.id, name: act.name, category: act.category };
}

function sharedCity(A: RosterActSignal, B: RosterActSignal, cities: readonly City[], minPopulation: number): Pick<RosterPair, "city" | "cityNote"> {
  if (!A.heat || !B.heat || !A.market || !B.market) {
    return { city: null, cityNote: "No city-level data for one of them yet." };
  }
  if (A.market !== B.market) {
    return { city: null, cityNote: `Their home markets differ (${A.market}, ${B.market}), so no shared city was scored.` };
  }
  const pool = cities.filter((c) => c.country === A.market);
  const top = scoreCityHeat(A.heat, B.heat, pool, minPopulation)[0];
  if (!top || top.combined === 0) return { city: null, cityNote: `No city in ${A.market} is warm for both.` };
  return {
    city: { id: top.city.id, name: top.city.name, country: top.city.country, combined: top.combined, confidence: top.confidence },
    cityNote: `Strongest for both in ${top.city.name}.`,
  };
}

/**
 * One confidence for an act's row: the weakest of its city, partner and sponsor picks, so the row
 * is never more certain than its least-backed part. A missing pick counts as low.
 */
export function actConfidence(parts: readonly (Confidence | null | undefined)[]): Confidence {
  return weakest(parts.map((c) => c ?? "low"));
}
