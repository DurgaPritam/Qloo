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
    ? // No auto-pipelining: it merged concurrent reads into one HTTP response (14 recordings, about
      // 1.2 MB), which could not arrive inside the timeout. Separate requests run in parallel and
      // the command count is the same.
      new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(timeoutMs(env)), enableTelemetry: false, enableAutoPipelining: false })
    : null;
  return client;
}

function timeoutMs(env: Record<string, string | undefined>): number {
  const n = Number(env.TAKEOVER_REDIS_TIMEOUT_MS);
  return Number.isInteger(n) && n > 0 ? n : 4000;
}
