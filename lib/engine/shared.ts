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

interface ScreenRules {
  maxPopularity: number;
  minPopularity?: number;
  minAffinity: number;
  /** The affinity compared with minAffinity; defaults to the raw affinity. */
  affinityOf?: (item: Scorable) => number;
}

/**
 * Splits items into those that pass and those dropped with a reason. Checked in order: valid data,
 * not too popular, not too obscure, affinity at or above the floor.
 */
export function screen<T extends Scorable>(items: readonly T[], rules: ScreenRules): { kept: T[]; dropped: Dropped<T>[] } {
  const kept: T[] = [];
  const dropped: Dropped<T>[] = [];
  for (const item of items) {
    const reason = dropReason(item, rules);
    if (reason) dropped.push({ item, reason });
    else kept.push(item);
  }
  return { kept, dropped };
}

function dropReason(item: Scorable, rules: ScreenRules): DropReason | null {
  if (!item.id || !isUnit(item.affinity) || !isUnit(item.popularity)) return "invalid_data";
  if (item.popularity > rules.maxPopularity) return "too_popular";
  if (item.popularity < (rules.minPopularity ?? 0)) return "too_obscure";
  const affinity = rules.affinityOf ? rules.affinityOf(item) : item.affinity;
  if (affinity < rules.minAffinity) return "below_min_affinity";
  return null;
}

/**
 * Affinity relative to the item's group: 0 at the group's median, 1 at its best, negative below the
 * median. Qloo affinity differs in level by category (docs/tuning.md), so ranking is done on this.
 */
export function relativeAffinity<T extends Scorable>(items: readonly T[], groupOf: (item: T) => string): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    if (!isUnit(item.affinity)) continue;
    const g = groupOf(item);
    groups.set(g, [...(groups.get(g) ?? []), item.affinity]);
  }
  const stats = new Map(
    [...groups].map(([g, xs]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
      return [g, { median, max: sorted.at(-1)! }];
    }),
  );
  const out = new Map<string, number>();
  for (const item of items) {
    const st = stats.get(groupOf(item));
    if (!st || !isUnit(item.affinity)) continue;
    const spread = st.max - st.median;
    out.set(item.id, spread > 0 ? (item.affinity - st.median) / spread : item.affinity >= st.max ? 1 : 0);
  }
  return out;
}

/**
 * Screens in two stages: validity and the popularity band first, then affinity relative to the
 * survivors' group (so a dropped mega-star does not raise its category's median), then the floor.
 */
export function screenRelative<T extends Scorable>(
  items: readonly T[],
  rules: { maxPopularity: number; minPopularity: number; minRelativeAffinity: number },
  groupOf: (item: T) => string,
): { kept: T[]; dropped: Dropped<T>[]; rel: Map<string, number> } {
  const band = screen(items, { ...rules, minAffinity: Number.NEGATIVE_INFINITY });
  const rel = relativeAffinity(band.kept, groupOf);
  const kept: T[] = [];
  const dropped: Dropped<T>[] = [...band.dropped];
  for (const item of band.kept) {
    if ((rel.get(item.id) ?? 0) < rules.minRelativeAffinity) dropped.push({ item, reason: "below_min_affinity" });
    else kept.push(item);
  }
  return { kept, dropped, rel };
}

/** Highest score first; ties broken by id so results are deterministic. */
export function byScoreThenId<T extends { score: number; id: string }>(a: T, b: T): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

export function describeDropped(dropped: readonly Dropped<unknown>[]): string {
  if (dropped.length === 0) return "dropped none";
  const counts = { too_popular: 0, too_obscure: 0, below_min_affinity: 0, invalid_data: 0, not_a_sponsor: 0 };
  for (const d of dropped) counts[d.reason]++;
  const parts = [
    counts.too_popular && `${counts.too_popular} too mainstream`,
    counts.too_obscure && `${counts.too_obscure} too little known`,
    counts.below_min_affinity && `${counts.below_min_affinity} below their category's median affinity`,
    counts.invalid_data && `${counts.invalid_data} with missing or invalid data`,
    counts.not_a_sponsor && `${counts.not_a_sponsor} not sponsors (nonprofit, government or teams)`,
  ].filter(Boolean);
  return `dropped ${dropped.length} (${parts.join(", ")})`;
}
