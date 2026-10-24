import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/plan/route";
import type { Plan } from "@/lib/agent/types";
import { LIMITS } from "@/lib/server/rate-limit";

import { postJson, readEvents } from "./sse";

const URL = "http://localhost/api/plan";

beforeAll(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterAll(() => vi.unstubAllEnvs());

describe("POST /api/plan", () => {
  it("streams step events and a final plan, all marked mock", async () => {
    const res = await POST(postJson(URL, { query: "John Mulaney" }, "198.51.100.1"));

    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("x-run-id")).toMatch(/^[0-9a-f-]{36}$/);
    const events = await readEvents(res);
    const final = events.at(-1)!;
    expect(final.step).toBe("final");
    expect((final.data as Plan).status).toBe("complete");
    expect((final.data as Plan).planner).toBe("scripted");
    expect(events.every((e) => e.mock === true)).toBe(true);
    for (const e of events) {
      expect(Object.keys(e)).toEqual(expect.arrayContaining(["step", "status", "summary", "qlooCall"]));
    }
  });

  it("pauses for input, then resumes with overrides", async () => {
    const first = await readEvents(await POST(postJson(URL, { query: "Mercury" }, "198.51.100.2")));
    const plan = first.at(-1)!.data as Plan;
    expect(first.at(-1)!.status).toBe("needs_input");

    const entityId = plan.needsInput!.choices[0].entityId;
    const second = await readEvents(await POST(postJson(URL, { query: "Mercury", overrides: { entityId } }, "198.51.100.2")));
    expect((second.at(-1)!.data as Plan).status).toBe("complete");
  });

  it("rejects bad input with 400", async () => {
    expect((await POST(postJson(URL, { query: "" }))).status).toBe(400);
    expect((await POST(postJson(URL, { query: "x".repeat(101) }))).status).toBe(400);
    const notJson = new Request(URL, { method: "POST", body: "nope" });
    expect((await POST(notJson)).status).toBe(400);
  });

  it(`limits a visitor to ${LIMITS.runsPerHour} fresh runs an hour with a friendly event`, async () => {
    const ip = "198.51.100.99";
    for (let i = 0; i < LIMITS.runsPerHour; i++) {
      const events = await readEvents(await POST(postJson(URL, { query: "xqzvbn" }, ip)));
      expect(events.at(-1)!.status).not.toBe("error");
    }
    const limited = await readEvents(await POST(postJson(URL, { query: "John Mulaney" }, ip)));

    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ step: "final", status: "error", data: { rateLimited: true } });
    expect(limited[0].summary).toMatch(/cached example/);

    // Replans have their own, looser limit.
    const replan = await readEvents(await POST(postJson(URL, { query: "Mercury", overrides: { entityId: "x" } }, ip)));
    expect(replan.at(-1)!.data).not.toMatchObject({ rateLimited: true });
  });
});
