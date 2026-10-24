import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { BudgetExceededError, QlooError } from "@/lib/qloo/errors";
import type { QlooSource, SourceMeta } from "@/lib/qloo/source";

import { withBudget, type BudgetedSource } from "./budget";
import type { Planner, ToolCall } from "./planner";
import { sanitizeProse, TO_CONFIRM_SENTENCE } from "./sanitize";
import { nextScriptedCalls } from "./script";
import { newRunState, type RunState } from "./state";
import { TOOLS_BY_NAME, type ToolOutcome } from "./tools";
import type { AgentEvent, Overrides, Plan, QlooCallView } from "./types";

export const MAX_TURNS = 8;
/** Bound on code-run steps after the model stops, so a bug cannot loop forever. */
const MAX_FINISH_CALLS = 10;

export interface RunAgentOptions {
  runId: string;
  overrides?: Overrides;
  emit: (event: AgentEvent) => void | Promise<void>;
  source: QlooSource;
  planner: Planner;
  maxTurns?: number;
  budget?: number;
  signal?: AbortSignal;
}

interface Ctx {
  state: RunState;
  source: BudgetedSource;
  opts: { runId: string };
  emit: RunAgentOptions["emit"];
}

/**
 * Runs the agent: the planner picks tools, each tool runs engine code on Qloo data, and an
 * event is emitted before and after every call. Ends on the last step, a pause for the user,
 * the turn cap or the call budget; whatever is missing is finished by code where possible and
 * always labelled.
 */
export async function runAgent(input: { query: string }, options: RunAgentOptions): Promise<Plan> {
  const { runId, planner, signal } = options;
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const state = newRunState(input.query, options.overrides);
  const ctx: Ctx = {
    state,
    source: withBudget(options.source, runId, options.budget),
    opts: { runId },
    emit: options.emit,
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt(input.query, state) }];
  let turns = 0;
  let stopNote: string | null = null;

  while (!finished(state)) {
    if (signal?.aborted) {
      stopNote = "The run was cancelled.";
      break;
    }
    if (turns >= maxTurns) {
      stopNote = `The agent reached its ${maxTurns}-turn cap.`;
      break;
    }
    turns++;

    let reply;
    try {
      reply = await planner.next(messages, state);
    } catch (err) {
      console.error("[agent] planner failed:", err instanceof Error ? err.name : "unknown");
      stopNote = "The planning model was unavailable.";
      break;
    }
    if (reply.stopReason === "refusal") {
      stopNote = "The planning model declined to continue.";
      break;
    }
    if (reply.calls.length === 0) {
      stopNote = "The agent stopped before the last step.";
      break;
    }

    messages.push({ role: "assistant", content: reply.content });
    const note = sanitizeProse(reply.text).text.replace(TO_CONFIRM_SENTENCE, "").trim() || undefined;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of reply.calls) {
      results.push(await runCall(call, ctx, note));
      if (state.stopped) break;
    }
    if (state.stopped || finished(state)) break;
    messages.push({ role: "user", content: results });
  }

  if (!finished(state) && !signal?.aborted) await finishByCode(ctx, stopNote);

  const plan = buildPlan(runId, planner.kind, ctx, turns);
  await ctx.emit({
    step: "final",
    status: plan.status === "complete" ? "done" : plan.status === "needs_input" ? "needs_input" : "fallback",
    summary: finalSummary(plan),
    qlooCall: null,
    data: plan,
    mock: ctx.source.mock,
  });
  return plan;
}

function finished(state: RunState): boolean {
  return state.stopped || state.outreach !== null;
}

function userPrompt(query: string, state: RunState): string {
  const picked = Object.entries(state.overrides).filter(([, v]) => v);
  const overrides = picked.length
    ? ` The user already chose ${picked.map(([k]) => k).join(", ")}; the tools apply those choices.`
    : "";
  return `Plan a takeover for this fanbase: ${JSON.stringify(query.slice(0, 120))}.${overrides}`;
}

async function runCall(call: ToolCall, ctx: Ctx, note?: string): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = TOOLS_BY_NAME.get(call.name);
  const reply = (content: unknown, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: call.id,
    content: JSON.stringify(content),
    is_error: isError,
  });
  if (!tool) return reply({ error: `Unknown tool ${call.name}.` }, true);
  const missing = tool.requires(ctx.state);
  if (missing) return reply({ error: `Not yet: ${missing}.` }, true);

  const mock = ctx.source.mock;
  await ctx.emit({ step: tool.step, status: "running", summary: tool.running(ctx.state), qlooCall: null, note, mock });

  let out: ToolOutcome;
  try {
    out = await tool.run(call.input, ctx);
  } catch (err) {
    out = { status: "error", summary: describeError(err, ctx.state), calls: [] };
  }
  if (out.status === "fallback" || out.status === "error") ctx.state.notes.push(out.summary);

  const calls = out.calls.map(view);
  await ctx.emit({
    step: tool.step,
    status: out.status,
    summary: out.summary,
    qlooCall: calls[0] ?? null,
    qlooCalls: calls,
    data: out.data,
    branch: out.branch,
    mock,
  });
  return reply({ status: out.status, summary: out.summary, data: out.forModel ?? out.data }, out.status === "error");
}

function describeError(err: unknown, state: RunState): string {
  if (err instanceof BudgetExceededError) {
    state.budgetHit = true;
    return `Hit the ${err.limit}-call Qloo budget for this run, so I'm finishing with what I have.`;
  }
  if (err instanceof QlooError) {
    if (err.kind === "rate_limited") return "Qloo is busy right now; this step was skipped.";
    if (err.kind === "not_found") return "Qloo had no data for this request.";
    return "Qloo did not answer in time; this step was skipped.";
  }
  console.error("[agent] tool failed:", err instanceof Error ? err.message : "unknown");
  return "Something went wrong in this step.";
}

function view(meta: SourceMeta): QlooCallView {
  return { endpoint: meta.endpoint, params: meta.params, cached: meta.cached, ms: meta.ms };
}

/**
 * After the planner stops early, runs the remaining steps with default inputs so the user still
 * gets the best plan available. Every step finished this way is labelled.
 */
async function finishByCode(ctx: Ctx, why: string | null): Promise<void> {
  const { state } = ctx;
  let labelled = false;
  for (let i = 0; i < MAX_FINISH_CALLS && !finished(state); i++) {
    const next = nextScriptedCalls(state).filter((c) => !state.budgetHit || !needsQloo(c.name));
    if (next.length === 0) break;
    if (!labelled) {
      state.notes.push(`${why ?? "The agent stopped early."} The remaining steps were finished by code.`);
      labelled = true;
    }
    const before = progress(state);
    for (const call of next) {
      await runCall({ ...call, id: `finish_${i}` }, ctx);
      if (state.stopped) return;
    }
    if (progress(state) === before) break;
  }
}

const QLOO_TOOLS = new Set(["resolve_fanbase", "find_partners", "pick_city", "plan_room"]);
function needsQloo(tool: string): boolean {
  return QLOO_TOOLS.has(tool);
}

function progress(state: RunState): string {
  return [
    state.fanbase?.id,
    state.format?.format,
    state.partners?.picks.length,
    state.partnersWidened,
    state.city?.level,
    state.room?.cityName,
    state.brief?.title,
    state.outreach?.length,
    state.stopped,
  ].join("|");
}

function buildPlan(runId: string, planner: Planner["kind"], ctx: Ctx, turns: number): Plan {
  const { state } = ctx;
  let status: Plan["status"] = "incomplete";
  if (state.outreach) status = "complete";
  else if (state.needsInput && !state.fanbase) status = "needs_input";
  return {
    runId,
    query: state.query,
    mock: ctx.source.mock,
    planner,
    status,
    fanbase: state.fanbase,
    needsInput: state.fanbase ? null : state.needsInput,
    format: state.format,
    partners: state.partners,
    city: state.city,
    room: state.room,
    brief: state.brief,
    outreach: state.outreach,
    notes: [...new Set(state.notes)],
    qlooCalls: ctx.source.used(),
    turns,
  };
}

function finalSummary(plan: Plan): string {
  if (plan.status === "needs_input") return plan.needsInput?.question ?? "Waiting for your pick.";
  if (plan.status === "complete") {
    return `Plan ready: ${plan.brief?.title ?? "see the brief"}.`;
  }
  return "Partial plan: some steps could not finish. Each gap is labelled.";
}
