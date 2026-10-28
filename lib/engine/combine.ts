/**
 * Blends Qloo's city signal with the user's own metric (docs/roadmap-rules.md, rule 2: never one
 * blended number without its parts). Every row keeps the Qloo part, the user part and the weight.
 *
 *   yours    = city metric ÷ the best city's metric          (0–1, "scaled against your best city")
 *   combined = (1 − weight) × qloo + weight × yours
 *
 * Only cities in the user's data are ranked. A city in their data that Qloo did not score is ranked
 * on their data alone and says so (`basis`). A city Qloo scores but their data lacks is not ranked:
 * untestedCities lists those separately, by Qloo signal ("strong Qloo signal, no data from you yet").
 */
export interface CityQlooScore {
  cityId: string;
  /** 0–1, from lib/engine/cities.ts. */
  score: number;
}

export interface CityMetric {
  cityId: string;
  /** The user's value for the city, summed over its rows. */
  value: number;
}

export interface CombinedCity {
  cityId: string;
  /** 0–1 Qloo score, or null when Qloo did not score the city. */
  qloo: number | null;
  /** The user's metric normalised 0–1, or null when the city is not in their data. */
  yours: number | null;
  /** The raw metric, for display next to the normalised one. */
  raw: number | null;
  /** The best city's total, which the user's metric is scaled against; null without user data. */
  scale: { cityId: string; raw: number } | null;
  combined: number;
  /** Weight on the user's data, 0–1, as used for this row. */
  weight: number;
  basis: "both" | "yours";
  rank: number;
}

/** A city Qloo scores that the user's data does not cover yet. */
export interface UntestedCity {
  cityId: string;
  qloo: number;
  rank: number;
}

export const DEFAULT_USER_WEIGHT = 0.5;

const finite = (x: number) => Number.isFinite(x);

/** Sums each city's values and scales them against the best city: 0–1. Non-positive or invalid values are dropped. */
export function normaliseMetric(metric: readonly CityMetric[]): Map<string, { raw: number; norm: number }> {
  const sums = new Map<string, number>();
  for (const m of metric) {
    if (!finite(m.value) || m.value < 0) continue;
    sums.set(m.cityId, (sums.get(m.cityId) ?? 0) + m.value);
  }
  const best = Math.max(0, ...sums.values());
  return new Map([...sums].map(([id, raw]) => [id, { raw, norm: best > 0 ? raw / best : 0 }]));
}

export function clampWeight(weight: number): number {
  return finite(weight) ? Math.min(1, Math.max(0, weight)) : DEFAULT_USER_WEIGHT;
}

const qlooMap = (qlooScores: readonly CityQlooScore[]) => new Map(qlooScores.filter((q) => finite(q.score)).map((q) => [q.cityId, Math.min(1, Math.max(0, q.score))]));

export function combineCityScores(qlooScores: readonly CityQlooScore[], userMetric: readonly CityMetric[], weight: number = DEFAULT_USER_WEIGHT): CombinedCity[] {
  const w = clampWeight(weight);
  const qloo = qlooMap(qlooScores);
  const yours = normaliseMetric(userMetric);
  const best = [...yours].sort((a, b) => b[1].raw - a[1].raw || a[0].localeCompare(b[0]))[0];
  const scale = best ? { cityId: best[0], raw: best[1].raw } : null;
  const rows = [...yours].map(([cityId, y]) => {
    const q = qloo.get(cityId) ?? null;
    const basis: CombinedCity["basis"] = q !== null ? "both" : "yours";
    const combined = q !== null ? (1 - w) * q + w * y.norm : y.norm;
    return { cityId, qloo: q, yours: y.norm, raw: y.raw, scale, combined, weight: w, basis, rank: 0 };
  });
  return rows
    .sort((a, b) => b.combined - a.combined || (b.qloo ?? -1) - (a.qloo ?? -1) || a.cityId.localeCompare(b.cityId))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Cities Qloo scores that are not in the user's data, best Qloo signal first; never blended or ranked with them. */
export function untestedCities(qlooScores: readonly CityQlooScore[], userMetric: readonly CityMetric[]): UntestedCity[] {
  const yours = normaliseMetric(userMetric);
  return [...qlooMap(qlooScores)]
    .filter(([cityId, q]) => !yours.has(cityId) && q > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cityId, qloo], i) => ({ cityId, qloo, rank: i + 1 }));
}
