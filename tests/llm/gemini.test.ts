import type { Content, GenerateContentParameters, GoogleGenAI } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/plan/route";
import { MAX_TURNS, runAgent } from "@/lib/agent/loop";
import { LlmPlanner } from "@/lib/agent/planner";
import { TO_CONFIRM_SENTENCE } from "@/lib/agent/sanitize";
import { toolSpecs } from "@/lib/agent/tools";
import type { AgentEvent } from "@/lib/agent/types";
import { getTokenBudget, TokenBudget, withTokenBudget } from "@/lib/llm/budget";
import { GeminiProvider, geminiDeclarations } from "@/lib/llm/gemini";
import { MockQlooSource } from "@/lib/qloo/mock";

import { postJson, readEvents } from "../api/sse";

type Call = { name: string; args?: Record<string, unknown>; id?: string };

/** A fake Google Gen AI client that answers each turn with the given function calls. */
function fakeGemini(turns: Call[][], opts: { text?: string; usage?: { prompt: number; out: number; thoughts: number } } = {}) {
  const usage = opts.usage ?? { prompt: 1000, out: 50, thoughts: 150 };
  let i = 0;
  const seen: GenerateContentParameters[] = [];
  const generateContent = vi.fn(async (params: GenerateContentParameters) => {
    // Copy what was sent: the provider keeps appending to its own transcript.
    seen.push(structuredClone(params));
    const calls = turns[Math.min(i++, turns.length - 1)];
    return {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { text: "thinking about it", thought: true },
              ...(opts.text ? [{ text: opts.text }] : []),
              ...calls.map((c, j) => ({
                functionCall: { name: c.name, args: c.args ?? {}, ...("id" in c ? {} : { id: `fc_${i}_${j}` }) },
                thoughtSignature: `sig_${i}_${j}`,
              })),
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: usage.prompt, candidatesTokenCount: usage.out, thoughtsTokenCount: usage.thoughts },
    };
  });
  const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
  return { provider: new GeminiProvider("gemini-test-flash", () => client), generateContent, seen };
}

const SEVEN: Call[][] = [
  [{ name: "resolve_fanbase" }],
  [{ name: "choose_format" }, { name: "find_partners" }],
  [{ name: "pick_city" }],
  [{ name: "plan_room" }],
  [
    {
      name: "write_brief",
      args: {
        headline: "{fanbase} meets {partner} in {city}. Doors open at 7pm on 12 March.",
        partnerReason: "Their fans overlap. The venue seats 1,800.",
      },
    },
  ],
  [{ name: "draft_outreach", args: { partnerSubject: "{fanbase} × {partner}", partnerBody: "Hi {partner}, tickets at $45." } }],
];

async function run(planner: LlmPlanner, budget?: number) {
  const events: AgentEvent[] = [];
  const plan = await runAgent(
    { query: "John Mulaney" },
    { runId: "gemini-test", source: new MockQlooSource(), planner, budget, emit: (e) => void events.push(e) },
  );
  return { plan, events };
}

describe("geminiDeclarations", () => {
  it("converts every tool, with JSON schemas only where a tool takes inputs", () => {
    const decls = geminiDeclarations(toolSpecs());

    expect(decls.map((d) => d.name)).toEqual([
      "resolve_fanbase",
      "ask_user",
      "choose_format",
      "find_partners",
      "pick_city",
      "plan_room",
      "write_brief",
      "draft_outreach",
    ]);
    expect(decls.find((d) => d.name === "resolve_fanbase")).not.toHaveProperty("parametersJsonSchema");
    expect(decls.find((d) => d.name === "pick_city")?.parametersJsonSchema).toEqual({
      type: "object",
      properties: {
        country: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. GB." },
        level: { type: "string", enum: ["city", "region"] },
      },
    });
    expect(JSON.stringify(decls)).not.toContain("additionalProperties");
  });
});

describe("GeminiProvider tool-call loop", () => {
  it("runs the seven steps with function calling, a token cap and the model's choices only", async () => {
    const { provider, generateContent, seen } = fakeGemini(SEVEN);
    const { plan } = await run(new LlmPlanner(provider));

    expect(plan).toMatchObject({ status: "complete", planner: "gemini", model: "gemini-test-flash", turns: 6 });
    expect(generateContent).toHaveBeenCalledTimes(6);
    const first = seen[0];
    expect(first.model).toBe("gemini-test-flash");
    expect(first.config).toMatchObject({
      maxOutputTokens: 8192,
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    expect(first.config?.systemInstruction).toEqual(expect.stringContaining("Never state a number"));
    expect((first.config?.tools?.[0] as { functionDeclarations?: unknown[] }).functionDeclarations).toHaveLength(8);
  });

  it("sends the model turn back unchanged and answers each call by id", async () => {
    const { provider, seen } = fakeGemini(SEVEN);
    await run(new LlmPlanner(provider));

    const third = seen[2].contents as Content[];
    // user prompt, model turn 1, results 1, model turn 2, results 2
    expect(third.map((c) => c.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(third[1].parts?.find((p) => p.functionCall)?.thoughtSignature).toBe("sig_1_0");
    expect(third[1].parts?.[0]).toMatchObject({ thought: true });
    const results = third[4].parts!.map((p) => p.functionResponse);
    expect(results.map((r) => [r?.id, r?.name])).toEqual([
      ["fc_2_0", "choose_format"],
      ["fc_2_1", "find_partners"],
    ]);
    expect(results[0]?.response).toHaveProperty("output.status", "done");
  });

  it("omits ids it made up when the model sent none", async () => {
    const { provider, seen } = fakeGemini([[{ name: "resolve_fanbase", id: undefined }], ...SEVEN.slice(1)]);
    await run(new LlmPlanner(provider));

    const response = (seen[1].contents as Content[])[2].parts![0].functionResponse;
    expect(response).toMatchObject({ name: "resolve_fanbase" });
    expect(response).not.toHaveProperty("id");
  });

  it("returns errors for out-of-order calls in the error field", async () => {
    const { provider, seen } = fakeGemini([[{ name: "pick_city" }], []]);
    const { plan } = await run(new LlmPlanner(provider));

    expect((seen[1].contents as Content[])[2].parts![0].functionResponse?.response).toEqual({
      error: { error: "Not yet: find_partners must pick a partner first." },
    });
    expect(plan.notes.some((n) => n.includes("finished by code"))).toBe(true);
  });

  it("keeps prose but numbers, dates and prices become “to confirm with the promoter”", async () => {
    const { provider } = fakeGemini(SEVEN);
    const { plan } = await run(new LlmPlanner(provider));

    const partner = plan.partners!.picks[0].pick.entity.name;
    expect(plan.brief?.headline).toBe(`John Mulaney meets ${partner} in ${plan.room!.cityName}. ${TO_CONFIRM_SENTENCE}`);
    expect(plan.brief?.items[0].reason).toBe(`Their fans overlap. ${TO_CONFIRM_SENTENCE}`);
    expect(plan.outreach?.[0].body).toContain(TO_CONFIRM_SENTENCE);
    expect(plan.outreach?.[0].body).not.toMatch(/\$|45/);
  });

  it("caps the run at 8 turns and finishes the rest by code", async () => {
    const { provider, generateContent } = fakeGemini([[{ name: "resolve_fanbase" }]]);
    const { plan } = await run(new LlmPlanner(provider));

    expect(generateContent).toHaveBeenCalledTimes(MAX_TURNS);
    expect(plan.notes.some((n) => n.includes(`${MAX_TURNS}-turn cap`))).toBe(true);
    expect(plan.status).toBe("complete");
  });

  it("keeps the 25-call Qloo budget", async () => {
    const { provider } = fakeGemini(SEVEN);
    const { plan, events } = await run(new LlmPlanner(provider), 3);

    expect(plan.qlooCalls).toBeLessThanOrEqual(3);
    expect(events.find((e) => e.step === "partners" && e.status === "error")?.summary).toMatch(/3-call Qloo budget/);
  });

  it("treats a blocked answer as a refusal", async () => {
    const generateContent = vi.fn(async () => ({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }));
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const turn = await new GeminiProvider("m", () => client).chat({ system: "s", tools: [], maxOutputTokens: 10 }).send("hi");
    expect(turn).toMatchObject({ stopReason: "refusal", calls: [], usage: { input: 0, output: 0 } });
  });

  it("starts a fresh transcript for each run", async () => {
    const { provider, seen } = fakeGemini(SEVEN);
    const planner = new LlmPlanner(provider);
    await run(planner);
    await run(planner);
    expect(seen[6].contents as Content[]).toHaveLength(1);
  });
});

describe("overloaded models", () => {
  const overloaded = () => Object.assign(new Error("high demand"), { status: 503 });
  const answer = (name: string) => ({
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { id: "a", name, args: {} } }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });

  function client(fn: (model: string) => unknown) {
    const generateContent = vi.fn(async (p: GenerateContentParameters) => fn(p.model));
    return { generateContent, api: { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models"> };
  }

  it("retries once, then moves the run to the fallback model and stays on it", async () => {
    const { generateContent, api } = client((model) => {
      if (model === "main") throw overloaded();
      return answer("resolve_fanbase");
    });
    const sleep = vi.fn(async () => {});
    const chat = new GeminiProvider("main", () => api, { fallbacks: ["backup"], sleep }).chat({ system: "s", tools: [], maxOutputTokens: 10 });

    const first = await chat.send("start");
    expect(first).toMatchObject({ stopReason: "tool_use", model: "backup" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["main", "main", "backup"]);
    expect(sleep).toHaveBeenCalledWith(1000);

    await chat.send([{ id: "a", name: "resolve_fanbase", content: {}, isError: false }]);
    expect(generateContent.mock.calls.at(-1)![0].model).toBe("backup");
  });

  it("does not switch models mid-run; the error reaches the loop, which finishes by code", async () => {
    let calls = 0;
    const { api } = client(() => {
      if (calls++ > 0) throw overloaded();
      return answer("resolve_fanbase");
    });
    const provider = new GeminiProvider("main", () => api, { fallbacks: ["backup"], sleep: async () => {} });
    const { plan } = await run(new LlmPlanner(provider));

    expect(calls).toBe(3);
    expect(plan).toMatchObject({ model: "main", status: "complete" });
    expect(plan.notes.some((n) => n.startsWith("The planning model was unavailable."))).toBe(true);
  });

  it("moves straight to the fallback when a call times out", async () => {
    const { generateContent, api } = client((model) => {
      if (model === "main") throw new DOMException("timed out", "TimeoutError");
      return answer("resolve_fanbase");
    });
    const provider = new GeminiProvider("main", () => api, { fallbacks: ["backup"], sleep: async () => {} });
    expect(await provider.complete("hi", { maxOutputTokens: 10 })).toMatchObject({ model: "backup" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["main", "backup"]);
  });

  it("does not retry other errors", async () => {
    const { generateContent, api } = client(() => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });
    const provider = new GeminiProvider("main", () => api, { fallbacks: ["backup"], sleep: async () => {} });
    await expect(provider.complete("hi", { maxOutputTokens: 10 })).rejects.toThrow("bad request");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe("daily token budget", () => {
  const day = () => Date.UTC(2026, 10, 3, 15);

  it("counts input and output tokens (thinking included) and stops a run once spent", async () => {
    // Each turn: 1000 prompt + 50 output + 150 thinking = 1200 tokens.
    const budget = new TokenBudget(2500, null, day, new Map());
    const { provider, generateContent } = fakeGemini(SEVEN);
    const { plan } = await run(new LlmPlanner(withTokenBudget(provider, budget)));

    expect(await budget.used()).toBe(3600);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(plan.notes.some((n) => n.startsWith("Today's model budget ran out mid-run."))).toBe(true);
    // No more model tokens: the rest is finished by code and labelled.
    expect(plan.status).toBe("complete");
  });

  it("resets at UTC midnight", async () => {
    let now = Date.UTC(2026, 10, 3, 23, 59);
    const budget = new TokenBudget(10, null, () => now, new Map());
    await budget.add({ input: 8, output: 4 });
    expect(await budget.exceeded()).toBe(true);
    expect(budget.resetsAt()).toBe(Date.UTC(2026, 10, 4));
    now = Date.UTC(2026, 10, 4, 0, 1);
    expect(await budget.exceeded()).toBe(false);
  });

  it("uses Redis when configured and falls back to memory when it fails", async () => {
    const store = new Map<string, number>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      incrby: vi.fn(async (k: string, n: number) => {
        store.set(k, (store.get(k) ?? 0) + n);
        return store.get(k)!;
      }),
      expire: vi.fn(async () => 1),
    };
    const budget = new TokenBudget(100, redis as never, day, new Map());
    await budget.add({ input: 30, output: 10 });
    await budget.add({ input: 5, output: 5 });
    expect(await budget.used()).toBe(50);
    expect(redis.expire).toHaveBeenCalledTimes(1);

    redis.get.mockRejectedValueOnce(new Error("down"));
    expect(await budget.used()).toBe(50);
  });

  describe("POST /api/plan when the budget is spent", () => {
    beforeAll(() => {
      vi.stubEnv("TAKEOVER_MOCK", "1");
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-value");
      vi.stubEnv("LLM_DAILY_TOKEN_BUDGET", "1000");
    });
    afterAll(() => vi.unstubAllEnvs());

    it("stops live runs with a friendly message that offers cached examples", async () => {
      await getTokenBudget().add({ input: 900, output: 200 });

      const events = await readEvents(await POST(postJson("http://localhost/api/plan", { query: "John Mulaney" }, "198.51.100.90")));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ step: "final", status: "error", data: { rateLimited: true } });
      expect(events[0].summary).toMatch(/today's AI budget.*cached examples still work/i);
    });
  });
});
