import "server-only";

import { createProvider, keyEnvName, MAX_OUTPUT_TOKENS, providerStatus } from "@/lib/llm";
import type { ChatTurn, LLMProvider, ProviderName, ToolChat, ToolResult } from "@/lib/llm/types";

import { nextScriptedCalls } from "./script";
import type { RunState } from "./state";
import { toolSpecs } from "./tools";

export type { ToolCall } from "@/lib/llm/types";

/** The user's request to start a run, then the results of the previous turn's calls. */
export type PlannerInput = string | readonly ToolResult[];

export interface Planner {
  readonly kind: ProviderName | "scripted";
  next(input: PlannerInput, state: RunState): Promise<ChatTurn>;
}

export const SYSTEM_PROMPT = `You are Takeover, a market-entry agent for anyone with a fanbase. You plan one event by calling tools in this order: resolve_fanbase, choose_format, find_partners, pick_city, plan_room, write_brief, draft_outreach.

Rules:
- Use only tool outputs. Every score, rank, distance and name comes from the tools and is shown by the app. Never state a number.
- If resolve_fanbase reports several matches or a likely misspelling, call ask_user; the run pauses for the user.
- When a tool returns status "fallback", write one short sentence on what happened and what you will do, then continue with the best result. If find_partners says to widen, call it once more with widen=true. If pick_city says city-level data is thin, call it once more with level="region".
- You may call choose_format and find_partners in the same turn. Otherwise call one tool per turn.
- In write_brief and draft_outreach, write prose only and use the placeholders {fanbase}, {partner}, {city}, {venue}, {format} and {sponsors} instead of names. Never mention capacity, dates, prices or availability; the app shows them as "to confirm with the promoter".
- Outreach emails are drafts a person will review and send. Make them warm, brief and specific about why the two audiences overlap.
- Keep any text outside tool calls to one sentence.`;

/** The model chooses the tools; the loop runs them. */
export class LlmPlanner implements Planner {
  readonly kind: ProviderName;
  private chat: ToolChat | null = null;

  constructor(private readonly provider: LLMProvider) {
    this.kind = provider.name;
  }

  async next(input: PlannerInput): Promise<ChatTurn> {
    // A user message starts a new run with a fresh transcript.
    if (typeof input === "string" || !this.chat) {
      this.chat = this.provider.chat({ system: SYSTEM_PROMPT, tools: toolSpecs(), maxOutputTokens: MAX_OUTPUT_TOKENS.planner });
    }
    return this.chat.send(input);
  }
}

/**
 * Follows the seven steps with default inputs and template prose. Used when no model key is
 * configured, so mock mode and tests run end to end without a model.
 */
export class ScriptedPlanner implements Planner {
  readonly kind = "scripted";
  private turn = 0;

  async next(_input: PlannerInput, state: RunState): Promise<ChatTurn> {
    this.turn++;
    const calls = nextScriptedCalls(state).map((c, i) => ({ ...c, id: `scripted_${this.turn}_${i}` }));
    return { stopReason: calls.length ? "tool_use" : "end_turn", text: "", calls, usage: { input: 0, output: 0 } };
  }
}

export type PlannerStatus =
  | { ok: true; kind: ProviderName | "scripted"; provider: string; model: string | null }
  | { ok: false; kind: "unavailable"; provider: string; model: string | null; reason: string };

/**
 * The selected provider (LLM_PROVIDER) when its key is set. Without one, the scripted planner
 * runs locally and in previews, but never in production: there a missing key is a configuration
 * error, not a quieter plan.
 */
export function plannerStatus(env: Record<string, string | undefined> = process.env): PlannerStatus {
  const p = providerStatus(env);
  if (!p.ok) return { ok: false, kind: "unavailable", provider: p.provider, model: null, reason: p.reason };
  if (p.configured) return { ok: true, kind: p.provider, provider: p.provider, model: p.model };
  if (env.VERCEL_ENV === "production") {
    const reason = `${keyEnvName(p.provider)} is not set in production.`;
    return { ok: false, kind: "unavailable", provider: p.provider, model: p.model, reason };
  }
  return { ok: true, kind: "scripted", provider: p.provider, model: null };
}

export class PlannerConfigError extends Error {
  readonly name = "PlannerConfigError";
}

export function createPlanner(env: Record<string, string | undefined> = process.env): Planner {
  const status = plannerStatus(env);
  if (!status.ok) throw new PlannerConfigError(status.reason);
  if (status.kind === "scripted") return new ScriptedPlanner();
  return new LlmPlanner(createProvider(env)!);
}
