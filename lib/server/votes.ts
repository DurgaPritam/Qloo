import "server-only";

import { isMockMode } from "@/lib/mock-mode";

import { getRedis } from "./redis";

export const VOTE_QUESTIONS = ["partner", "city"] as const;
export type VoteQuestion = (typeof VOTE_QUESTIONS)[number];

/** Long enough for a team to decide; votes expire with the shared plan. */
const TTL_SECONDS = 30 * 24 * 60 * 60;
const key = (runId: string, q: VoteQuestion) => `takeover:votes:v1:${runId}:${q}`;

/** Used without Redis, and always in mock mode. */
const memory = new Map<string, Map<string, string>>();

/**
 * One vote per visitor per question, changeable: the hash maps visitor → option, and counts are
 * derived from it, so a changed vote never double-counts. Visitor ids are already hashed.
 */
export async function castVote(runId: string, q: VoteQuestion, option: string, visitor: string): Promise<Record<string, number>> {
  const redis = isMockMode() ? null : getRedis();
  if (redis) {
    try {
      await redis.hset(key(runId, q), { [visitor]: option });
      await redis.expire(key(runId, q), TTL_SECONDS);
      return countVotes(runId, q);
    } catch {
      // Fall through to memory.
    }
  }
  const m = memory.get(key(runId, q)) ?? new Map<string, string>();
  m.set(visitor, option);
  memory.set(key(runId, q), m);
  return tally(m.values());
}

export async function countVotes(runId: string, q: VoteQuestion): Promise<Record<string, number>> {
  const redis = isMockMode() ? null : getRedis();
  if (redis) {
    try {
      // Upstash parses numeric strings (GeoNames city ids) as numbers; options are strings.
      const all = (await redis.hgetall<Record<string, string | number>>(key(runId, q))) ?? {};
      return tally(Object.values(all).map(String));
    } catch {
      // Fall through to memory.
    }
  }
  return tally(memory.get(key(runId, q))?.values() ?? []);
}

export async function myVote(runId: string, q: VoteQuestion, visitor: string): Promise<string | null> {
  const redis = isMockMode() ? null : getRedis();
  if (redis) {
    try {
      const v = await redis.hget<string | number>(key(runId, q), visitor);
      return v == null ? null : String(v);
    } catch {
      // Fall through to memory.
    }
  }
  return memory.get(key(runId, q))?.get(visitor) ?? null;
}

function tally(options: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of options) out[o] = (out[o] ?? 0) + 1;
  return out;
}
