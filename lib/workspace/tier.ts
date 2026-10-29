import "server-only";

import { getDb } from "@/lib/db";
import type { BillingChange } from "@/lib/billing/stripe";
import { unscopedApplyBilling, unscopedSyncSubscription, unscopedWorkspaceTier } from "@/lib/db/unscoped";
import { limitsOf } from "@/lib/entitlements";

/**
 * A workspace's Qloo allowance for this month, from its tier (lib/entitlements.ts), for the Qloo
 * client's counters. Cached briefly: a tier changes rarely, and every Qloo call asks.
 */
const cache = new Map<string, { value: number | null; at: number }>();
const TTL_MS = 30_000;

export async function tierAllowance(workspaceId: string): Promise<number | null> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: number | null = null;
  try {
    const row = await unscopedWorkspaceTier(await getDb(), workspaceId);
    value = row ? limitsOf(row.tier).qlooMonthly : null;
  } catch {
    value = null;
  }
  cache.set(workspaceId, { value, at: Date.now() });
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return value;
}

/** After a billing change, so the new allowance applies at once. */
export function forgetTier(workspaceId: string) {
  cache.delete(workspaceId);
}

/** A verified Stripe event's change to a workspace's subscription and tier (once per event id). */
export async function applyBillingEvent(event: { id: string; type: string }, change: BillingChange) {
  const outcome = await unscopedApplyBilling(await getDb(), event, change);
  if (outcome.workspaceId) forgetTier(outcome.workspaceId);
  return outcome;
}

/** The subscription as Stripe has it now, for the user's own workspace (the return from Checkout or the portal). */
export async function syncSubscription(workspaceId: string, change: Extract<BillingChange, { kind: "subscription" }>) {
  const outcome = await unscopedSyncSubscription(await getDb(), workspaceId, change);
  forgetTier(workspaceId);
  return outcome;
}
