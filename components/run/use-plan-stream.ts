"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  AgentEvent,
  Brief,
  CityResult,
  Email,
  FormatChoice,
  NeedsInput,
  Overrides,
  PartnerResult,
  Plan,
  QlooCallView,
  RoomResult,
  StepId,
} from "@/lib/agent/types";
import { STEPS } from "@/lib/agent/types";
import type { Entity } from "@/lib/engine/types";

import type { StepStatus } from "../ui";

export interface StepView {
  status: StepStatus;
  liveText?: string;
  decision?: string;
  fallbackText?: string;
  errorText?: string;
  branch?: string;
  calls: QlooCallView[];
  startedAt?: number;
  seconds?: string;
}

export interface RunError {
  kind: "busy" | "network" | "server" | "input";
  message: string;
}

export interface RunView {
  phase: "idle" | "running" | "done";
  steps: Record<StepId, StepView>;
  fanbase: Entity | null;
  format: FormatChoice | null;
  partners: PartnerResult | null;
  city: CityResult | null;
  room: RoomResult | null;
  brief: Brief | null;
  outreach: Email[] | null;
  needsInput: NeedsInput | null;
  plan: Plan | null;
  error: RunError | null;
  mock: boolean;
  /** Set while a "Use this…" replan runs: sections from this step on are dimmed. */
  replanFrom: StepId | null;
}

const ORDER = STEPS.map((s) => s.id);
const blankSteps = () =>
  Object.fromEntries(ORDER.map((id) => [id, { status: "waiting", calls: [] } as StepView])) as Record<StepId, StepView>;

const INITIAL: RunView = {
  phase: "idle",
  steps: blankSteps(),
  fanbase: null,
  format: null,
  partners: null,
  city: null,
  room: null,
  brief: null,
  outreach: null,
  needsInput: null,
  plan: null,
  error: null,
  mock: false,
  replanFrom: null,
};

type Action =
  | { type: "start"; replanFrom: StepId | null }
  | { type: "event"; event: AgentEvent; at: number }
  | { type: "error"; error: RunError }
  | { type: "end" };

const DATA_KEY: Partial<Record<StepId, keyof RunView>> = {
  format: "format",
  partners: "partners",
  city: "city",
  room: "room",
  brief: "brief",
  outreach: "outreach",
};

export function reduce(view: RunView, action: Action): RunView {
  switch (action.type) {
    case "start": {
      if (!action.replanFrom) return { ...INITIAL, phase: "running", steps: blankSteps() };
      const from = ORDER.indexOf(action.replanFrom);
      const steps = { ...view.steps };
      for (const id of ORDER.slice(from)) steps[id] = { status: "waiting", calls: [] };
      return { ...view, phase: "running", steps, error: null, needsInput: null, replanFrom: action.replanFrom };
    }
    case "event":
      return applyEvent(view, action.event, action.at);
    case "error":
      return { ...view, phase: "done", error: action.error, replanFrom: null };
    case "end":
      return view.phase === "running" ? { ...view, phase: "done", replanFrom: null } : view;
  }
}

function applyEvent(view: RunView, e: AgentEvent, at: number): RunView {
  const next: RunView = { ...view, mock: view.mock || e.mock };

  if (e.step === "final") {
    const plan = isPlan(e.data) ? e.data : null;
    if (e.status === "error") {
      const busy = Boolean((e.data as { rateLimited?: boolean } | undefined)?.rateLimited);
      return { ...next, phase: "done", replanFrom: null, error: { kind: busy ? "busy" : "server", message: e.summary } };
    }
    if (!plan) return { ...next, phase: "done", replanFrom: null };
    return {
      ...next,
      phase: "done",
      replanFrom: null,
      plan,
      fanbase: plan.fanbase,
      format: plan.format,
      partners: plan.partners,
      city: plan.city,
      room: plan.room,
      brief: plan.brief,
      outreach: plan.outreach,
      needsInput: plan.needsInput,
    };
  }

  const prev = view.steps[e.step];
  const step: StepView = { ...prev };
  if (e.status === "running") {
    Object.assign(step, { status: "running", liveText: e.summary, startedAt: at, decision: undefined });
  } else {
    const seconds = prev.startedAt ? `${((at - prev.startedAt) / 1000).toFixed(1)}s` : "0.0s";
    step.seconds = seconds;
    step.calls = e.qlooCalls ?? (e.qlooCall ? [e.qlooCall] : []);
    if (e.branch && e.status !== "needs_input") step.branch = e.summary;
    if (e.status === "error") {
      Object.assign(step, { status: "error", errorText: e.summary });
    } else {
      Object.assign(step, {
        status: e.status === "fallback" ? "fallback" : "done",
        decision: e.summary,
        fallbackText: e.fallback ?? (e.status === "fallback" ? e.summary : undefined),
      });
    }
  }
  next.steps = { ...view.steps, [e.step]: step };

  if (e.step === "identify") {
    const data = e.data as { fanbase?: Entity } | NeedsInput | undefined;
    if (data && "fanbase" in data && data.fanbase) next.fanbase = data.fanbase;
    if (e.status === "needs_input") next.needsInput = data as NeedsInput;
  } else if (e.status !== "running" && e.data !== undefined) {
    const key = DATA_KEY[e.step];
    if (key) (next as unknown as Record<string, unknown>)[key] = e.data;
  }
  return next;
}

function isPlan(data: unknown): data is Plan {
  return Boolean(data && typeof data === "object" && "runId" in data && "status" in data);
}

/** POSTs to /api/plan and folds the SSE events into a RunView. */
export function usePlanStream() {
  const [view, dispatch] = useReducer(reduce, INITIAL);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async (query: string, overrides?: Overrides, replanFrom: StepId | null = null) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: "start", replanFrom });

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, overrides }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        dispatch({
          type: "error",
          error: { kind: res.status === 400 ? "input" : "server", message: body?.error ?? "The planner is unavailable." },
        });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          dispatch({ type: "event", event: JSON.parse(line.slice(6)) as AgentEvent, at: performance.now() });
        }
      }
      dispatch({ type: "end" });
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatch({
        type: "error",
        error: { kind: "network", message: err instanceof Error ? "The connection dropped before the plan finished." : String(err) },
      });
    }
  }, []);

  return { view, start };
}

/** A finished plan as a static view, for the share page. */
export function viewFromPlan(plan: Plan): RunView {
  const steps = blankSteps();
  for (const id of ORDER) steps[id] = { status: "done", calls: [] };
  return {
    ...INITIAL,
    phase: "done",
    steps,
    mock: plan.mock,
    plan,
    fanbase: plan.fanbase,
    format: plan.format,
    partners: plan.partners,
    city: plan.city,
    room: plan.room,
    brief: plan.brief,
    outreach: plan.outreach,
    needsInput: plan.needsInput,
  };
}
