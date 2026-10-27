import "server-only";

import { isMockMode } from "@/lib/mock-mode";

import { getRedis } from "./redis";

/** What gets counted: planned fanbases, cities plans landed in, and overlap pairs checked. */
export type TrendKind = "fanbase" | "city" | "pair";

const TTL_SECONDS = 15 * 24 * 60 * 60;

/** The Monday (UTC) that starts the week containing `now`, as YYYY-MM-DD. */
export function weekOf(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

const key = (kind: TrendKind, week: string) => `takeover:trend:v1:${kind}:${week}`;

/** Counts one use. Names only (members are display strings); never in mock mode. */
export async function recordTrend(kind: TrendKind, member: string, now = Date.now()): Promise<void> {
  const redis = isMockMode() ? null : getRedis();
  if (!redis || !member || member.length > 200) return;
  try {
    const k = key(kind, weekOf(now));
    await redis.zincrby(k, 1, member);
    await redis.expire(k, TTL_SECONDS);
  } catch {
    // Trending is decoration; a failed count is not worth an error.
  }
}

export interface Trend {
  member: string;
  count: number;
}

/** This week's top members, or last week's while this week has none. */
export async function topTrends(kind: TrendKind, limit = 5, now = Date.now()): Promise<Trend[]> {
  const redis = isMockMode() ? null : getRedis();
  if (!redis) return [];
  for (const week of [weekOf(now), weekOf(now - 7 * 24 * 60 * 60 * 1000)]) {
    try {
      const raw = await redis.zrange<(string | number)[]>(key(kind, week), 0, limit - 1, { rev: true, withScores: true });
      const out: Trend[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) out.push({ member: String(raw[i]), count: Number(raw[i + 1]) });
      if (out.length) return out;
    } catch {
      return [];
    }
  }
  return [];
}

/** "A × B" pairs are stored with this separator so either name may contain "×". */
export const PAIR_SEP = " ⨯ ";
