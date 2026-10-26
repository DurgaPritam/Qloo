import "server-only";

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

/**
 * The shared Upstash client, or null when Redis is not configured. Requests time out after
 * 1.5 s so a slow Redis never holds up a run; TAKEOVER_REDIS_TIMEOUT_MS raises it for scripts
 * run from a home connection, where a 400 KB heatmap takes longer to upload.
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
  return Number.isInteger(n) && n > 0 ? n : 1500;
}
