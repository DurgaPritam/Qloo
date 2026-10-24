import { Redis } from "@upstash/redis";

export type QlooParamValue = string | number | boolean | readonly string[] | null | undefined;
export type QlooParams = Record<string, QlooParamValue>;

const CACHE_KEY_PREFIX = "qloo:v1:";

/**
 * Drops empty values, joins arrays with commas and sorts keys, so the same request always
 * produces the same query string, cache key and logged params.
 */
export function normalizeParams(params: QlooParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    const str = Array.isArray(value) ? value.join(",") : String(value);
    if (str === "") continue;
    out[key] = str;
  }
  return out;
}

export function cacheKey(path: string, params: QlooParams): string {
  const query = new URLSearchParams(normalizeParams(params)).toString();
  return `${CACHE_KEY_PREFIX}${path}${query ? `?${query}` : ""}`;
}

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

/** Bounded in-process cache. Oldest entries are evicted first once full. */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export class RedisCache implements CacheStore {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
}

/**
 * Memory first, then the shared store. If the shared store throws, the error is logged and the
 * request carries on with memory only, so a Redis outage never fails a run.
 */
export class TieredCache implements CacheStore {
  constructor(
    private readonly memory: CacheStore,
    private readonly shared?: CacheStore,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const local = await this.memory.get<T>(key);
    if (local !== null || !this.shared) return local;
    try {
      return await this.shared.get<T>(key);
    } catch (err) {
      this.warn(`[qloo] shared cache read failed, using memory: ${describe(err)}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.memory.set(key, value, ttlSeconds);
    if (!this.shared) return;
    try {
      await this.shared.set(key, value, ttlSeconds);
    } catch (err) {
      this.warn(`[qloo] shared cache write failed, using memory: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.name : "unknown error";
}

/** Redis-backed when Upstash env vars are set, memory-only otherwise. */
export function createDefaultCache(env: NodeJS.ProcessEnv = process.env): CacheStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const shared =
    url && token
      ? new RedisCache(
          new Redis({
            url,
            token,
            retry: false,
            signal: () => AbortSignal.timeout(1500),
            enableTelemetry: false,
          }),
        )
      : undefined;
  return new TieredCache(new MemoryCache(), shared);
}
