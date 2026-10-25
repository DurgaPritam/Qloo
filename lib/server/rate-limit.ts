import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { getRedis } from "./redis";

export const LIMITS = {
  /** Fresh runs per visitor per hour. */
  runsPerHour: 5,
  /** Resumes and swaps ("Use this partner/city") per visitor per hour; cheap, mostly cached. */
  replansPerHour: 20,
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

function build(name: string, limit: number, window: "1 h" | "1 d" = "1 h"): RateLimiter {
  const memory = new MemoryLimiter(limit, window === "1 h" ? HOUR_MS : DAY_MS);
  const redis = getRedis();
  if (!redis) return memory;
  const ratelimit = new Ratelimit({
    redis,
    limiter: window === "1 h" ? Ratelimit.slidingWindow(limit, window) : Ratelimit.fixedWindow(limit, window),
    prefix: `takeover:rl:${name}`,
    timeout: 1500,
  });
  return new UpstashLimiter(ratelimit, memory);
}

let limiters: { runs: RateLimiter; replans: RateLimiter; daily: RateLimiter } | undefined;

export function getLimiters() {
  limiters ??= {
    runs: build("runs", LIMITS.runsPerHour),
    replans: build("replans", LIMITS.replansPerHour),
    daily: build("daily", LIMITS.dailyRuns, "1 d"),
  };
  return limiters;
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
