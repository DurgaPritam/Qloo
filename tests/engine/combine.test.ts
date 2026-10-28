import { describe, expect, it } from "vitest";

import { clampWeight, combineCityScores, DEFAULT_USER_WEIGHT, normaliseMetric } from "@/lib/engine/combine";

const qloo = [
  { cityId: "la", score: 0.91 },
  { cityId: "ny", score: 0.77 },
  { cityId: "atl", score: 0.58 },
];
const sales = [
  { cityId: "la", value: 1000 },
  { cityId: "la", value: 742 },
  { cityId: "ny", value: 1655 },
  { cityId: "sea", value: 610 },
];
const row = (rows: ReturnType<typeof combineCityScores>, id: string) => rows.find((r) => r.cityId === id)!;

describe("normaliseMetric", () => {
  it("sums rows per city and scales against the best city", () => {
    const n = normaliseMetric(sales);
    expect(n.get("la")).toEqual({ raw: 1742, norm: 1 });
    expect(n.get("ny")!.norm).toBeCloseTo(1655 / 1742);
    expect(n.get("sea")!.norm).toBeCloseTo(610 / 1742);
  });

  it("drops negative and non-numeric values and copes with all zeros", () => {
    const n = normaliseMetric([
      { cityId: "a", value: -5 },
      { cityId: "b", value: Number.NaN },
      { cityId: "c", value: 0 },
    ]);
    expect([...n.keys()]).toEqual(["c"]);
    expect(n.get("c")!.norm).toBe(0);
  });
});

describe("combineCityScores", () => {
  it("weights the two parts and keeps both beside the result", () => {
    const rows = combineCityScores(qloo, sales, 0.4);
    const la = row(rows, "la");
    expect(la).toMatchObject({ qloo: 0.91, yours: 1, raw: 1742, weight: 0.4, basis: "both" });
    expect(la.combined).toBeCloseTo(0.6 * 0.91 + 0.4 * 1);
    expect(row(rows, "ny").combined).toBeCloseTo(0.6 * 0.77 + 0.4 * (1655 / 1742));
  });

  it("is Qloo alone at weight 0 and your data alone at weight 1", () => {
    expect(row(combineCityScores(qloo, sales, 0), "ny").combined).toBeCloseTo(0.77);
    expect(row(combineCityScores(qloo, sales, 1), "ny").combined).toBeCloseTo(1655 / 1742);
  });

  it("defaults to 0.5 and clamps the weight", () => {
    expect(DEFAULT_USER_WEIGHT).toBe(0.5);
    expect(row(combineCityScores(qloo, sales), "la").combined).toBeCloseTo((0.91 + 1) / 2);
    expect(clampWeight(3)).toBe(1);
    expect(clampWeight(-1)).toBe(0);
    expect(clampWeight(Number.NaN)).toBe(0.5);
  });

  it("uses the side that exists when a city is missing on the other, and labels it", () => {
    const rows = combineCityScores(qloo, sales, 0.5);
    expect(row(rows, "atl")).toMatchObject({ yours: null, basis: "qloo", combined: 0.58 });
    expect(row(rows, "sea")).toMatchObject({ qloo: null, basis: "yours" });
    expect(row(rows, "sea").combined).toBeCloseTo(610 / 1742);
  });

  it("ranks by combined score, deterministically", () => {
    const rows = combineCityScores(qloo, sales, 0.5);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].combined).toBeGreaterThanOrEqual(rows[i].combined);
    expect(combineCityScores([...qloo].reverse(), [...sales].reverse(), 0.5)).toEqual(rows);
  });
});
