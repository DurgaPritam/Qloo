import { describe, expect, it } from "vitest";

import { ENGINE_CONFIG } from "@/lib/engine/config";
import { median, outcomeReport, sellThrough, type LoggedEvent, type Prediction } from "@/lib/engine/outcomes";

const pred = (city: string, partner: string): Prediction => ({
  city: { id: city, name: city, rank: 1, of: 5, combined: 0.9, confidence: "high" },
  partner: { id: partner, name: partner, category: "podcast", rank: 1, score: 0.7, confidence: "high" },
  venue: null,
  sponsors: [],
  market: "US",
});
const ev = (planId: string, st: number | null, city = "Austin", partner = "Hot Ones"): LoggedEvent => ({ planId, prediction: pred(city, partner), sellThrough: st });

describe("sellThrough", () => {
  it("is sold ÷ capacity only when both are entered and capacity is positive", () => {
    expect(sellThrough(1790, 1850)).toBeCloseTo(0.9676);
    expect(sellThrough(1790, null)).toBeNull();
    expect(sellThrough(null, 1850)).toBeNull();
    expect(sellThrough(undefined, undefined)).toBeNull();
    expect(sellThrough(10, 0)).toBeNull();
    expect(sellThrough(-1, 10)).toBeNull();
    expect(sellThrough(0, 10)).toBe(0);
  });

  it("medians odd and even lists", () => {
    expect(median([0.5, 0.9, 0.7])).toBe(0.7);
    expect(median([0.5, 0.9, 0.7, 0.6])).toBeCloseTo(0.65);
    expect(median([])).toBeNull();
  });
});

describe("outcomeReport", () => {
  it("says too few events to judge below the minimum, and judges from it on", () => {
    expect(ENGINE_CONFIG.outcomes.minSample).toBe(5);
    const four = [ev("a", 0.9), ev("b", 0.7), ev("c", 0.6), ev("d", 0.95)];
    const r4 = outcomeReport(four);
    expect(r4).toMatchObject({ sample: 4, judged: false, minSample: 5 });
    expect(r4.cities.every((c) => !c.judged)).toBe(true);
    const r5 = outcomeReport([...four, ev("e", 0.5)]);
    expect(r5).toMatchObject({ sample: 5, judged: true, median: 0.7, aboveMedian: 2 });
    expect(r5.cities[0]).toEqual({ id: "Austin", name: "Austin", events: 5, above: 2, judged: true });
  });

  it("counts only events with a sell-through, groups by chosen city and partner, and judges each group on its own size", () => {
    const events = [ev("a", 0.9, "Austin", "Hot Ones"), ev("b", 0.8, "Austin", "SmartLess"), ev("c", 0.4, "Seattle", "Hot Ones"), ev("d", null, "Seattle"), ev("e", 0.6), ev("f", 0.85), ev("g", 0.3)];
    const r = outcomeReport(events, 3);
    expect(r.sample).toBe(6);
    expect(r.median).toBeCloseTo(0.7);
    const austin = r.cities.find((c) => c.id === "Austin")!;
    expect(austin).toMatchObject({ events: 5, above: 3, judged: true });
    expect(r.cities.find((c) => c.id === "Seattle")).toMatchObject({ events: 1, judged: false });
    expect(r.partners.find((c) => c.id === "SmartLess")).toMatchObject({ events: 1, above: 1, judged: false });
  });

  it("does not count an event at the median as above it", () => {
    const r = outcomeReport([ev("a", 0.5), ev("b", 0.5), ev("c", 0.5)], 3);
    expect(r.aboveMedian).toBe(0);
  });
});
