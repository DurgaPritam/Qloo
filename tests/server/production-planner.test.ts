import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/plan/route";
import { createPlanner, PlannerConfigError, plannerStatus } from "@/lib/agent/planner";
import { getHealth } from "@/lib/server/health";

import { postJson } from "../api/sse";

describe("planner in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never falls back to the scripted planner in production", () => {
    expect(plannerStatus({ VERCEL_ENV: "production" })).toMatchObject({
      ok: false,
      kind: "unavailable",
      provider: "gemini",
      reason: "GEMINI_API_KEY is not set in production.",
    });
    expect(() => createPlanner({ VERCEL_ENV: "production" })).toThrow(PlannerConfigError);
    expect(plannerStatus({ VERCEL_ENV: "preview" })).toMatchObject({ ok: true, kind: "scripted" });
    expect(plannerStatus({})).toMatchObject({ ok: true, kind: "scripted" });
    expect(plannerStatus({ TAKEOVER_MOCK: "1", GEMINI_API_KEY: "k" })).toMatchObject({ ok: true, kind: "scripted" });
    expect(plannerStatus({ VERCEL_ENV: "production", GEMINI_API_KEY: "k" })).toMatchObject({
      ok: true,
      kind: "gemini",
      model: "gemini-3.6-flash",
    });
  });

  it("checks the key of the selected provider, not any key", () => {
    // Gemini selected, only an Anthropic key: still a configuration error.
    expect(plannerStatus({ VERCEL_ENV: "production", LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: "k" })).toMatchObject({
      ok: false,
      reason: "GEMINI_API_KEY is not set in production.",
    });
    expect(plannerStatus({ VERCEL_ENV: "production", LLM_PROVIDER: "anthropic", GEMINI_API_KEY: "k" })).toMatchObject({
      ok: false,
      reason: "ANTHROPIC_API_KEY is not set in production.",
    });
    expect(plannerStatus({ VERCEL_ENV: "production", LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toMatchObject({
      ok: true,
      kind: "anthropic",
    });
    expect(plannerStatus({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "k" })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(plannerStatus({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-other" })).toMatchObject({ model: "gemini-other" });
  });

  it("/api/plan returns a configuration error instead of a scripted plan", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TAKEOVER_MOCK", "");
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "an-anthropic-key-that-must-not-count");
    vi.stubEnv("QLOO_API_KEY", "test-qloo-value");
    vi.stubEnv("QLOO_BASE_URL", "https://qloo.test");

    const res = await POST(postJson("http://localhost/api/plan", { query: "John Mulaney" }, "198.51.100.200"));

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/json/);
    const body = await res.json();
    expect(body).toMatchObject({ code: "planner_unconfigured" });
    expect(body.error).toMatch(/not.*configured|isn't fully configured/i);
    expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
  });

  it("/api/plan returns a configuration error when Qloo credentials are missing", async () => {
    vi.stubEnv("TAKEOVER_MOCK", "");
    vi.stubEnv("QLOO_API_KEY", "");
    vi.stubEnv("QLOO_BASE_URL", "");

    const res = await POST(postJson("http://localhost/api/plan", { query: "John Mulaney" }, "198.51.100.201"));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "qloo_unconfigured", mock: false });
  });

  it("/api/health reports the planner red in production without a key", async () => {
    const h = await getHealth({ VERCEL_ENV: "production" });
    expect(h.llm).toMatchObject({ provider: "gemini", configured: false, ok: false, planner: "unavailable" });
    expect(h.ok).toBe(false);

    const preview = await getHealth({ VERCEL_ENV: "preview", TAKEOVER_MOCK: "1" });
    expect(preview.llm).toMatchObject({ ok: true, planner: "scripted" });
  });
});
