import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/llm-only/route";
import { stripUnknownFacts, TO_CONFIRM_SENTENCE } from "@/lib/agent/sanitize";
import { TokenBudget, TokenBudgetExceededError, withTokenBudget } from "@/lib/llm/budget";
import type { LLMProvider } from "@/lib/llm/types";
import { llmOnlyAnswer, plainText } from "@/lib/server/llm-only";

import { postJson } from "./sse";

function fakeProvider(text: string, refused = false) {
  const complete = vi.fn<LLMProvider["complete"]>(async () => ({
    text,
    refused,
    usage: { input: 50, output: 80 },
  }));
  const chat = vi.fn();
  const provider: LLMProvider = { name: "gemini", model: "gemini-test-flash", chat, complete };
  return { provider, complete, chat };
}

const env = { GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "" };

describe("llmOnlyAnswer", () => {
  it("asks the same model with no tools and flags the answer as unsourced", async () => {
    const { provider, complete, chat } = fakeProvider("Partner: Taylor Swift.\nCity: New York, the biggest market.");
    const answer = await llmOnlyAnswer("Unique query one", { mock: false, provider, env });

    expect(answer).toMatchObject({ noSources: true, model: "gemini-test-flash", cached: false });
    expect(answer?.text).toBe("Partner: Taylor Swift.\nCity: New York, the biggest market.");
    expect(chat).not.toHaveBeenCalled();
    expect(complete.mock.calls[0][1]).toEqual({ maxOutputTokens: 2048 });
  });

  it("caches by normalised query", async () => {
    const { provider, complete } = fakeProvider("Same answer.");
    await llmOnlyAnswer("Cache Me", { mock: false, provider, env });
    const second = await llmOnlyAnswer("  cache me ", { mock: false, provider, env });

    expect(second?.cached).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("replaces capacity, date and price claims but keeps the chatbot's wording", async () => {
    const { provider } = fakeProvider("Try Coldplay in London. The O2 holds 20,000 people.");
    const answer = await llmOnlyAnswer("Unique query two", { mock: false, provider, env });

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
    const { provider } = fakeProvider("", true);
    expect((await llmOnlyAnswer("Unique query five", { mock: false, provider, env }))?.text).toBe(
      "The model gave no answer.",
    );
  });

  it("stops calling the model once today's token budget is spent", async () => {
    const { provider, complete } = fakeProvider("An answer.");
    const budget = new TokenBudget(100, null, () => Date.UTC(2026, 10, 2), new Map());
    const capped = withTokenBudget(provider, budget);

    await llmOnlyAnswer("Unique query six", { mock: false, provider: capped, env });
    expect(await budget.used()).toBe(130);
    await expect(llmOnlyAnswer("Unique query seven", { mock: false, provider: capped, env })).rejects.toBeInstanceOf(
      TokenBudgetExceededError,
    );
    expect(complete).toHaveBeenCalledTimes(1);
    // Cached answers still come back.
    expect(await llmOnlyAnswer("Unique query six", { mock: false, provider: capped, env })).toMatchObject({ cached: true });
  });
});

describe("plainText", () => {
  it("removes Markdown the page would show raw", () => {
    expect(plainText("**Crossover Partner: A24 (Film Studio)**\nBoth share an *indie* look.\n\n## City\n- Los Angeles")).toBe(
      "Crossover Partner: A24 (Film Studio)\nBoth share an indie look.\n\nCity\nLos Angeles",
    );
    expect(plainText("2 * 3 stays")).toBe("2 * 3 stays");
  });
});

describe("stripUnknownFacts", () => {
  it("keeps line breaks", () => {
    expect(stripUnknownFacts("A.\nB. Tickets cost $40.\nC.")).toBe(`A.\nB. ${TO_CONFIRM_SENTENCE}\nC.`);
  });
});

describe("POST /api/llm-only", () => {
  beforeAll(() => vi.stubEnv("TAKEOVER_MOCK", "1"));
  afterAll(() => vi.unstubAllEnvs());

  it("answers with the sample in mock mode and validates input", async () => {
    const res = await POST(postJson("http://localhost/api/llm-only", { query: "John Mulaney" }, "192.0.2.10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ noSources: true, mock: true });

    const bad = await POST(postJson("http://localhost/api/llm-only", { query: "" }));
    expect(bad.status).toBe(400);
  });
});
