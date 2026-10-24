import "server-only";

import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { getRedis } from "./redis";

export const LIMITS = {
  /** Fresh runs per visitor per hour. */
  runsPerHour: 5,
  /** Resumes and swaps ("Use this partner/city") per visitor per hour; cheap, mostly cached. */
  replansPerHour: 20,
} as const;

const HOUR_MS = 60 * 60 * 1000;

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window frees a slot. */
  resetAt: number;
}

export interface RateLimiter {
  check(id: string): Promise<LimitResult>;
}

/** Sliding window in process memory. Used when Redis is absent or failing. */
export class MemoryLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

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
}

function build(name: string, limit: number): RateLimiter {
  const memory = new MemoryLimiter(limit, HOUR_MS);
  const redis = getRedis();
  if (!redis) return memory;
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, "1 h"),
    prefix: `takeover:rl:${name}`,
    timeout: 1500,
  });
  return new UpstashLimiter(ratelimit, memory);
}

let limiters: { runs: RateLimiter; replans: RateLimiter } | undefined;

export function getLimiters() {
  limiters ??= {
    runs: build("runs", LIMITS.runsPerHour),
    replans: build("replans", LIMITS.replansPerHour),
  };
  return limiters;
}

/** The caller's IP, hashed so raw addresses never reach Redis or logs. */
export function visitorId(headers: Headers): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}
