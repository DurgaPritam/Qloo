import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/plan/route";
import { createPlanner, PlannerConfigError, plannerStatus } from "@/lib/agent/planner";
import { getHealth } from "@/lib/server/health";

import { postJson } from "../api/sse";

describe("planner in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never falls back to the scripted planner in production", () => {
    expect(plannerStatus({ VERCEL_ENV: "production" })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(() => createPlanner({ VERCEL_ENV: "production" })).toThrow(PlannerConfigError);
    expect(plannerStatus({ VERCEL_ENV: "preview" })).toEqual({ ok: true, kind: "scripted" });
    expect(plannerStatus({})).toEqual({ ok: true, kind: "scripted" });
    expect(plannerStatus({ VERCEL_ENV: "production", ANTHROPIC_API_KEY: "k" })).toEqual({ ok: true, kind: "claude" });
  });

  it("/api/plan returns a configuration error instead of a scripted plan", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TAKEOVER_MOCK", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const res = await POST(postJson("http://localhost/api/plan", { query: "John Mulaney" }, "198.51.100.200"));

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/json/);
    const body = await res.json();
    expect(body).toMatchObject({ code: "planner_unconfigured" });
    expect(body.error).toMatch(/not.*configured|isn't fully configured/i);
    expect(JSON.stringify(body)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("/api/health reports the planner red in production without a key", async () => {
    const h = await getHealth({ VERCEL_ENV: "production" });
    expect(h.anthropic).toMatchObject({ configured: false, ok: false, planner: "unavailable" });
    expect(h.ok).toBe(false);

    const preview = await getHealth({ VERCEL_ENV: "preview", TAKEOVER_MOCK: "1" });
    expect(preview.anthropic).toMatchObject({ ok: true, planner: "scripted" });
  });
});
