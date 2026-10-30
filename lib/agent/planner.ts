import "server-only";

import { createProvider, keyEnvName, MAX_OUTPUT_TOKENS, providerStatus } from "@/lib/llm";
import { isMockMode } from "@/lib/mock-mode";
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
- Sponsors are suggestions from taste data, not confirmed. Never say a sponsor is on board, signed or involved; say they could be a fit.
- If find_partners reports a solo takeover, the user chose no partner: continue with pick_city, never use {partner}, leave partnerReason, partnerSubject and partnerBody empty, and write about the fanbase's own audience.
- Write as the promoter planning the event. Do not name Takeover.
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

export const WRITER_PROMPT = `You write the prose for an event plan made by Takeover, a market-entry agent. Code has already chosen the partner, city, venue and sponsors from Qloo taste data. Call write_brief and draft_outreach, both in this one reply.

Rules:
- Use the placeholders {fanbase}, {partner}, {city}, {venue}, {format} and {sponsors} instead of names. The app fills them in.
- Never state a number. Never mention capacity, dates, prices or availability; the app shows them as "to confirm with the promoter".
- Explain why the two audiences overlap, using what the descriptions say about each. Be specific, not generic.
- Outreach emails are drafts a person will review and send. Make them warm and brief.
- Sponsors are suggestions from taste data, not confirmed. Never say a sponsor is on board, signed or involved; say they could be a fit.
- When the plan says "solo": true, there is no partner. Never use {partner}; leave partnerReason, partnerSubject and partnerBody empty; explain why the city and venue suit the fanbase's own audience.
- Write as the promoter planning the event. Do not name Takeover.`;

const PROSE_TOOLS = ["write_brief", "draft_outreach"];

/** What the writer sees: names, kinds and Qloo's descriptions; no scores. */
export function writerContext(state: RunState): string {
  const room = state.room;
  const short = (text: string | undefined) => (text ? text.slice(0, 300) : undefined);
  return JSON.stringify({
    format: state.format?.label,
    ...(state.partner ? {} : { solo: true }),
    fanbase: { name: state.fanbase?.name, kind: state.fanbase?.category, about: short(state.fanbase?.description) },
    partner: state.partner ? { name: state.partner.name, kind: state.partner.category, about: short(state.partner.description) } : null,
    city: room?.cityName,
    venue: room?.venue ? { name: room.venue.pick.place.name, about: short(room.venue.pick.place.description) } : null,
    opener: room?.opener?.pick.entity.name ?? null,
    sponsors: room?.sponsors.map((s) => s.pick.brand.name) ?? [],
  });
}

/**
 * Code runs the steps in order, as the scripted planner does; the model is called once, to write
 * the brief and both emails. Six model calls per run become one, which keeps free-tier quotas
 * and latency workable (decisions D40).
 */
export class WriterPlanner implements Planner {
  readonly kind: ProviderName;
  private readonly scripted = new ScriptedPlanner();

  constructor(private readonly provider: LLMProvider) {
    this.kind = provider.name;
  }

  async next(input: PlannerInput, state: RunState): Promise<ChatTurn> {
    const turn = await this.scripted.next(input, state);
    if (!turn.calls.some((c) => c.name === "write_brief")) return turn;

    const chat = this.provider.chat({
      system: WRITER_PROMPT,
      tools: toolSpecs().filter((t) => PROSE_TOOLS.includes(t.name)),
      maxOutputTokens: MAX_OUTPUT_TOKENS.planner,
    });
    const ask = state.partner ? "Write the brief and the two emails for this plan" : "Write the brief and the venue email for this solo plan (no partner)";
    const written = await chat.send(`${ask}: ${writerContext(state)}`);
    // Both tools, brief first; one the model skipped runs with template prose.
    const calls = PROSE_TOOLS.map(
      (name, i) => written.calls.find((c) => c.name === name) ?? { id: `writer_${i}`, name, input: {} },
    );
    return { ...written, stopReason: "tool_use", calls };
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
  // Sample data never spends model quota (decisions D42).
  if (isMockMode(env)) return { ok: true, kind: "scripted", provider: p.provider, model: null };
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

/**
 * TAKEOVER_PLANNER=agent lets the model choose every tool (about six calls a run); the default,
 * writer, calls it once for the prose (decisions D40).
 */
export function createPlanner(env: Record<string, string | undefined> = process.env): Planner {
  const status = plannerStatus(env);
  if (!status.ok) throw new PlannerConfigError(status.reason);
  if (status.kind === "scripted") return new ScriptedPlanner();
  const provider = createProvider(env)!;
  return env.TAKEOVER_PLANNER?.trim() === "agent" ? new LlmPlanner(provider) : new WriterPlanner(provider);
}
