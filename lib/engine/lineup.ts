import { ENGINE_CONFIG } from "./config";

/**
 * Lineup optimizer. From a pool of acts, each with the user's fee tier, picks the bill that maximises
 *   score = (1 − w) × crowd fit + w × coverage
 * where crowd fit is the mean mutual Qloo affinity over every pair on the bill (√(a→b × b→a); one
 * direction alone when Qloo gave only one; 0 when Qloo gave neither), and coverage is the share of
 * the pool's audience clusters on the bill (clusters: acts linked by mutual affinity ≥ the threshold).
 * Hard constraints, never broken: total fees within budget, at most the user's slots in each tier,
 * every must-include act on the bill, at least two acts. The bill fills as many of the user's slots
 * as the budget and the pool allow (crowd fit is a mean, so it would otherwise prefer a two-act
 * bill); among bills of that size the score decides, then the cheaper, then act ids. Every subset
 * is tried (the pool is capped), so the same inputs always give the same lineup. Fees, tiers, budget and slots are the user's; nothing here estimates a fee.
 */
export type Tier = "A" | "B" | "C";
export const TIERS: Tier[] = ["A", "B", "C"];

export interface PoolAct {
  id: string;
  name: string;
  tier: Tier;
  mustInclude?: boolean;
}

/** Qloo affinity of `to` among fans of `from`, 0–1; absent when Qloo did not return it. */
export type AffinityMatrix = Record<string, Record<string, number | null | undefined>>;

export interface LineupConstraints {
  budget: number;
  fees: Record<Tier, number>;
  /** Most acts per tier. */
  slots: Record<Tier, number>;
  /** 0–1: weight on coverage (the rest on crowd fit). */
  weight: number;
}

export interface Scored {
  ids: string[];
  score: number;
  crowdFit: number;
  coverage: number;
  cost: number;
}

export interface ActReason {
  id: string;
  name: string;
  tier: Tier;
  fee: number;
  mustInclude: boolean;
  cluster: string;
  /** The act on the bill whose fans it shares most with, and their mutual affinity. */
  strongest: { name: string; mutual: number } | null;
  /** How the score changes if this act is taken off the bill (null: a two-act bill cannot lose one). */
  drop: number | null;
}

export interface NearMiss extends Scored {
  added: string[];
  removed: string[];
  /** For the over-budget alternative: how much more budget it needs. */
  overBudget?: number;
}

export type LineupResult =
  | { status: "done"; best: Scored; reasons: ActReason[]; nearMisses: NearMiss[]; overBudget: NearMiss | null; clusters: { label: string; ids: string[] }[]; weight: number }
  | { status: "infeasible"; reason: string; clusters: { label: string; ids: string[] }[]; weight: number };

const cfg = ENGINE_CONFIG.lineup;
const known = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

/** √(a→b × b→a); one direction when only one is known; null when neither is. */
export function mutual(m: AffinityMatrix, a: string, b: string): number | null {
  const ab = m[a]?.[b];
  const ba = m[b]?.[a];
  if (known(ab) && known(ba)) return Math.sqrt(ab * ba);
  if (known(ab)) return ab;
  if (known(ba)) return ba;
  return null;
}

/** Audience clusters: connected groups of acts whose mutual affinity reaches the threshold. Labelled A, B, C… in id order. */
export function audienceClusters(ids: readonly string[], m: AffinityMatrix, threshold: number = cfg.clusterThreshold): string[][] {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  const parent = new Map(sorted.map((id) => [id, id]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const v = mutual(m, sorted[i], sorted[j]);
      if (v !== null && v >= threshold) {
        const [ra, rb] = [find(sorted[i]), find(sorted[j])].sort((a, b) => a.localeCompare(b));
        if (ra !== rb) parent.set(rb, ra);
      }
    }
  const groups = new Map<string, string[]>();
  for (const id of sorted) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()];
}

export function crowdFit(ids: readonly string[], m: AffinityMatrix): number {
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      sum += mutual(m, ids[i], ids[j]) ?? 0;
      pairs++;
    }
  return pairs ? sum / pairs : 0;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export function optimizeLineup(pool: readonly PoolAct[], m: AffinityMatrix, c: LineupConstraints): LineupResult {
  const weight = Number.isFinite(c.weight) ? Math.min(1, Math.max(0, c.weight)) : cfg.coverageWeight;
  const acts = [...pool].sort((a, b) => a.id.localeCompare(b.id)).slice(0, cfg.maxPool);
  const groups = audienceClusters(
    acts.map((a) => a.id),
    m,
  );
  const clusters = groups.map((ids, i) => ({ label: `Audience ${letter(i)}`, ids }));
  const clusterOf = new Map(clusters.flatMap((g) => g.ids.map((id) => [id, g.label] as const)));
  const maxActs = TIERS.reduce((s, t) => s + Math.max(0, Math.floor(c.slots[t] ?? 0)), 0);
  const coverDenominator = Math.max(1, Math.min(clusters.length, maxActs));
  const fee = (a: PoolAct) => Math.max(0, c.fees[a.tier] ?? 0);
  const must = acts.filter((a) => a.mustInclude);

  const infeasible = (reason: string): LineupResult => ({ status: "infeasible", reason, clusters, weight });
  if (acts.length < cfg.minActs) return infeasible("Add at least two acts to the pool.");
  if (maxActs < cfg.minActs) return infeasible("Allow at least two slots across the tiers.");
  for (const t of TIERS) {
    const n = must.filter((a) => a.tier === t).length;
    if (n > (c.slots[t] ?? 0)) return infeasible(`${n} must-include act${n === 1 ? " is" : "s are"} in tier ${t}, which has ${c.slots[t] ?? 0} slot${c.slots[t] === 1 ? "" : "s"}.`);
  }
  const mustCost = must.reduce((s, a) => s + fee(a), 0);
  if (mustCost > c.budget) return infeasible(`The must-include acts alone cost ${mustCost.toLocaleString("en-US")}, over the ${c.budget.toLocaleString("en-US")} budget.`);

  const scoreOf = (set: PoolAct[]): Scored => {
    const ids = set.map((a) => a.id);
    const fit = crowdFit(ids, m);
    const cover = new Set(ids.map((id) => clusterOf.get(id))).size / coverDenominator;
    return { ids, crowdFit: fit, coverage: Math.min(1, cover), score: (1 - weight) * fit + weight * Math.min(1, cover), cost: set.reduce((s, a) => s + fee(a), 0) };
  };
  // Fuller bills first (the user's slots), then score, then cost, then ids.
  const better = (a: Scored, b: Scored) =>
    a.ids.length > b.ids.length ||
    (a.ids.length === b.ids.length && (a.score - b.score > 1e-12 || (Math.abs(a.score - b.score) <= 1e-12 && (a.cost < b.cost || (a.cost === b.cost && a.ids.join() < b.ids.join())))));

  const feasible: Scored[] = [];
  let overBudget: Scored | null = null;
  const n = acts.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const set = acts.filter((_, i) => mask & (1 << i));
    if (set.length < cfg.minActs || set.length > maxActs) continue;
    if (must.some((a) => !set.includes(a))) continue;
    if (TIERS.some((t) => set.filter((a) => a.tier === t).length > (c.slots[t] ?? 0))) continue;
    const s = scoreOf(set);
    if (s.cost <= c.budget) feasible.push(s);
    else if (!overBudget || better(s, overBudget)) overBudget = s;
  }
  if (!feasible.length) return infeasible("No lineup of at least two acts fits the budget, the slots and the must-include acts. Raise the budget, add a slot or lower a tier.");
  feasible.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const best = feasible[0];
  const diff = (s: Scored): NearMiss => ({ ...s, added: s.ids.filter((id) => !best.ids.includes(id)), removed: best.ids.filter((id) => !s.ids.includes(id)) });
  const nearMisses = feasible.slice(1, 1 + cfg.nearMisses).map(diff);
  const over = overBudget && better(overBudget, best) ? { ...diff(overBudget), overBudget: overBudget.cost - c.budget } : null;

  const byId = new Map(acts.map((a) => [a.id, a]));
  const reasons: ActReason[] = best.ids.map((id) => {
    const act = byId.get(id)!;
    const others = best.ids.filter((x) => x !== id);
    const links = others.map((o) => ({ name: byId.get(o)!.name, mutual: mutual(m, id, o) })).filter((l): l is { name: string; mutual: number } => l.mutual !== null);
    const strongest = links.sort((a, b) => b.mutual - a.mutual || a.name.localeCompare(b.name))[0] ?? null;
    const without = others.length >= cfg.minActs ? scoreOf(others.map((o) => byId.get(o)!)) : null;
    return { id, name: act.name, tier: act.tier, fee: fee(act), mustInclude: Boolean(act.mustInclude), cluster: clusterOf.get(id)!, strongest, drop: without ? best.score - without.score : null };
  });
  return { status: "done", best, reasons, nearMisses, overBudget: over, clusters, weight };
}
