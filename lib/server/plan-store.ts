import "server-only";

import type { Plan } from "@/lib/agent/types";

import { getRedis } from "./redis";

/** Long enough to cover judging; warm-cache examples are stored without expiry. */
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_MEMORY_PLANS = 200;
const key = (runId: string) => `takeover:plan:v1:${runId}`;

const memory = new Map<string, Plan>();

function remember(plan: Plan) {
  memory.delete(plan.runId);
  memory.set(plan.runId, plan);
  if (memory.size > MAX_MEMORY_PLANS) memory.delete(memory.keys().next().value!);
}

/**
 * Stores finished plans for share links (/plan/<runId>). Sample (mock) plans stay in memory
 * only, so they never reach Redis.
 */
export async function savePlan(plan: Plan): Promise<void> {
  remember(plan);
  const redis = getRedis();
  if (plan.mock || !redis) return;
  try {
    await redis.set(key(plan.runId), plan, { ex: TTL_SECONDS });
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
