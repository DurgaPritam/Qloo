import { describe, expect, it } from "vitest";

import { aiEdit, parseModelOps, resolveCityName, sampleOps } from "@/lib/itinerary/ai-edit";
import type { LLMProvider } from "@/lib/llm/types";

import { stop, tour } from "./fixture";

const fake = (text: string, refused = false): LLMProvider => ({
  name: "gemini",
  model: "fake",
  chat: () => {
    throw new Error("not used");
  },
  complete: async () => ({ text, refused, usage: { input: 1, output: 1 } }),
});
const base = () => tour([stop("chicago"), stop("denver")], { startDate: "2027-03-01" });

describe("the AI edit", () => {
  it("reads ops from bare, fenced or wrapped JSON", () => {
    expect(parseModelOps('{"ops":[{"op":"rename","name":"x"}]}')).toEqual([{ op: "rename", name: "x" }]);
    expect(parseModelOps('Sure:\n```json\n{"ops":[]}\n```')).toEqual([]);
    expect(parseModelOps('[{"op":"rename","name":"x"}]')).toEqual([{ op: "rename", name: "x" }]);
    expect(parseModelOps("I can't do that")).toBeNull();
  });

  it("checks the model's ops and builds the summary in code", async () => {
    const r = await aiEdit(base(), "remove Denver and push everything back a week", {
      provider: fake('{"ops":[{"op":"remove_stop","city":"Denver"},{"op":"shift_dates","days":7},{"op":"set_shows","city":"Chicago","shows":4}]}'),
      mock: false,
      today: "2026-10-30",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.ops.map((o) => o.op)).toEqual(["remove_stop", "shift_dates"]);
    expect(r.rejected).toHaveLength(1);
    expect(r.summary).toBe("2 changes: Removed Denver; Moved every date you set 7 days later. 1 not applied.");
  });

  it("falls back, labelled, with no model, a refusal or unreadable output", async () => {
    const opts = { mock: false, today: "2026-10-30" };
    expect(await aiEdit(base(), "remove Denver", { ...opts, provider: null })).toMatchObject({ status: "fallback", reason: expect.stringMatching(/No AI model is configured\. The AI edit didn't run/) });
    expect(await aiEdit(base(), "remove Denver", { ...opts, provider: fake("", true) })).toMatchObject({ status: "fallback" });
    expect(await aiEdit(base(), "remove Denver", { ...opts, provider: fake("no json here") })).toMatchObject({ status: "fallback", reason: expect.stringMatching(/couldn't be read/) });
  });

  it("in sample mode without a model, reads a couple of phrasings deterministically", async () => {
    expect(sampleOps("push everything back two weeks")).toEqual([{ op: "shift_dates", days: 14 }]);
    expect(sampleOps("remove Denver")).toEqual([{ op: "remove_stop", city: "Denver" }]);
    const r = await aiEdit(base(), "remove Denver", { provider: null, mock: true, today: "2026-10-30" });
    expect(r).toMatchObject({ status: "ok", model: "sample" });
  });

  it("resolves a town the metro list folds into a bigger city as itself", () => {
    expect(resolveCityName("Boulder")).toMatchObject({ status: "matched", city: { name: "Boulder", admin1: "Colorado" } });
    expect(resolveCityName("Seatle")).toMatchObject({ status: "matched", city: { name: "Seattle" } });
    expect(resolveCityName("Qwxyzzy")).toEqual({ status: "unmatched" });
  });
});
