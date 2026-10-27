import "server-only";

import type { Plan } from "@/lib/agent/types";
import { summarise, type PlanSummary } from "@/lib/plan-summary";

import { getRedis } from "./redis";

/** Long enough to cover judging; warm-cache examples are stored without expiry. */
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_MEMORY_PLANS = 200;
const key = (runId: string) => `takeover:plan:v1:${runId}`;
/** The latest live plans, newest first: plan fields only, nothing about who made them. */
const RECENT_KEY = "takeover:recent:v1";
const RECENT_MAX = 24;

// On globalThis: route handlers and pages are separate bundles, so a module-level map would not
// be shared between the /api/plan route that saves and the /plan page that reads.
const store = globalThis as typeof globalThis & { __takeoverPlans?: Map<string, Plan> };
const memory = (store.__takeoverPlans ??= new Map<string, Plan>());

function remember(plan: Plan) {
  memory.delete(plan.runId);
  memory.set(plan.runId, plan);
  if (memory.size > MAX_MEMORY_PLANS) memory.delete(memory.keys().next().value!);
}

/**
 * Stores finished plans for share links (/plan/<runId>). Sample (mock) plans stay in memory
 * only, so they never reach Redis.
 */
export async function savePlan(plan: Plan, opts: { forever?: boolean } = {}): Promise<void> {
  remember(plan);
  const redis = getRedis();
  if (plan.mock || !redis) return;
  try {
    // Preloaded examples (scripts/warm-cache.ts) never expire; live runs last through judging.
    if (opts.forever) await redis.set(key(plan.runId), plan);
    else await redis.set(key(plan.runId), plan, { ex: TTL_SECONDS });
    const summary = !opts.forever ? summarise(plan, new Date().toISOString()) : null;
    if (summary) {
      await redis.lpush(RECENT_KEY, summary);
      await redis.ltrim(RECENT_KEY, 0, RECENT_MAX - 1);
    }
  } catch {
    console.warn("[plan-store] Redis write failed; plan kept in memory only");
  }
}

export async function loadPlan(runId: string): Promise<Plan | null> {
  const local = memory.get(runId);
  if (local) return local;
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<Plan>(key(runId))) ?? null;
  } catch {
    return null;
  }
}

/** Recent live plans, one per fanbase × partner × city, newest first. Empty without Redis. */
export async function loadRecent(limit = 6): Promise<PlanSummary[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const rows = await redis.lrange<PlanSummary>(RECENT_KEY, 0, RECENT_MAX - 1);
    const seen = new Set<string>();
    return rows
      .filter((p) => {
        const k = `${p.fanbase}|${p.partner}|${p.city}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}
