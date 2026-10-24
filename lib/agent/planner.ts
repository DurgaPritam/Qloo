import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { nextScriptedCalls } from "./script";
import type { RunState } from "./state";
import { anthropicTools } from "./tools";

export const AGENT_MODEL = "claude-sonnet-5-5";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface PlannerReply {
  stopReason: "tool_use" | "end_turn" | "refusal" | "other";
  /** Any text the model wrote alongside its calls. */
  text: string;
  calls: ToolCall[];
  /** The assistant turn to append to the history, unchanged. */
  content: Anthropic.Beta.BetaMessageContentParam;
}

export interface Planner {
  readonly kind: "claude" | "scripted";
  next(messages: readonly Anthropic.Beta.BetaMessageParam[], state: RunState): Promise<PlannerReply>;
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

/** Claude chooses the tools; the loop runs them. */
export class ClaudePlanner implements Planner {
  readonly kind = "claude";
  private readonly tools = anthropicTools();

  constructor(private readonly client: Pick<Anthropic, "beta"> = new Anthropic()) {}

  async next(messages: readonly Anthropic.Beta.BetaMessageParam[]): Promise<PlannerReply> {
    const res = await this.client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: this.tools,
      messages: [...messages],
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      // Re-run on a policy decline with the model Anthropic routes to, inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    const calls: ToolCall[] = [];
    const text: string[] = [];
    for (const block of res.content) {
      if (block.type === "tool_use") {
        const input = block.input && typeof block.input === "object" ? block.input : {};
        calls.push({ id: block.id, name: block.name, input: input as Record<string, unknown> });
      } else if (block.type === "text") {
        text.push(block.text);
      }
    }
    let stopReason: PlannerReply["stopReason"] = "other";
    if (res.stop_reason === "tool_use" || res.stop_reason === "end_turn" || res.stop_reason === "refusal") {
      stopReason = res.stop_reason;
    }
    return { stopReason, text: text.join(" "), calls, content: res.content };
  }
}

/**
 * Follows the seven steps with default inputs and template prose. Used when no Anthropic key
 * is configured, so mock mode and tests run end to end without a model.
 */
export class ScriptedPlanner implements Planner {
  readonly kind = "scripted";
  private turn = 0;

  async next(_messages: readonly Anthropic.Beta.BetaMessageParam[], state: RunState): Promise<PlannerReply> {
    this.turn++;
    const calls = nextScriptedCalls(state).map((c, i) => ({ ...c, id: `scripted_${this.turn}_${i}` }));
    return {
      stopReason: calls.length ? "tool_use" : "end_turn",
      text: "",
      calls,
      content: calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
    };
  }
}

export type PlannerStatus =
  | { ok: true; kind: "claude" | "scripted" }
  | { ok: false; kind: "unavailable"; reason: string };

/**
 * Claude when a key is set. Without one, the scripted planner runs locally and in previews, but
 * never in production: there a missing key is a configuration error, not a quieter plan.
 */
export function plannerStatus(env: Record<string, string | undefined> = process.env): PlannerStatus {
  if (env.ANTHROPIC_API_KEY) return { ok: true, kind: "claude" };
  if (env.VERCEL_ENV === "production") {
    return { ok: false, kind: "unavailable", reason: "ANTHROPIC_API_KEY is not set in production." };
  }
  return { ok: true, kind: "scripted" };
}

export class PlannerConfigError extends Error {
  readonly name = "PlannerConfigError";
}

export function createPlanner(env: Record<string, string | undefined> = process.env): Planner {
  const status = plannerStatus(env);
  if (!status.ok) throw new PlannerConfigError(status.reason);
  return status.kind === "claude" ? new ClaudePlanner() : new ScriptedPlanner();
}
