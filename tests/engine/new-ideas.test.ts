import { describe, expect, it } from "vitest";

import { weekOf } from "@/lib/server/trending";
import { introFor } from "@/lib/tools/fan";
import { crowdFit } from "@/lib/engine/lineup";

describe("crowdFit", () => {
  it("is the mean mutual Qloo affinity over every pair on the bill", () => {
    expect(crowdFit(["a", "b"], { a: { b: 0.98 }, b: { a: 0.94 } })).toBeCloseTo(Math.sqrt(0.98 * 0.94));
    expect(crowdFit(["a"], {})).toBe(0);
  });
});

describe("introFor", () => {
  it("writes the persona line from the data only", () => {
    const audience = { entityId: "x", raw: { entityId: "x", age: {}, gender: {} }, summary: { skewsTo: ["25–29", "24 and under"], gender: "female" as const, genderSkew: 0.47, bands: [] } };
    const pick = (name: string) => ({ entity: { name } }) as never;
    const intro = introFor("Phoebe Bridgers", audience, [
      { category: "tv_show", label: "TV show", picks: [pick("PEN15")] },
      { category: "artist", label: "artist", picks: [pick("Lucy Dacus")] },
    ]);
    expect(intro).toBe("The Phoebe Bridgers fan is most often 25–29 or 24 and under, skews female. They over-index on PEN15 and Lucy Dacus.");
  });
});

describe("weekOf", () => {
  it("starts weeks on Monday, UTC", () => {
    expect(weekOf(Date.UTC(2026, 9, 27, 12))).toBe("2026-10-26");
    expect(weekOf(Date.UTC(2026, 10, 1, 23))).toBe("2026-10-26");
    expect(weekOf(Date.UTC(2026, 10, 2))).toBe("2026-11-02");
  });
});
