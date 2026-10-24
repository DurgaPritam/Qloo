import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/llm-only/route";
import { AGENT_MODEL } from "@/lib/agent/planner";
import { stripUnknownFacts, TO_CONFIRM_SENTENCE } from "@/lib/agent/sanitize";
import { llmOnlyAnswer } from "@/lib/server/llm-only";

import { postJson } from "./sse";

function fakeClient(text: string, stop_reason = "end_turn") {
  const create = vi.fn(async () => ({ stop_reason, content: [{ type: "text", text }] }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const env = { ANTHROPIC_API_KEY: "" };

describe("llmOnlyAnswer", () => {
  it("asks the same model with no tools and flags the answer as unsourced", async () => {
    const { client, create } = fakeClient("Partner: Taylor Swift.\nCity: New York, the biggest market.");
    const answer = await llmOnlyAnswer("Unique query one", { mock: false, client, env });

    expect(answer).toMatchObject({ noSources: true, model: AGENT_MODEL, cached: false });
    expect(answer?.text).toBe("Partner: Taylor Swift.\nCity: New York, the biggest market.");
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("tools");
    expect(params.model).toBe(AGENT_MODEL);
  });

  it("caches by normalised query", async () => {
    const { client, create } = fakeClient("Same answer.");
    await llmOnlyAnswer("Cache Me", { mock: false, client, env });
    const second = await llmOnlyAnswer("  cache me ", { mock: false, client, env });

    expect(second?.cached).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("replaces capacity, date and price claims but keeps the chatbot's wording", async () => {
    const { client } = fakeClient("Try Coldplay in London. The O2 holds 20,000 people.");
    const answer = await llmOnlyAnswer("Unique query two", { mock: false, client, env });

    expect(answer?.text).toBe(`Try Coldplay in London. ${TO_CONFIRM_SENTENCE}`);
  });

  it("returns a labelled sample in mock mode without a key, and nothing outside mock mode", async () => {
    expect(await llmOnlyAnswer("Unique query three", { mock: true, env })).toMatchObject({
      model: "sample",
      mock: true,
      text: expect.stringMatching(/^SAMPLE ANSWER/),
    });
    expect(await llmOnlyAnswer("Unique query four", { mock: false, env })).toBeNull();
  });

  it("handles a refusal", async () => {
    const { client } = fakeClient("", "refusal");
    expect((await llmOnlyAnswer("Unique query five", { mock: false, client, env }))?.text).toBe(
      "The model gave no answer.",
    );
  });
});

describe("stripUnknownFacts", () => {
  it("keeps line breaks", () => {
    expect(stripUnknownFacts("A.\nB. Tickets cost $40.\nC.")).toBe(`A.\nB. ${TO_CONFIRM_SENTENCE}\nC.`);
  });
});

describe("POST /api/llm-only", () => {
  beforeAll(() => {
    vi.stubEnv("TAKEOVER_MOCK", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("answers with the sample in mock mode and validates input", async () => {
    const res = await POST(postJson("http://localhost/api/llm-only", { query: "John Mulaney" }, "192.0.2.10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ noSources: true, mock: true });

    const bad = await POST(postJson("http://localhost/api/llm-only", { query: "" }));
    expect(bad.status).toBe(400);
  });
});
