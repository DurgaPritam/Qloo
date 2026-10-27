import "server-only";

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

/**
 * The shared Upstash client, or null when Redis is not configured. Requests time out after
 * 4 s: a cached 400 KB heatmap took longer than 1.5 s to read, and the live fallback for a big
 * fanbase's heatmap can take 20 s. TAKEOVER_REDIS_TIMEOUT_MS raises it for scripts.
 */
export function getRedis(env: Record<string, string | undefined> = process.env): Redis | null {
  if (client !== undefined) return client;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token
    ? new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(timeoutMs(env)), enableTelemetry: false })
    : null;
  return client;
}

function timeoutMs(env: Record<string, string | undefined>): number {
  const n = Number(env.TAKEOVER_REDIS_TIMEOUT_MS);
  return Number.isInteger(n) && n > 0 ? n : 4000;
}
