import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { isMockMode } from "@/lib/mock-mode";

import { getRedis } from "./redis";

export const LIMITS = {
  /** Fresh runs per visitor per hour. */
  runsPerHour: 5,
  /** Resumes and swaps ("Use this partner/city") per visitor per hour; cheap, mostly cached. */
  replansPerHour: 20,
  /** Venue booker, Brand match and City explorer lookups per visitor per hour (a few Qloo calls each). */
  toolsPerHour: 30,
  /** Search suggestions per visitor per hour (one Qloo search each, cached for a week). */
  suggestPerHour: 300,
  /** Sign-in links and invitations emailed per visitor per hour. */
  emailsPerHour: 10,
  /** Live runs per day across all visitors. Size it to the Qloo plan with TAKEOVER_DAILY_RUNS. */
  dailyRuns: dailyCeiling(process.env.TAKEOVER_DAILY_RUNS),
} as const;

/**
 * Default 120 live runs a day: about 45,000 spare monthly Qloo calls over the ~22 days to the end
 * of judging is ~2,000 calls a day, at up to 15 calls per uncached run (decisions D16).
 */
function dailyCeiling(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 120;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window frees a slot. */
  resetAt: number;
}

export interface RateLimiter {
  /** Counts one use if allowed. */
  check(id: string): Promise<LimitResult>;
  /** Reads the current state without counting a use. */
  peek(id: string): Promise<LimitResult>;
}

/** Sliding window in process memory. Used when Redis is absent or failing. */
export class MemoryLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async peek(id: string): Promise<LimitResult> {
    const now = this.now();
    const recent = (this.hits.get(id) ?? []).filter((t) => t > now - this.windowMs);
    return {
      ok: recent.length < this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - recent.length),
      resetAt: (recent[0] ?? now) + this.windowMs,
    };
  }

  async check(id: string): Promise<LimitResult> {
    const now = this.now();
    const recent = (this.hits.get(id) ?? []).filter((t) => t > now - this.windowMs);
    const ok = recent.length < this.limit;
    if (ok) recent.push(now);
    this.hits.delete(id);
    this.hits.set(id, recent);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value!);
    return {
      ok,
      limit: this.limit,
      remaining: Math.max(0, this.limit - recent.length),
      resetAt: (recent[0] ?? now) + this.windowMs,
    };
  }
}

class UpstashLimiter implements RateLimiter {
  constructor(
    private readonly ratelimit: Ratelimit,
    private readonly fallback: RateLimiter,
  ) {}

  async check(id: string): Promise<LimitResult> {
    try {
      const r = await this.ratelimit.limit(id);
      return { ok: r.success, limit: r.limit, remaining: r.remaining, resetAt: r.reset };
    } catch {
      console.warn("[rate-limit] Redis unavailable, using memory");
      return this.fallback.check(id);
    }
  }

  async peek(id: string): Promise<LimitResult> {
    try {
      const r = await this.ratelimit.getRemaining(id);
      return { ok: r.remaining > 0, limit: r.limit, remaining: r.remaining, resetAt: r.reset };
    } catch {
      return this.fallback.peek(id);
    }
  }
}

function build(name: string, limit: number, window: "1 m" | "1 h" | "1 d" = "1 h"): RateLimiter {
  const memory = new MemoryLimiter(limit, window === "1 m" ? 60_000 : window === "1 h" ? HOUR_MS : DAY_MS);
  // Sample-data runs (local, tests) never count against the shared limits in Redis (decisions D48).
  const redis = isMockMode() ? null : getRedis();
  if (!redis) return memory;
  const ratelimit = new Ratelimit({
    redis,
    limiter: window === "1 d" ? Ratelimit.fixedWindow(limit, window) : Ratelimit.slidingWindow(limit, window),
    prefix: `takeover:rl:${name}`,
    timeout: 1500,
  });
  return new UpstashLimiter(ratelimit, memory);
}

type Limiters = { runs: RateLimiter; replans: RateLimiter; tools: RateLimiter; suggest: RateLimiter; emails: RateLimiter; daily: RateLimiter };
const limiters: Partial<Limiters> = {};

/** Each limiter is built on first use, so one added later is never missing (a dev hot reload kept the old set). */
export function getLimiters(): Limiters {
  limiters.runs ??= build("runs", LIMITS.runsPerHour);
  limiters.replans ??= build("replans", LIMITS.replansPerHour);
  limiters.tools ??= build("tools", LIMITS.toolsPerHour);
  limiters.suggest ??= build("suggest", LIMITS.suggestPerHour);
  limiters.emails ??= build("emails", LIMITS.emailsPerHour);
  limiters.daily ??= build("daily", LIMITS.dailyRuns, "1 d");
  return limiters as Limiters;
}

const apiLimiters = new Map<string, RateLimiter>();

/** Public API: requests per minute per key, one limiter per tier's limit. */
export function apiLimiter(perMinute: number): RateLimiter {
  const key = String(perMinute);
  if (!apiLimiters.has(key)) apiLimiters.set(key, build(`api:${key}`, perMinute, "1 m"));
  return apiLimiters.get(key)!;
}

/** The daily ceiling is one shared bucket for every visitor. */
export const DAILY_ID = "all-visitors";

/** The caller's IP, hashed so raw addresses never reach Redis or logs. */
export function visitorId(headers: Headers): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

/**
 * End-to-end tests send x-takeover-e2e with TAKEOVER_E2E_TOKEN to skip the per-visitor limits
 * (the daily ceiling still applies). Off unless the token is set on the deployment.
 */
export function isE2eRequest(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const token = env.TAKEOVER_E2E_TOKEN;
  const sent = headers.get("x-takeover-e2e");
  if (!token || token.length < 16 || !sent) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
