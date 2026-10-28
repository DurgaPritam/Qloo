import { describe, expect, it } from "vitest";

import { bestLineup, type LineupCandidate } from "@/lib/engine/lineup";

const H: LineupCandidate = { id: "h", name: "Ali Wong", fit: null, fee: 60_000 };
const pool: LineupCandidate[] = [
  { id: "a", name: "Atsuko", fit: 81, fee: 18_000 },
  { id: "b", name: "Taylor", fit: 74, fee: 60_000 },
  { id: "c", name: "Ronny", fit: 78, fee: 18_000 },
  { id: "d", name: "Sheng", fit: 76, fee: 6_000 },
  { id: "e", name: "Dana", fit: 63, fee: 6_000 },
];

describe("bestLineup", () => {
  it("keeps the headliner and maximises the others' fit inside the budget", () => {
    const r = bestLineup(H, pool, { slots: 3, budget: 95_000 })!;
    // Atsuko + Ronny (fit 159) would cost 96,000: over budget. Atsuko + Sheng (157) fits.
    expect(r.slots.map((s) => [s.role, s.name])).toEqual([
      ["Headliner", "Ali Wong"],
      ["Feature", "Atsuko"],
      ["Support", "Sheng"],
    ]);
    expect(r).toMatchObject({ cost: 84_000, meanFit: 79, left: 11_000 });
  });

  it("is exact: checks every combination against brute force", () => {
    for (const budget of [70_000, 80_000, 90_000, 100_000, 200_000]) {
      for (const slots of [2, 3, 4]) {
        const r = bestLineup(H, pool, { slots, budget });
        let bestFit = -1;
        const k = slots - 1;
        const combos = (start: number, acc: LineupCandidate[]): void => {
          if (acc.length === k) {
            const cost = H.fee + acc.reduce((s, c) => s + c.fee, 0);
            if (cost <= budget) bestFit = Math.max(bestFit, acc.reduce((s, c) => s + (c.fit ?? 0), 0));
            return;
          }
          for (let i = start; i < pool.length; i++) combos(i + 1, [...acc, pool[i]]);
        };
        combos(0, []);
        if (bestFit < 0) expect(r).toBeNull();
        else expect(r!.slots.slice(1).reduce((s, c) => s + (c.fit ?? 0), 0)).toBe(bestFit);
        if (r) expect(r.cost).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("returns nothing when no lineup fits, prefers the cheaper bill on a tie, and is stable", () => {
    expect(bestLineup(H, pool, { slots: 3, budget: 50_000 })).toBeNull();
    const tie = bestLineup(H, [{ id: "x", name: "X", fit: 70, fee: 9_000 }, { id: "y", name: "Y", fit: 70, fee: 5_000 }], { slots: 2, budget: 100_000 })!;
    expect(tie.slots[1].name).toBe("Y");
    expect(bestLineup(H, [...pool].reverse(), { slots: 4, budget: 120_000 })).toEqual(bestLineup(H, pool, { slots: 4, budget: 120_000 }));
  });
});
