import "server-only";

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

/** The shared Upstash client, or null when Redis is not configured. */
export function getRedis(env: Record<string, string | undefined> = process.env): Redis | null {
  if (client !== undefined) return client;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token
    ? new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(1500), enableTelemetry: false })
    : null;
  return client;
}
