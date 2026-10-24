import { describe, expect, it } from "vitest";

import { scorePartners } from "@/lib/engine/partners";
import { assertMockAllowed, isMockMode } from "@/lib/mock-mode";
import { NOT_IMPLEMENTED, QlooApiSource } from "@/lib/qloo/api";
import { MockQlooSource } from "@/lib/qloo/mock";
import { getQlooSource, type QlooSource } from "@/lib/qloo/source";

const run = { runId: "run-1" };

describe("mock mode guard", () => {
  it("is on only for TAKEOVER_MOCK=1", () => {
    expect(isMockMode({ TAKEOVER_MOCK: "1" })).toBe(true);
    expect(isMockMode({ TAKEOVER_MOCK: "true" })).toBe(false);
    expect(isMockMode({})).toBe(false);
  });

  it("refuses mock mode in Vercel production only", () => {
    expect(() => assertMockAllowed({ TAKEOVER_MOCK: "1", VERCEL_ENV: "production" })).toThrow(
      /not allowed/,
    );
    expect(() => assertMockAllowed({ TAKEOVER_MOCK: "1", VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertMockAllowed({ VERCEL_ENV: "production" })).not.toThrow();
  });

  it("getQlooSource picks the source from the env", () => {
    expect(getQlooSource({ TAKEOVER_MOCK: "1" })).toBeInstanceOf(MockQlooSource);
    expect(getQlooSource({})).toBeInstanceOf(QlooApiSource);
    expect(() => getQlooSource({ TAKEOVER_MOCK: "1", VERCEL_ENV: "production" })).toThrow();
  });
});

describe("QlooApiSource", () => {
  it("is a stub until the probe runs", async () => {
    await expect(new QlooApiSource().searchEntities()).rejects.toThrow(NOT_IMPLEMENTED);
  });
});

describe("MockQlooSource", () => {
  const source: QlooSource = new MockQlooSource();

  it("marks every response as mock", async () => {
    const results = await Promise.all([
      source.searchEntities("Anything", undefined, run),
      source.candidates(["mock:seed:x"], "artist", undefined, run),
      source.heatmap(["mock:seed:x"], undefined, run),
      source.places(["mock:seed:x"], "Chicago", ["bar"], run),
      source.brands(["mock:seed:x"], "Chicago", run),
    ]);
    for (const r of results) expect(r.meta.mock).toBe(true);
  });

  it("is deterministic and returns nothing for a no-vowel query", async () => {
    const a = await source.candidates(["mock:seed:x"], "artist", undefined, run);
    const b = await source.candidates(["mock:seed:x"], "artist", undefined, run);
    expect(a).toEqual(b);
    expect((await source.searchEntities("xqzvbnmlkj", undefined, run)).data).toEqual([]);
  });

  it("gives the engine a bias-guard case to drop", async () => {
    const { data } = await source.candidates(["mock:seed:x"], "artist", undefined, run);
    const res = scorePartners(data);
    expect(res.dropped.some((d) => d.reason === "too_popular")).toBe(true);
  });
});
