import "server-only";

import { plannerStatus } from "@/lib/agent/planner";
import { isMockMode } from "@/lib/mock-mode";
import { MemoryCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { QlooError } from "@/lib/qloo/errors";

import { DAILY_ID, getLimiters, LIMITS } from "./rate-limit";
import { getRedis } from "./redis";

export interface Health {
  ok: boolean;
  mock: boolean;
  checkedAt: string;
  qloo: { configured: boolean; reachable: boolean | null; ms: number | null; note: string };
  redis: { configured: boolean; ok: boolean | null; ms: number | null };
  /** ok is false in production without a key: the scripted planner is never used there. */
  anthropic: { configured: boolean; ok: boolean; planner: "claude" | "scripted" | "unavailable"; note: string };
  limits: {
    runsPerVisitorPerHour: number;
    replansPerVisitorPerHour: number;
    dailyRuns: number;
    dailyRemaining: number;
    dailyResetsAt: string;
  };
}

/** Qloo is pinged at most this often, so the health route costs almost no quota. */
const QLOO_CHECK_MS = 10 * 60 * 1000;
let lastQloo: { at: number; value: Health["qloo"] } | null = null;

async function checkQloo(env: Record<string, string | undefined>): Promise<Health["qloo"]> {
  if (isMockMode(env)) return { configured: false, reachable: null, ms: null, note: "Mock mode: Qloo is not called." };
  if (!env.QLOO_API_KEY || !env.QLOO_BASE_URL) {
    return { configured: false, reachable: false, ms: null, note: "QLOO_API_KEY or QLOO_BASE_URL is not set." };
  }
  if (lastQloo && Date.now() - lastQloo.at < QLOO_CHECK_MS) return lastQloo.value;

  // Own client with a fresh memory cache, so the check is never answered from the cache.
  const client = createQlooClient({ cache: new MemoryCache(1), budget: 1, timeoutMs: 4000 });
  const started = Date.now();
  let value: Health["qloo"];
  try {
    await client.get("/search", { query: "Takeover health check", take: 1 }, { runId: `health-${started}` });
    value = { configured: true, reachable: true, ms: Date.now() - started, note: "Search answered." };
  } catch (err) {
    const kind = err instanceof QlooError ? err.kind : "error";
    value = { configured: true, reachable: false, ms: Date.now() - started, note: `Search failed (${kind}).` };
  }
  lastQloo = { at: Date.now(), value };
  return value;
}

async function checkRedis(): Promise<Health["redis"]> {
  const redis = getRedis();
  if (!redis) return { configured: false, ok: null, ms: null };
  const started = Date.now();
  try {
    await redis.ping();
    return { configured: true, ok: true, ms: Date.now() - started };
  } catch {
    return { configured: true, ok: false, ms: Date.now() - started };
  }
}

/** Status only: no keys, tokens, URLs or visitor data. */
export async function getHealth(env: Record<string, string | undefined> = process.env): Promise<Health> {
  const [qloo, redis, daily] = await Promise.all([checkQloo(env), checkRedis(), getLimiters().daily.peek(DAILY_ID)]);
  const planner = plannerStatus(env);
  let plannerNote = "Claude plans each run.";
  if (!planner.ok) plannerNote = planner.reason;
  else if (planner.kind === "scripted") plannerNote = "No model key: scripted planner with template wording (not allowed in production).";
  return {
    ok: qloo.reachable !== false && redis.ok !== false && daily.remaining > 0 && planner.ok,
    mock: isMockMode(env),
    checkedAt: new Date().toISOString(),
    qloo,
    redis,
    anthropic: { configured: Boolean(env.ANTHROPIC_API_KEY), ok: planner.ok, planner: planner.kind, note: plannerNote },
    limits: {
      runsPerVisitorPerHour: LIMITS.runsPerHour,
      replansPerVisitorPerHour: LIMITS.replansPerHour,
      dailyRuns: LIMITS.dailyRuns,
      dailyRemaining: daily.remaining,
      dailyResetsAt: new Date(daily.resetAt).toISOString(),
    },
  };
}
