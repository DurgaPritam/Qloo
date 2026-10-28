import { describe, expect, it } from "vitest";

import { audienceClusters, crowdFit, mutual, optimizeLineup, TIERS, type AffinityMatrix, type LineupConstraints, type PoolAct, type Tier } from "@/lib/engine/lineup";

/** Two audiences: comedy (c1–c3) and music (m1–m3); dana links to nobody. */
const pool: PoolAct[] = [
  { id: "c1", name: "Ali", tier: "A" },
  { id: "c2", name: "Atsuko", tier: "B" },
  { id: "c3", name: "Sheng", tier: "C" },
  { id: "m1", name: "Lucy", tier: "B" },
  { id: "m2", name: "Julien", tier: "C" },
  { id: "m3", name: "Phoebe", tier: "A" },
  { id: "d", name: "Dana", tier: "C" },
];
const M: AffinityMatrix = {
  c1: { c2: 0.9, c3: 0.8, m1: 0.2 },
  c2: { c1: 0.9, c3: 0.85 },
  c3: { c1: 0.7, c2: 0.8 },
  m1: { m2: 0.95, m3: 0.9, c1: 0.3 },
  m2: { m1: 0.9, m3: 0.85 },
  m3: { m1: 0.95, m2: 0.8 },
};
const base: LineupConstraints = { budget: 100_000, fees: { A: 50_000, B: 20_000, C: 5_000 }, slots: { A: 1, B: 2, C: 2 }, weight: 0 };

describe("the scores come only from Qloo's affinities", () => {
  it("mutual affinity is √(a→b × b→a), one direction alone, or nothing", () => {
    expect(mutual(M, "c1", "c2")).toBeCloseTo(0.9);
    expect(mutual(M, "c1", "c3")).toBeCloseTo(Math.sqrt(0.8 * 0.7));
    expect(mutual(M, "c1", "m1")).toBeCloseTo(Math.sqrt(0.2 * 0.3));
    expect(mutual(M, "c1", "d")).toBeNull();
    expect(crowdFit(["c1", "c2", "d"], M)).toBeCloseTo((0.9 + 0 + 0) / 3);
  });

  it("clusters acts linked by mutual affinity at or above the threshold", () => {
    expect(audienceClusters(pool.map((a) => a.id), M)).toEqual([["c1", "c2", "c3"], ["d"], ["m1", "m2", "m3"]]);
  });
});

describe("optimizeLineup", () => {
  it("fills the user's slots, and at weight 0 picks one shared audience; more coverage weight brings in the others", () => {
    const three = { ...base, slots: { A: 1, B: 1, C: 1 } };
    const tight = optimizeLineup(pool, M, three);
    if (tight.status !== "done") throw new Error(tight.reason);
    expect(tight.best.ids).toHaveLength(3);
    expect(new Set(tight.best.ids.map((id) => id[0]))).toEqual(new Set([tight.best.ids[0][0]])); // one audience
    const wide = optimizeLineup(pool, M, { ...three, weight: 0.8 });
    if (wide.status !== "done") throw new Error(wide.reason);
    expect(wide.best.coverage).toBeGreaterThan(tight.best.coverage);
    expect(wide.weight).toBe(0.8);
  });

  it("keeps must-include acts, explains each act, and lists near misses and a better over-budget bill", () => {
    const r = optimizeLineup(
      pool.map((a) => (a.id === "d" ? { ...a, mustInclude: true } : a)),
      M,
      { ...base, budget: 60_000 },
    );
    if (r.status !== "done") throw new Error(r.reason);
    expect(r.best.ids).toContain("d");
    const d = r.reasons.find((x) => x.id === "d")!;
    expect(d).toMatchObject({ mustInclude: true, strongest: null, cluster: expect.stringMatching(/^Audience /) });
    for (const x of r.reasons) if (x.drop !== null) expect(Number.isFinite(x.drop)).toBe(true);
    expect(r.nearMisses.length).toBeGreaterThan(0);
    // Near misses rank after the bill: no fuller, and no better at the same size.
    for (const n of r.nearMisses) {
      expect(n.ids.length).toBeLessThanOrEqual(r.best.ids.length);
      if (n.ids.length === r.best.ids.length) expect(n.score).toBeLessThanOrEqual(r.best.score + 1e-12);
    }
    const open = optimizeLineup(pool, M, { ...base, budget: 10_000 }); // only tier-C acts fit, and they share no audience
    if (open.status !== "done") throw new Error(open.reason);
    expect(open.overBudget?.overBudget).toBeGreaterThan(0);
    expect(open.overBudget!.ids.length).toBeGreaterThan(open.best.ids.length); // fills more slots
  });

  it("says why when nothing fits instead of suggesting a bill", () => {
    expect(optimizeLineup(pool, M, { ...base, budget: 1_000 })).toMatchObject({ status: "infeasible" });
    expect(optimizeLineup(pool.map((a) => ({ ...a, mustInclude: a.tier === "A" })), M, base)).toMatchObject({ status: "infeasible", reason: expect.stringMatching(/tier A, which has 1 slot/) });
    expect(optimizeLineup(pool.slice(0, 1), M, base)).toMatchObject({ status: "infeasible", reason: "Add at least two acts to the pool." });
  });
});

/** A small seeded random generator, so the property test is the same every run. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

describe("constraints are never broken, the answer is the best feasible, and it is deterministic", () => {
  it("over 200 random pools, against brute force", () => {
    const r = rng(42);
    for (let run = 0; run < 200; run++) {
      const n = 3 + Math.floor(r() * 6);
      const acts: PoolAct[] = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Act ${i}`, tier: TIERS[Math.floor(r() * 3)], mustInclude: r() < 0.1 }));
      const m: AffinityMatrix = {};
      for (const a of acts) for (const b of acts) if (a !== b && r() < 0.7) (m[a.id] ??= {})[b.id] = Math.round(r() * 100) / 100;
      const c: LineupConstraints = {
        budget: Math.round(r() * 120_000),
        fees: { A: 40_000, B: 15_000, C: 4_000 },
        slots: { A: Math.floor(r() * 2), B: Math.floor(r() * 3), C: Math.floor(r() * 3) } as Record<Tier, number>,
        weight: Math.round(r() * 10) / 10,
      };
      const out = optimizeLineup(acts, m, c);
      const shuffled = optimizeLineup([...acts].reverse(), m, c);
      expect(shuffled).toEqual(out);
      // Brute force: the best score among the fullest feasible bills.
      let best = -1;
      let size = 0;
      for (let mask = 0; mask < 1 << n; mask++) {
        const set = acts.filter((_, i) => mask & (1 << i));
        const cost = set.reduce((s, a) => s + c.fees[a.tier], 0);
        const ok =
          set.length >= 2 &&
          cost <= c.budget &&
          acts.filter((a) => a.mustInclude).every((a) => set.includes(a)) &&
          TIERS.every((t) => set.filter((a) => a.tier === t).length <= c.slots[t]) &&
          set.length <= TIERS.reduce((s, t) => s + c.slots[t], 0);
        if (!ok) continue;
        const clusters = audienceClusters(acts.map((a) => a.id), m);
        const covered = new Set(set.map((a) => clusters.findIndex((g) => g.includes(a.id)))).size;
        const cover = Math.min(1, covered / Math.max(1, Math.min(clusters.length, TIERS.reduce((s, t) => s + c.slots[t], 0))));
        const sc = (1 - c.weight) * crowdFit(set.map((a) => a.id), m) + c.weight * cover;
        if (set.length > size) [size, best] = [set.length, sc];
        else if (set.length === size) best = Math.max(best, sc);
      }
      if (best < 0) {
        expect(out.status).toBe("infeasible");
        continue;
      }
      if (out.status !== "done") throw new Error(`run ${run}: ${out.reason}`);
      expect(out.best.ids).toHaveLength(size);
      expect(out.best.score).toBeCloseTo(best, 10);
      const chosen = acts.filter((a) => out.best.ids.includes(a.id));
      expect(out.best.cost).toBeLessThanOrEqual(c.budget);
      for (const t of TIERS) expect(chosen.filter((a) => a.tier === t).length).toBeLessThanOrEqual(c.slots[t]);
      for (const a of acts.filter((x) => x.mustInclude)) expect(out.best.ids).toContain(a.id);
      for (const nm of out.nearMisses) expect(nm.cost).toBeLessThanOrEqual(c.budget);
    }
  });
});
