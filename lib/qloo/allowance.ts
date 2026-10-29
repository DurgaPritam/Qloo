import "server-only";

import type { Redis } from "@upstash/redis";

import { isMockMode } from "@/lib/mock-mode";
import { getRedis } from "@/lib/server/redis";
import { tierAllowance as defaultTierAllowance } from "@/lib/workspace/tier";

/**
 * The two Qloo limits on top of the per-run cap (docs/roadmap-rules.md, rule 4):
 * - a global daily cap on uncached calls across the whole deployment (QLOO_DAILY_CALL_CAP);
 * - a monthly allowance per workspace, from its plan tier (lib/entitlements.ts), lowered by
 *   QLOO_WORKSPACE_MONTHLY_CALLS when an operator sets that ceiling.
 * Jobs may not use the last QLOO_JOB_RESERVE calls of the daily cap. Cache hits are never counted.
 */
export type QlooScope =
  | { kind: "visitor" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "job"; workspaceId: string };

export type QlooLimit = "daily" | "workspace" | "job_reserve";

export const DEFAULT_WORKSPACE_MONTHLY_CALLS = 500;

export interface AllowanceConfig {
  /** Null: no global cap. */
  dailyCap: number | null;
  jobReserve: number;
  /** Used when a workspace's tier allowance is unknown (no resolver, or an unknown workspace). */
  workspaceMonthly: number;
  /** The operator's ceiling on every workspace's allowance; null when unset. */
  workspaceCeiling?: number | null;
}

type Env = Record<string, string | undefined>;

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return v?.trim() && Number.isInteger(n) && n >= 0 ? n : null;
};

export function allowanceConfig(env: Env = process.env): AllowanceConfig {
  const dailyCap = positive(env.QLOO_DAILY_CALL_CAP);
  return {
    dailyCap,
    // A tenth of the cap when unset, so jobs never take the last calls of the day from people.
    jobReserve: positive(env.QLOO_JOB_RESERVE) ?? (dailyCap ? Math.ceil(dailyCap / 10) : 0),
    workspaceMonthly: positive(env.QLOO_WORKSPACE_MONTHLY_CALLS) ?? DEFAULT_WORKSPACE_MONTHLY_CALLS,
    workspaceCeiling: positive(env.QLOO_WORKSPACE_MONTHLY_CALLS),
  };
}

export const dayKey = (now: Date) => `qloo:daily:${now.toISOString().slice(0, 10)}`;
export const monthKey = (workspaceId: string, now: Date) => `qloo:ws:${workspaceId}:${now.toISOString().slice(0, 7)}`;

export interface Charge {
  dailyKey: string;
  dailyCap: number | null;
  /** Daily calls that must stay free after this one (the job reserve), 0 otherwise. */
  dailyKeep: number;
  workspaceKey: string | null;
  workspaceCap: number;
}

export type ChargeResult = { ok: true } | { ok: false; limit: QlooLimit; cap: number };

/** Counts calls atomically: either every counter is incremented or none is. */
export interface CounterStore {
  charge(c: Charge): Promise<ChargeResult>;
  read(key: string): Promise<number>;
}

/** In-process counters, for local runs, mock mode and tests. */
export class MemoryCounters implements CounterStore {
  private readonly counts = new Map<string, number>();

  async charge(c: Charge): Promise<ChargeResult> {
    const daily = this.counts.get(c.dailyKey) ?? 0;
    const refused = refusal(c, daily, c.workspaceKey ? (this.counts.get(c.workspaceKey) ?? 0) : 0);
    if (refused) return refused;
    this.counts.set(c.dailyKey, daily + 1);
    if (c.workspaceKey) this.counts.set(c.workspaceKey, (this.counts.get(c.workspaceKey) ?? 0) + 1);
    return { ok: true };
  }

  async read(key: string): Promise<number> {
    return this.counts.get(key) ?? 0;
  }
}

function refusal(c: Charge, daily: number, workspace: number): ChargeResult | null {
  if (c.dailyCap !== null) {
    if (daily >= c.dailyCap) return { ok: false, limit: "daily", cap: c.dailyCap };
    if (c.dailyKeep > 0 && c.dailyCap - daily <= c.dailyKeep) return { ok: false, limit: "job_reserve", cap: c.dailyCap - c.dailyKeep };
  }
  if (c.workspaceKey && workspace >= c.workspaceCap) return { ok: false, limit: "workspace", cap: c.workspaceCap };
  return null;
}

/**
 * Checks every limit, then increments, in one script, so parallel calls cannot overshoot.
 * Returns 0 when charged, else 1 (daily), 2 (job reserve) or 3 (workspace).
 */
const CHARGE_SCRIPT = `
local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
local cap = tonumber(ARGV[1])
local keep = tonumber(ARGV[2])
if cap >= 0 then
  if daily >= cap then return 1 end
  if keep > 0 and cap - daily <= keep then return 2 end
end
if KEYS[2] ~= '' then
  local ws = tonumber(redis.call('GET', KEYS[2]) or '0')
  if ws >= tonumber(ARGV[3]) then return 3 end
  redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], 3024000)
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 172800)
return 0`;

export class RedisCounters implements CounterStore {
  constructor(private readonly redis: Redis) {}

  async charge(c: Charge): Promise<ChargeResult> {
    const code = await this.redis.eval<string[], number>(
      CHARGE_SCRIPT,
      [c.dailyKey, c.workspaceKey ?? ""],
      [String(c.dailyCap ?? -1), String(c.dailyKeep), String(c.workspaceCap)],
    );
    if (code === 1) return { ok: false, limit: "daily", cap: c.dailyCap ?? 0 };
    if (code === 2) return { ok: false, limit: "job_reserve", cap: (c.dailyCap ?? 0) - c.dailyKeep };
    if (code === 3) return { ok: false, limit: "workspace", cap: c.workspaceCap };
    return { ok: true };
  }

  async read(key: string): Promise<number> {
    return Number((await this.redis.get<number | string>(key)) ?? 0) || 0;
  }
}

/** On globalThis: route handlers are separate bundles, and the counts must be shared. */
const shared = globalThis as typeof globalThis & { __takeoverCounters?: CounterStore };

/** Redis when configured (never in mock mode), else in-process counters. */
export function defaultCounters(): CounterStore {
  if (shared.__takeoverCounters) return shared.__takeoverCounters;
  const redis = isMockMode() ? null : getRedis();
  shared.__takeoverCounters = redis ? new RedisCounters(redis) : new MemoryCounters();
  return shared.__takeoverCounters;
}

/** The workspace's cap: its tier's allowance when known, never above the operator's ceiling. */
export function workspaceCap(config: AllowanceConfig, tierAllowance: number | null | undefined): number {
  const base = tierAllowance ?? config.workspaceMonthly;
  return config.workspaceCeiling != null ? Math.min(base, config.workspaceCeiling) : base;
}

/** The counters a call in this scope is charged to. */
export function chargeFor(scope: QlooScope, config: AllowanceConfig, now: Date, tierAllowance?: number | null): Charge {
  const workspaceId = scope.kind === "visitor" ? null : scope.workspaceId;
  return {
    dailyKey: dayKey(now),
    dailyCap: config.dailyCap,
    dailyKeep: scope.kind === "job" ? config.jobReserve : 0,
    workspaceKey: workspaceId ? monthKey(workspaceId, now) : null,
    workspaceCap: workspaceCap(config, tierAllowance),
  };
}

export interface WorkspaceUsage {
  used: number;
  allowance: number;
  remaining: number;
  /** Calls left today across the deployment; null when there is no daily cap. */
  dailyRemaining: number | null;
  /** The same for jobs, which leave the reserve untouched. */
  jobDailyRemaining: number | null;
}

export async function workspaceUsage(
  workspaceId: string,
  deps: { counters?: CounterStore; env?: Env; now?: Date; tierAllowance?: (workspaceId: string) => Promise<number | null> } = {},
): Promise<WorkspaceUsage> {
  const counters = deps.counters ?? defaultCounters();
  const config = allowanceConfig(deps.env);
  const allowance = workspaceCap(config, await (deps.tierAllowance ?? defaultTierAllowance)(workspaceId));
  const now = deps.now ?? new Date();
  const [used, daily] = await Promise.all([counters.read(monthKey(workspaceId, now)), counters.read(dayKey(now))]);
  const dailyRemaining = config.dailyCap === null ? null : Math.max(0, config.dailyCap - daily);
  return {
    used,
    allowance,
    remaining: Math.max(0, allowance - used),
    dailyRemaining,
    jobDailyRemaining: dailyRemaining === null ? null : Math.max(0, dailyRemaining - config.jobReserve),
  };
}
