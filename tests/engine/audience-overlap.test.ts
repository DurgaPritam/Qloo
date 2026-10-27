import { describe, expect, it } from "vitest";

import { summariseAudience } from "@/lib/engine/audience";
import { overlapLevel } from "@/lib/engine/overlap";

describe("summariseAudience", () => {
  it("reads Qloo's skews: positive age bands strongest first, gender beyond the lean threshold", () => {
    // Phoebe Bridgers, from Qloo on 27 Oct 2026.
    const s = summariseAudience({
      entityId: "pb",
      age: { "24_and_younger": 0.29, "25_to_29": 0.33, "30_to_34": 0.2, "35_to_44": -0.63, "45_to_54": -0.44, "55_and_older": -0.53 },
      gender: { male: -0.47, female: 0.47 },
    });
    expect(s.skewsTo).toEqual(["25–29", "24 and under", "30–34"]);
    expect(s.gender).toBe("female");
    expect(s.bands.map((b) => b.label)).toEqual(["24 and under", "25–29", "30–34", "35–44", "45–54", "55 and over"]);
  });

  it("calls a small skew balanced", () => {
    expect(summariseAudience({ entityId: "x", age: {}, gender: { male: 0.05, female: -0.05 } }).gender).toBe("balanced");
  });
});

describe("overlapLevel", () => {
  it("uses the stronger direction, against the top-crossover thresholds", () => {
    expect(overlapLevel([0.98, 0.94])).toBe("strong");
    expect(overlapLevel([0.86, null])).toBe("clear");
    expect(overlapLevel([0.74, 0.79])).toBe("some");
    expect(overlapLevel([null, null])).toBe("unknown");
  });
});
