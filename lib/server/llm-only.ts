import "server-only";

import { createHash } from "node:crypto";

import { stripUnknownFacts } from "@/lib/agent/sanitize";
import { createProvider, MAX_OUTPUT_TOKENS } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";

import { getRedis } from "./redis";

export interface LlmOnlyAnswer {
  text: string;
  /** Always true: this answer uses no Qloo data and cites nothing. */
  noSources: true;
  model: string;
  cached: boolean;
  mock: boolean;
}

const TTL_SECONDS = 7 * 24 * 60 * 60;
const memory = new Map<string, Omit<LlmOnlyAnswer, "cached">>();

export const LLM_ONLY_PROMPT = (query: string) =>
  `I want to plan a crossover event for fans of ${JSON.stringify(query)}. Suggest one crossover ` +
  `partner from a different category (artist, comedian, film, podcast, TV show or brand) and the ` +
  `best city for the event. Give one or two sentences of reasoning for each. Do not give ` +
  `capacity, dates or prices.`;

const SAMPLE_ANSWER =
  "SAMPLE ANSWER (no model key configured): a plain chatbot typically suggests a famous " +
  "partner everyone has heard of and the largest city it can think of, with reasoning that " +
  "would fit any fanbase and no sources.";

/**
 * What a plain chatbot answers with no tools and no taste data, for the "LLM only" toggle.
 * Cached by normalised query. Without a model key, mock mode gets a labelled sample. Throws
 * TokenBudgetExceededError once today's token budget is spent (cached answers still return).
 */
export async function llmOnlyAnswer(
  query: string,
  {
    mock,
    provider,
    env = process.env,
  }: { mock: boolean; provider?: LLMProvider | null; env?: Record<string, string | undefined> },
): Promise<LlmOnlyAnswer | null> {
  const key = `takeover:llm:v1:${createHash("sha256").update(query.trim().toLowerCase()).digest("hex").slice(0, 32)}`;

  const local = memory.get(key);
  if (local) return { ...local, cached: true };
  const redis = getRedis(env);
  if (redis) {
    try {
      const hit = await redis.get<Omit<LlmOnlyAnswer, "cached">>(key);
      if (hit) return { ...hit, cached: true };
    } catch {
      // Redis down: answer live.
    }
  }

  const model = provider === undefined ? createProvider(env) : provider;
  if (!model) {
    return mock ? { text: SAMPLE_ANSWER, noSources: true, model: "sample", cached: false, mock } : null;
  }

  const res = await model.complete(LLM_ONLY_PROMPT(query), { maxOutputTokens: MAX_OUTPUT_TOKENS.completion });
  const answer = {
    text: res.refused || !res.text ? "The model gave no answer." : stripUnknownFacts(res.text),
    noSources: true as const,
    model: res.model ?? model.model,
    mock,
  };

  memory.set(key, answer);
  if (memory.size > 500) memory.delete(memory.keys().next().value!);
  if (redis) {
    try {
      await redis.set(key, answer, { ex: TTL_SECONDS });
    } catch {
      // Cached in memory only.
    }
  }
  return { ...answer, cached: false };
}
