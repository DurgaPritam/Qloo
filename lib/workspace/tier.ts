import "server-only";

import { getDb } from "@/lib/db";
import { unscopedWorkspaceTier } from "@/lib/db/unscoped";
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
