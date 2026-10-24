import "server-only";

import { createHash } from "node:crypto";

import type { AgentEvent, Plan } from "@/lib/agent/types";

import { getRedis } from "./redis";

/** A finished run as it streamed: events with their offsets from the start, in ms. */
export interface Recording {
  query: string;
  recordedAt: string;
  events: Array<{ at: number; event: AgentEvent }>;
  plan: Plan;
}

/** Replays keep the original rhythm but never drag: each gap is clamped to this range. */
const MIN_GAP_MS = 120;
const MAX_GAP_MS = 900;

const memory = new Map<string, Recording>();
export const recordingKey = (query: string) =>
  `takeover:replay:v1:${createHash("sha256").update(query.trim().toLowerCase()).digest("hex").slice(0, 32)}`;

/** Captures a live run so it can be stored as a preloaded example (scripts/warm-cache.ts). */
export function createRecorder(query: string, now: () => number = Date.now) {
  const started = now();
  const events: Recording["events"] = [];
  return {
    emit: (event: AgentEvent) => void events.push({ at: now() - started, event }),
    finish: (plan: Plan): Recording => ({ query, recordedAt: new Date(started).toISOString(), events, plan }),
  };
}

/**
 * Stores a recording with no expiry. Refuses sample data: mock runs must never reach Redis or
 * pass for a cached Qloo run.
 */
export async function saveRecording(rec: Recording): Promise<void> {
  if (rec.plan.mock || rec.events.some((e) => e.event.mock)) throw new Error("Refusing to store a mock run.");
  memory.set(recordingKey(rec.query), rec);
  await getRedis()?.set(recordingKey(rec.query), rec);
}

export async function loadRecording(query: string): Promise<Recording | null> {
  const key = recordingKey(query);
  const local = memory.get(key);
  if (local) return local;
  try {
    return (await getRedis()?.get<Recording>(key)) ?? null;
  } catch {
    return null;
  }
}

/** Waits between events like the original run did, clamped, and labels every event as cached. */
export async function replay(
  rec: Recording,
  send: (e: AgentEvent) => void,
  { signal, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  let last = 0;
  for (const { at, event } of rec.events) {
    if (signal?.aborted) return;
    const gap = Math.min(MAX_GAP_MS, Math.max(event.status === "running" ? 0 : MIN_GAP_MS, at - last));
    last = at;
    if (gap > 0) await sleep(gap);
    const labelled: AgentEvent = { ...event, cachedRun: true };
    if (event.step === "final") labelled.data = { ...rec.plan, cachedRun: { recordedAt: rec.recordedAt } } satisfies Plan;
    send(labelled);
  }
}
