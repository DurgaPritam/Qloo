import { describe, expect, it } from "vitest";

import { scoreCities } from "@/lib/engine/cities";
import type { CityScore } from "@/lib/engine/types";

import { ALPHA, BETA, GAMMA, TINY, heatAt } from "./builders";

const CITIES = [ALPHA, BETA, GAMMA, TINY];

const byId = (scores: CityScore[]) => Object.fromEntries(scores.map((s) => [s.city.id, s]));

describe("scoreCities", () => {
  it("is symmetric in A and B", () => {
    const heatA = [...heatAt(ALPHA, 0.9), ...heatAt(BETA, 0.4), ...heatAt(GAMMA, 0.7)];
    const heatB = [...heatAt(ALPHA, 0.3), ...heatAt(BETA, 0.8), ...heatAt(GAMMA, 0.6)];

    const ab = byId(scoreCities(heatA, heatB, CITIES, 0));
    const ba = byId(scoreCities(heatB, heatA, CITIES, 0));

    for (const id of Object.keys(ab)) {
      expect(ab[id].combined).toBeCloseTo(ba[id].combined);
      expect(ab[id].sA).toBeCloseTo(ba[id].sB);
      expect(ab[id].rank).toBe(ba[id].rank);
    }
  });

  it("is 0 when either side has no heat in the city", () => {
    const heatA = [...heatAt(ALPHA, 0.9), ...heatAt(BETA, 0.5)];
    const heatB = [...heatAt(BETA, 0.5), ...heatAt(GAMMA, 0.9)];

    const s = byId(scoreCities(heatA, heatB, CITIES, 0));

    expect(s.alpha.sB).toBe(0);
    expect(s.alpha.combined).toBe(0);
    expect(s.gamma.sA).toBe(0);
    expect(s.gamma.combined).toBe(0);
    expect(s.beta.combined).toBeGreaterThan(0);
  });

  it("a city strong for one side and weak for the other does not beat one strong for both", () => {
    // alpha: hottest for A, cold for B. beta: good for both.
    const heatA = [...heatAt(ALPHA, 0.95), ...heatAt(BETA, 0.7)];
    const heatB = [...heatAt(ALPHA, 0.1), ...heatAt(BETA, 0.7)];

    const [first, second] = scoreCities(heatA, heatB, CITIES, 0);

    expect(first.city.id).toBe("beta");
    expect(second.city.id).toBe("alpha");
    expect(first.combined).toBeGreaterThan(second.combined);
    expect(second.confidence).toBe("low");
  });

  it("normalises each side so the hottest city scores 1", () => {
    const heatA = [...heatAt(ALPHA, 0.4), ...heatAt(BETA, 0.2)];
    const heatB = [...heatAt(ALPHA, 0.6), ...heatAt(BETA, 0.6)];

    const s = byId(scoreCities(heatA, heatB, CITIES, 0));

    expect(s.alpha.sA).toBe(1);
    expect(s.beta.sA).toBeCloseTo(0.5);
    expect(s.alpha.combined).toBe(1);
    expect(s.beta.combined).toBeCloseTo(Math.sqrt(0.5));
  });

  it("filters by minPopulation and ranks by population for the without-Qloo comparison", () => {
    const heat = [...heatAt(GAMMA, 0.9), ...heatAt(TINY, 0.95)];

    const scores = scoreCities(heat, heat, CITIES, 100_000);

    expect(scores.map((s) => s.city.id)).not.toContain("tiny");
    expect(scores[0].city.id).toBe("gamma");
    expect(byId(scores).alpha.populationRank).toBe(1);
    expect(byId(scores).gamma.populationRank).toBe(3);
  });

  it("caps confidence at medium when a side has too few cells", () => {
    const s = byId(scoreCities(heatAt(ALPHA, 0.9, 1), heatAt(ALPHA, 0.9, 5), CITIES, 0));

    expect(s.alpha.combined).toBe(1);
    expect(s.alpha.confidence).toBe("medium");
    expect(s.alpha.evidence).toEqual({ cellsA: 1, cellsB: 5 });
  });

  it("returns all zeros, not NaN, with no heat at all", () => {
    const scores = scoreCities([], [], CITIES, 0);

    expect(scores).toHaveLength(4);
    expect(scores.every((s) => s.combined === 0 && s.sA === 0 && s.sB === 0)).toBe(true);
  });

  it("ignores cells outside the radius and invalid cells", () => {
    const heatA = [
      ...heatAt(ALPHA, 0.8),
      { lat: ALPHA.lat + 2, lon: ALPHA.lon, affinity: 0.1 },
      { lat: ALPHA.lat, lon: ALPHA.lon, affinity: Number.NaN },
    ];

    const s = byId(scoreCities(heatA, heatA, CITIES, 0));

    expect(s.alpha.evidence.cellsA).toBe(3);
  });
});
