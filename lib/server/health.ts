import "server-only";

import { plannerStatus } from "@/lib/agent/planner";
import { getTokenBudget } from "@/lib/llm/budget";
import { isMockMode } from "@/lib/mock-mode";
import { MemoryCache } from "@/lib/qloo/cache";
import { createQlooClient, lastQuota } from "@/lib/qloo/client";
import { QlooError } from "@/lib/qloo/errors";

import { DAILY_ID, getLimiters, LIMITS } from "./rate-limit";
import { getRedis } from "./redis";

export interface Health {
  ok: boolean;
  mock: boolean;
  checkedAt: string;
  qloo: {
    configured: boolean;
    reachable: boolean | null;
    ms: number | null;
    note: string;
    /** Monthly quota left, from the last response this server saw; null before any call. */
    quotaRemaining: number | null;
    quotaLimit: number | null;
  };
  redis: { configured: boolean; ok: boolean | null; ms: number | null };
  /**
   * The planning model. ok is false in production without the selected provider's key (the
   * scripted planner is never used there) and once today's token budget is spent.
   */
  llm: {
    provider: string;
    model: string | null;
    configured: boolean;
    ok: boolean;
    planner: "gemini" | "anthropic" | "scripted" | "unavailable";
    note: string;
    tokensToday: number;
    tokenBudget: number;
    tokensResetAt: string;
  };
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
let lastQloo: { at: number; value: QlooCheck } | null = null;

type QlooCheck = Omit<Health["qloo"], "quotaRemaining" | "quotaLimit">;

async function checkQloo(env: Record<string, string | undefined>): Promise<QlooCheck> {
  if (isMockMode(env)) return { configured: false, reachable: null, ms: null, note: "Mock mode: Qloo is not called." };
  if (!env.QLOO_API_KEY?.trim() || !env.QLOO_BASE_URL?.trim()) {
    return { configured: false, reachable: false, ms: null, note: "QLOO_API_KEY or QLOO_BASE_URL is not set." };
  }
  if (lastQloo && Date.now() - lastQloo.at < QLOO_CHECK_MS) return lastQloo.value;

  // Own client with a fresh memory cache, so the check is never answered from the cache.
  const client = createQlooClient({ cache: new MemoryCache(1), budget: 1, timeoutMs: 4000 });
  const started = Date.now();
  let value: QlooCheck;
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
  const budget = getTokenBudget(env);
  const [check, redis, daily, tokensToday] = await Promise.all([
    checkQloo(env),
    checkRedis(),
    getLimiters().daily.peek(DAILY_ID),
    budget.used(),
  ]);
  const qloo: Health["qloo"] = { ...check, quotaRemaining: lastQuota.remaining ?? null, quotaLimit: lastQuota.limit ?? null };
  const planner = plannerStatus(env);
  const withinBudget = tokensToday < budget.limit;
  let plannerNote = `${planner.model} plans each run.`;
  if (!planner.ok) plannerNote = planner.reason;
  else if (planner.kind === "scripted") plannerNote = "No model key: scripted planner with template wording (not allowed in production).";
  else if (!withinBudget) plannerNote = "Today's token budget is spent: live runs are paused until it resets; cached examples still work.";
  const llmOk = planner.ok && (planner.kind === "scripted" || withinBudget);
  return {
    ok: qloo.reachable !== false && redis.ok !== false && daily.remaining > 0 && llmOk,
    mock: isMockMode(env),
    checkedAt: new Date().toISOString(),
    qloo,
    redis,
    llm: {
      provider: planner.provider,
      model: planner.model,
      configured: planner.kind !== "scripted" && planner.kind !== "unavailable",
      ok: llmOk,
      planner: planner.kind,
      note: plannerNote,
      tokensToday,
      tokenBudget: budget.limit,
      tokensResetAt: new Date(budget.resetsAt()).toISOString(),
    },
    limits: {
      runsPerVisitorPerHour: LIMITS.runsPerHour,
      replansPerVisitorPerHour: LIMITS.replansPerHour,
      dailyRuns: LIMITS.dailyRuns,
      dailyRemaining: daily.remaining,
      dailyResetsAt: new Date(daily.resetAt).toISOString(),
    },
  };
}
