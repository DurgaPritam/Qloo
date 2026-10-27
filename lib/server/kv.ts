import "server-only";

import { isMockMode } from "@/lib/mock-mode";

import { getRedis } from "./redis";

/** On globalThis: route handlers and pages are separate bundles (as in plan-store.ts). */
const store = globalThis as typeof globalThis & { __takeoverKv?: Map<string, { value: unknown; expiresAt: number }> };
const memory = (store.__takeoverKv ??= new Map());

/** A JSON value with an expiry, in Redis when configured (never in mock mode), else in memory. */
export async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (memory.size > 500) memory.delete(memory.keys().next().value!);
  const redis = isMockMode() ? null : getRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    console.warn("[kv] Redis write failed; kept in memory only");
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const local = memory.get(key);
  if (local && local.expiresAt > Date.now()) return local.value as T;
  const redis = isMockMode() ? null : getRedis();
  if (!redis) return null;
  try {
    return ((await redis.get<T>(key)) ?? null) as T | null;
  } catch {
    return null;
  }
}
