import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/plan/route";
import type { AgentEvent, Plan } from "@/lib/agent/types";
import { createRecorder, replay, saveRecording, type Recording } from "@/lib/server/replay";

import { postJson, readEvents } from "../api/sse";

const ev = (step: AgentEvent["step"], status: AgentEvent["status"], mock = false): AgentEvent => ({
  step,
  status,
  summary: `${step} ${status}`,
  qlooCall: null,
  mock,
});
const plan = (mock = false) => ({ runId: "11111111-1111-4111-8111-111111111111", status: "complete", mock }) as unknown as Plan;

function recording(query: string, mock = false, stepMs = 2000): Recording {
  const r = createRecorder(query, (() => {
    let t = 0;
    return () => (t += stepMs);
  })());
  r.emit(ev("identify", "running", mock));
  r.emit(ev("identify", "done", mock));
  r.emit(ev("final", "done", mock));
  return r.finish(plan(mock));
}

describe("replay", () => {
  it("replays every event labelled cachedRun, with gaps clamped", async () => {
    const sleeps: number[] = [];
    const sent: AgentEvent[] = [];
    await replay(recording("Clamp"), (e) => sent.push(e), { sleep: async (ms) => void sleeps.push(ms) });

    expect(sent.map((e) => `${e.step}:${e.status}`)).toEqual(["identify:running", "identify:done", "final:done"]);
    expect(sent.every((e) => e.cachedRun)).toBe(true);
    expect(sleeps.every((ms) => ms <= 900)).toBe(true);
    expect((sent.at(-1)!.data as Plan).cachedRun?.recordedAt).toMatch(/^\d{4}-/);
  });

  it("refuses to store a mock run", async () => {
    await expect(saveRecording(recording("Sample", true))).rejects.toThrow(/mock/);
  });
});

describe("POST /api/plan with a stored run", () => {
  beforeAll(() => {
    vi.stubEnv("TAKEOVER_MOCK", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("replays it instantly and without counting against the visitor limit", async () => {
    await saveRecording(recording("Preloaded Example", false, 10));
    // One more than the hourly visitor limit.
    for (let i = 0; i < 6; i++) {
      const events = await readEvents(await POST(postJson("http://localhost/api/plan", { query: "preloaded example" }, "198.51.100.77")));
      expect(events.at(-1)).toMatchObject({ step: "final", cachedRun: true });
    }
  });
});
