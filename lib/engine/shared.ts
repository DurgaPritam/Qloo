import { ENGINE_CONFIG } from "./config";
import type { Confidence, DropReason, Dropped } from "./types";

export function isUnit(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

export function confidenceFor(value: number): Confidence {
  if (value >= ENGINE_CONFIG.confidence.high) return "high";
  if (value >= ENGINE_CONFIG.confidence.medium) return "medium";
  return "low";
}

/** Rewards affinity, discounts mainstream reach. */
export function nicheScore(affinity: number, popularity: number, exponent: number): number {
  return affinity * Math.pow(1 - popularity, exponent);
}

interface Scorable {
  id: string;
  affinity: number;
  popularity: number;
}

/**
 * Splits items into those that pass validity, the bias guard and the affinity floor, and those
 * dropped with a reason. Validity is checked first, then popularity, then affinity.
 */
export function screen<T extends Scorable>(
  items: readonly T[],
  rules: { maxPopularity: number; minAffinity: number },
): { kept: T[]; dropped: Dropped<T>[] } {
  const kept: T[] = [];
  const dropped: Dropped<T>[] = [];
  for (const item of items) {
    const reason = dropReason(item, rules);
    if (reason) dropped.push({ item, reason });
    else kept.push(item);
  }
  return { kept, dropped };
}

function dropReason(
  item: Scorable,
  rules: { maxPopularity: number; minAffinity: number },
): DropReason | null {
  if (!item.id || !isUnit(item.affinity) || !isUnit(item.popularity)) return "invalid_data";
  if (item.popularity > rules.maxPopularity) return "too_popular";
  if (item.affinity < rules.minAffinity) return "below_min_affinity";
  return null;
}

/** Highest score first; ties broken by id so results are deterministic. */
export function byScoreThenId<T extends { score: number; id: string }>(a: T, b: T): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

export function describeDropped(dropped: readonly Dropped<unknown>[]): string {
  if (dropped.length === 0) return "dropped none";
  const counts = { too_popular: 0, below_min_affinity: 0, invalid_data: 0 };
  for (const d of dropped) counts[d.reason]++;
  const parts = [
    counts.too_popular && `${counts.too_popular} too mainstream`,
    counts.below_min_affinity && `${counts.below_min_affinity} below the affinity floor`,
    counts.invalid_data && `${counts.invalid_data} with missing or invalid data`,
  ].filter(Boolean);
  return `dropped ${dropped.length} (${parts.join(", ")})`;
}
