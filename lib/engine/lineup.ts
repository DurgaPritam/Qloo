/**
 * Lineup optimizer. The headliner is always on the bill; the other slots are filled to maximise
 *   Σ fit  (fit = Qloo affinity among the headliner's fans × 100)
 * with total fees (the user's own tiers) at most the budget. Exact search over every combination
 * (the pool is capped, so it stays small); ties go to the cheaper lineup, then by id, so the same
 * inputs always give the same bill. Fees and budget are the user's; nothing here estimates a fee.
 */
export interface LineupCandidate {
  id: string;
  name: string;
  /** 0–100, from Qloo; null for the headliner (its own audience is the reference). */
  fit: number | null;
  /** The user's fee for this act (its tier's fee). */
  fee: number;
}

export interface LineupSlot extends LineupCandidate {
  role: "Headliner" | "Feature" | "Support" | "Opener";
}

export interface LineupPick {
  slots: LineupSlot[];
  cost: number;
  /** Mean fit of the acts after the headliner, 0–100. */
  meanFit: number;
  left: number;
}

export const MAX_POOL = 16;
const ROLES: LineupSlot["role"][] = ["Headliner", "Feature", "Support", "Opener"];

export function bestLineup(headliner: LineupCandidate, pool: readonly LineupCandidate[], opts: { slots: number; budget: number }): LineupPick | null {
  const k = Math.max(1, Math.min(4, Math.round(opts.slots))) - 1;
  const budget = Number.isFinite(opts.budget) ? opts.budget : 0;
  const others = pool
    .filter((c) => c.id !== headliner.id && c.fit !== null && Number.isFinite(c.fee) && c.fee >= 0)
    .slice(0, MAX_POOL)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (headliner.fee > budget || others.length < k) return null;
  let best: { picks: LineupCandidate[]; cost: number; fit: number } | null = null;
  const pick: LineupCandidate[] = [];
  const walk = (start: number, cost: number, fit: number) => {
    if (cost > budget) return;
    if (pick.length === k) {
      const better = !best || fit > best.fit || (fit === best.fit && cost < best.cost);
      if (better) best = { picks: [...pick], cost, fit };
      return;
    }
    for (let i = start; i <= others.length - (k - pick.length); i++) {
      pick.push(others[i]);
      walk(i + 1, cost + others[i].fee, fit + (others[i].fit ?? 0));
      pick.pop();
    }
  };
  walk(0, headliner.fee, 0);
  if (!best) return null;
  const b = best as { picks: LineupCandidate[]; cost: number; fit: number };
  const ordered = [...b.picks].sort((x, y) => (y.fit ?? 0) - (x.fit ?? 0) || x.name.localeCompare(y.name));
  return {
    slots: [{ ...headliner, role: "Headliner" }, ...ordered.map((c, i) => ({ ...c, role: ROLES[i + 1] }))],
    cost: b.cost,
    meanFit: k ? Math.round(b.fit / k) : 0,
    left: budget - b.cost,
  };
}
