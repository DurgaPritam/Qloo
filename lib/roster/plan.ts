import type { Category } from "@/lib/engine/types";

import type { RefreshEstimate } from "./types";

/** Profiles and pairings are reused for a week unless the user asks for a refresh. */
export const ROSTER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Calls one act's profile makes (lib/roster/profile.ts, PROFILE_CALLS). */
export const PROFILE_CALLS = 4;
/** One batch is one run, so it stays inside the per-run Qloo cap. */
export const BATCH_CALLS = 25;

export interface PlanAct {
  /** The roster_acts row id. */
  id: string;
  entityId: string;
  category: Category;
  profileAt: Date | null;
  affinitiesFor: string | null;
  affinitiesAt: Date | null;
}

export interface RefreshUnit {
  actId: string;
  profile: boolean;
  /** Categories of the other acts to ask about, one Qloo call each. */
  pairings: Category[];
  calls: number;
}

/** The other acts an act's pairings were asked about, as a stable key. */
export function othersKey(acts: readonly Pick<PlanAct, "entityId">[], entityId: string): string {
  return acts
    .map((a) => a.entityId)
    .filter((id) => id !== entityId)
    .sort((x, y) => x.localeCompare(y))
    .join(",");
}

const fresh = (at: Date | null, now: Date) => Boolean(at && now.getTime() - at.getTime() < ROSTER_TTL_MS);

export function profileStale(act: Pick<PlanAct, "profileAt">, now: Date): boolean {
  return !fresh(act.profileAt, now);
}

export function pairingsStale(act: PlanAct, acts: readonly PlanAct[], now: Date): boolean {
  if (acts.length < 2) return false;
  return act.affinitiesFor !== othersKey(acts, act.entityId) || !fresh(act.affinitiesAt, now);
}

/**
 * What a refresh will do and the most Qloo calls it can use: a profile for each act whose profile
 * is missing or a week old, and for each act whose pairings are stale one call per category among
 * the other acts. `force` refreshes everything. Units are packed into batches of at most one run's
 * budget, in roster order.
 */
export function planRefresh(acts: readonly PlanAct[], opts: { now: Date; force?: boolean }): { units: RefreshUnit[]; batches: RefreshUnit[][]; estimate: RefreshEstimate } {
  const units: RefreshUnit[] = [];
  for (const act of acts) {
    const profile = opts.force || profileStale(act, opts.now);
    const pairs = acts.length > 1 && (opts.force || pairingsStale(act, acts, opts.now));
    const pairings = pairs ? [...new Set(acts.filter((a) => a.entityId !== act.entityId).map((a) => a.category))].sort() : [];
    const calls = (profile ? PROFILE_CALLS : 0) + pairings.length;
    if (calls > 0) units.push({ actId: act.id, profile, pairings, calls });
  }

  const batches: RefreshUnit[][] = [];
  let current: RefreshUnit[] = [];
  let used = 0;
  for (const unit of units) {
    if (current.length && used + unit.calls > BATCH_CALLS) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(unit);
    used += unit.calls;
  }
  if (current.length) batches.push(current);

  return {
    units,
    batches,
    estimate: {
      calls: units.reduce((s, u) => s + u.calls, 0),
      acts: units.length,
      profiles: units.filter((u) => u.profile).length,
      pairings: units.reduce((s, u) => s + u.pairings.length, 0),
      batches: batches.length,
    },
  };
}

export type RefreshBlock = { reason: "workspace" | "daily"; message: string } | null;

/** Refuses a refresh whose estimate does not fit what is left; nothing runs then. */
export function refreshBlock(
  estimate: Pick<RefreshEstimate, "calls" | "batches">,
  usage: { remaining: number; allowance: number; dailyRemaining: number | null; jobDailyRemaining?: number | null },
): RefreshBlock {
  if (estimate.calls === 0) return null;
  if (estimate.calls > usage.remaining) {
    return {
      reason: "workspace",
      message: `This refresh can use up to ${estimate.calls} Qloo calls, and the workspace has ${usage.remaining} of ${usage.allowance} left this month.`,
    };
  }
  const daily = estimate.batches > 1 ? (usage.jobDailyRemaining ?? usage.dailyRemaining) : usage.dailyRemaining;
  if (daily !== null && daily !== undefined && estimate.calls > daily) {
    return { reason: "daily", message: `This refresh can use up to ${estimate.calls} Qloo calls, and only ${daily} are left today across the site. Try again tomorrow.` };
  }
  return null;
}
