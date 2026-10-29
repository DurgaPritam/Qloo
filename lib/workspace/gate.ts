import "server-only";

import { has, limitsOf, upgradeFor, upgradeForLimit, type Feature, type Limits, type Upgrade } from "@/lib/entitlements";
import type { WorkspaceRepo } from "@/lib/db/scoped";

/**
 * Entitlement checks for routes and pages: the only callers of lib/entitlements' feature and limit
 * checks. A refusal carries an upgrade (which tier, and what it unlocks), never a dead end.
 */
export class UpgradeRequiredError extends Error {
  constructor(public readonly upgrade: Upgrade) {
    super(upgrade.reason);
    this.name = "UpgradeRequiredError";
  }
}

export interface Plan {
  tier: string;
  limits: Limits;
}

/** The workspace's tier and its limits (Team seats as bought). */
export async function planOf(repo: WorkspaceRepo): Promise<Plan> {
  const ws = await repo.workspace.get();
  const tier = ws?.tier ?? "free";
  return { tier, limits: limitsOf(tier, { seatsBought: ws?.seats ?? null }) };
}

/** Throws UpgradeRequiredError when the workspace's tier lacks the feature. */
export async function needFeature(repo: WorkspaceRepo, feature: Feature): Promise<Plan> {
  const plan = await planOf(repo);
  if (!has(plan.tier, feature)) throw new UpgradeRequiredError(upgradeFor(feature));
  return plan;
}

/** Throws when a count would pass a limit; the upgrade names the next tier that raises it. */
export function withinLimit(plan: Plan, limit: keyof Omit<Limits, "api">, used: number, reason: string): void {
  const max = plan.limits[limit];
  if (max === null || used < max) return;
  const upgrade = upgradeForLimit(plan.tier, limit, reason);
  throw new UpgradeRequiredError(upgrade ?? { feature: null, reason, tier: "enterprise", label: "Enterprise", unlocks: [], selfServe: false });
}

/** For pages: whether the workspace has the feature, and the upgrade prompt when it does not. */
export async function featureAccess(repo: WorkspaceRepo, feature: Feature): Promise<{ allowed: boolean; upgrade: Upgrade | null; plan: Plan }> {
  const plan = await planOf(repo);
  const allowed = has(plan.tier, feature);
  return { allowed, upgrade: allowed ? null : upgradeFor(feature), plan };
}

/** Whether a signed-in run may be saved to this workspace: Pro or above, within the plans a month. */
export async function planSaving(repo: WorkspaceRepo): Promise<{ ok: true } | { ok: false; reason: string; upgrade: Upgrade }> {
  const plan = await planOf(repo);
  if (!has(plan.tier, "workspace.plans")) {
    const upgrade = upgradeFor("workspace.plans", "Saved to My plans in this browser. Saving plans to your workspace comes with Pro.");
    return { ok: false, reason: upgrade.reason, upgrade };
  }
  const max = plan.limits.plansPerMonth;
  if (max === null) return { ok: true };
  const now = new Date();
  const used = await repo.plans.countSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  if (used < max) return { ok: true };
  const reason = `Saved to My plans in this browser: this workspace has saved its ${max} plans for the month.`;
  const upgrade = upgradeForLimit(plan.tier, "plansPerMonth", reason);
  return { ok: false, reason, upgrade: upgrade ?? upgradeFor("workspace.plans", reason) };
}

/** The limits for whoever is using a public tool: their workspace's tier when signed in, else Free. */
export async function visitorLimits(found: { repo: WorkspaceRepo } | null): Promise<Plan> {
  return found ? planOf(found.repo) : { tier: "free", limits: limitsOf("free") };
}
