import "server-only";

import { GoogleGenAI } from "@google/genai";

import { ANTHROPIC_MODEL, AnthropicProvider } from "./anthropic";
import { getTokenBudget, withTokenBudget } from "./budget";
import { GeminiProvider } from "./gemini";
import type { LLMProvider, ProviderName } from "./types";

export type * from "./types";

/** Newest stable Gemini Flash on Google's models page, 22 Oct 2026 (decisions D35). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Output cap for each call, including thinking tokens. */
export const MAX_OUTPUT_TOKENS = { planner: 8192, completion: 2048 } as const;

type Env = Record<string, string | undefined>;

const KEY_ENV: Record<ProviderName, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export type ProviderStatus =
  | { ok: true; provider: ProviderName; model: string; configured: boolean }
  | { ok: false; provider: string; model: null; configured: false; reason: string };

/** LLM_PROVIDER, defaulting to gemini. Never reads more than whether the key is set. */
export function providerStatus(env: Env = process.env): ProviderStatus {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase() || "gemini";
  if (raw !== "gemini" && raw !== "anthropic") {
    return { ok: false, provider: raw, model: null, configured: false, reason: "LLM_PROVIDER must be gemini or anthropic." };
  }
  const model = raw === "gemini" ? env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL : ANTHROPIC_MODEL;
  return { ok: true, provider: raw, model, configured: Boolean(env[KEY_ENV[raw]]?.trim()) };
}

export function keyEnvName(provider: ProviderName): string {
  return KEY_ENV[provider];
}

/** The selected provider with the daily token budget applied, or null when its key is missing. */
export function createProvider(env: Env = process.env): LLMProvider | null {
  const status = providerStatus(env);
  if (!status.ok || !status.configured) return null;
  const provider =
    status.provider === "gemini"
      ? new GeminiProvider(status.model, () => new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }))
      : new AnthropicProvider();
  return withTokenBudget(provider, getTokenBudget(env));
}
