import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cityHeat, scoreCities, scoreCityHeat } from "@/lib/engine/cities";
import { scoreNamedPartner } from "@/lib/engine/partners";
import { actConfidence, scoreRosterPairs, type RosterActSignal, type RosterPair } from "@/lib/engine/roster";

import { ALPHA, BETA, GAMMA, TINY, candidate, heatAt } from "./builders";

const CITIES = [ALPHA, BETA, GAMMA, TINY];
const heat = (cells: ReturnType<typeof heatAt>) => cityHeat(cells, CITIES);

/** Four acts with asymmetric Qloo affinities, like real data. */
function roster(): RosterActSignal[] {
  return [
    { id: "a", name: "Act A", category: "person", affinities: { b: 0.95, c: 0.81, d: null }, market: "TL", heat: heat([...heatAt(ALPHA, 0.9), ...heatAt(BETA, 0.3)]) },
    { id: "b", name: "Act B", category: "person", affinities: { a: 0.91, c: 0.88, d: 0.7 }, market: "TL", heat: heat([...heatAt(ALPHA, 0.8), ...heatAt(GAMMA, 0.9)]) },
    { id: "c", name: "Act C", category: "artist", affinities: { a: 0.86, b: 0.9 }, market: "TL", heat: heat([...heatAt(BETA, 0.9)]) },
    { id: "d", name: "Act D", category: "artist", affinities: { a: null }, market: "GB" },
  ];
}

const key = (p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].sort().join("|");
const byPair = (pairs: RosterPair[]) => new Map(pairs.map((p) => [key(p), p]));

describe("scoreRosterPairs", () => {
  it("gives a pair the same score, level, confidence and city whichever act comes first", () => {
    const acts = roster();
    const forward = scoreRosterPairs(acts, CITIES, { minPopulation: 0 });
    const backward = scoreRosterPairs([...acts].reverse(), CITIES, { minPopulation: 0 });
    const f = byPair(forward.pairs);
    const b = byPair(backward.pairs);
    expect([...f.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [k, p] of f) {
      const q = b.get(k)!;
      expect(q.score).toBe(p.score);
      expect(q.level).toBe(p.level);
      expect(q.confidence).toBe(p.confidence);
      expect(q.city?.id).toBe(p.city?.id);
      // The evidence swaps with the order, and is never lost.
      expect([q.evidence.bAmongA, q.evidence.aAmongB].sort()).toEqual([p.evidence.bAmongA, p.evidence.aAmongB].sort());
      expect(q.rank).toBe(p.rank);
    }
  });

  it("scores from Qloo's two directions only: their mean × 100", () => {
    const { pairs } = scoreRosterPairs(roster(), CITIES, { minPopulation: 0 });
    const ab = byPair(pairs).get("a|b")!;
    expect(ab.score).toBe(Math.round(((0.95 + 0.91) / 2) * 100));
    expect(ab.evidence).toEqual({ bAmongA: 0.95, aAmongB: 0.91 });
    expect(ab.level).toBe("strong");
    expect(ab.confidence).toBe("high");
    expect(pairs.map((p) => p.rank)).toEqual(pairs.map((_, i) => i + 1));
    expect(pairs[0].score).toBeGreaterThanOrEqual(pairs.at(-1)!.score);
  });

  it("uses one direction alone at most medium confidence, and never invents a number when both are missing", () => {
    const { pairs, unscored } = scoreRosterPairs(roster(), CITIES, { minPopulation: 0 });
    const bd = byPair(pairs).get("b|d")!;
    expect(bd.score).toBe(70);
    expect(bd.evidence).toEqual({ bAmongA: 0.7, aAmongB: null });
    expect(bd.confidence).toBe("low");
    const ac = byPair(pairs).get("a|c")!;
    expect(ac.confidence).toBe("medium");
    expect(unscored.map(key)).toEqual(["a|d", "c|d"]);
    expect(pairs.some((p) => key(p) === "a|d")).toBe(false);
  });

  it("finds the shared city inside a shared market, and says why when there is none", () => {
    const { pairs } = scoreRosterPairs(roster(), CITIES, { minPopulation: 0 });
    const ab = byPair(pairs).get("a|b")!;
    expect(ab.city?.id).toBe("alpha");
    expect(ab.cityNote).toMatch(/alpha/);
    expect(byPair(pairs).get("b|d")!.city).toBeNull();
    expect(byPair(pairs).get("b|d")!.cityNote).toMatch(/no city-level data/i);
    const markets = scoreRosterPairs(
      [
        { id: "x", name: "X", category: "artist", affinities: { y: 0.9 }, market: "TL", heat: heat(heatAt(ALPHA, 0.9)) },
        { id: "y", name: "Y", category: "artist", affinities: { x: 0.9 }, market: "GB", heat: heat(heatAt(ALPHA, 0.9)) },
      ],
      CITIES,
    );
    expect(markets.pairs[0].cityNote).toMatch(/home markets differ/);
  });

  it("ignores a repeated act", () => {
    const acts = roster();
    expect(scoreRosterPairs([...acts, acts[0]], CITIES).pairs).toHaveLength(scoreRosterPairs(acts, CITIES).pairs.length);
  });
});

describe("roster helpers", () => {
  it("rates an act by its weakest pick, missing counting as low", () => {
    expect(actConfidence(["high", "medium", "high"])).toBe("medium");
    expect(actConfidence(["high", "high", "high"])).toBe("high");
    expect(actConfidence(["high", null, "high"])).toBe("low");
  });

  it("splits city scoring in two without changing the result", () => {
    const a = [...heatAt(ALPHA, 0.9), ...heatAt(BETA, 0.4), ...heatAt(GAMMA, 0.7)];
    const b = [...heatAt(ALPHA, 0.3), ...heatAt(BETA, 0.8), ...heatAt(GAMMA, 0.6)];
    expect(scoreCityHeat(heat(a), heat(b), CITIES, 100_000)).toEqual(scoreCities(a, b, CITIES, 100_000));
  });

  it("scores a partner the user chose, marking one outside the filters as low confidence with the reason", () => {
    const pool = [candidate("p1", "artist", 0.9, 0.8), candidate("p2", "artist", 0.88, 0.8), candidate("p4", "artist", 0.6, 0.8), candidate("p3", "artist", 0.95, 0.9999)];
    const inBand = scoreNamedPartner(pool, "p2")!;
    expect(inBand.reason).toBeNull();
    expect(inBand.pick.entity.id).toBe("p2");
    const famous = scoreNamedPartner(pool, "p3")!;
    expect(famous.pick.confidence).toBe("low");
    expect(famous.reason).toMatch(/too mainstream/);
    expect(scoreNamedPartner(pool, "nope")).toBeNull();
  });

  it("keeps scores out of the roster screen, API and exports: they only show the engine's numbers", () => {
    const files = [
      "components/workspace/roster.tsx",
      "lib/export/roster.ts",
      "app/api/workspace/rosters/[id]/route.ts",
      "lib/roster/service.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // No arithmetic on affinities or scores outside lib/engine: rounding, averaging or scaling.
      expect(src, f).not.toMatch(/Math\.(round|max|min|sqrt|pow)\(/);
      expect(src, f).not.toMatch(/(affinity|score|Among[AB])\s*[*/+-]\s*\d/);
    }
  });
});
