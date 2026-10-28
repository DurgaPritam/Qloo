import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rankBrands } from "@/lib/engine/places";
import { isSportsOrganisation, rankByFit, scoreSponsorFit, sectorOf, TO_CONFIRM_COMMERCIAL } from "@/lib/engine/sponsor";
import type { Brand } from "@/lib/engine/types";
import { pitchNumbers, pitchOutline, pitchText, type PitchInput } from "@/lib/export/sponsor";

const A = { name: "Ali Wong" };
const B = { name: "Liquid Death" };

describe("scoreSponsorFit", () => {
  it("is the geometric mean of both directions × 100, with each as Qloo evidence and commercial terms to confirm", () => {
    const f = scoreSponsorFit(A, B, { forward: 0.94, backward: 0.88 })!;
    expect(f).toMatchObject({ fit: 91, level: "strong", confidence: "high", forward: 0.94, backward: 0.88 });
    expect(f.evidence.map((e) => [e.kind, e.source, e.value])).toEqual([
      ["forward", "qloo", 0.94],
      ["backward", "qloo", 0.88],
      ["to_confirm", "none", null],
    ]);
    expect(f.evidence[0].text).toBe("Ali Wong fans over-index on Liquid Death: Qloo affinity 0.94.");
    expect(f.evidence.at(-1)!.text).toBe(TO_CONFIRM_COMMERCIAL);
  });

  it("lets one weak direction pull the fit down, as the city score does with two heats", () => {
    // √(0.9 × 0.1) = 0.30; the arithmetic mean would have said 0.50.
    expect(scoreSponsorFit(A, B, { forward: 0.9, backward: 0.1 })!.fit).toBe(30);
    expect(scoreSponsorFit(A, B, { forward: 0.6, backward: 0 })!.fit).toBe(0);
  });

  it("uses one direction alone at most medium confidence, and invents nothing with none", () => {
    const one = scoreSponsorFit(A, B, { forward: 0.95, backward: null })!;
    expect(one).toMatchObject({ fit: 95, confidence: "medium", backward: null });
    expect(one.evidence.map((e) => e.kind)).toEqual(["forward", "missing", "to_confirm"]);
    expect(scoreSponsorFit(A, B, { forward: null, backward: undefined })).toBeNull();
    expect(scoreSponsorFit(A, B, { forward: Number.NaN, backward: 1.4 })).toBeNull();
  });

  it("is the same whichever side is called the rights holder, for the score", () => {
    const ab = scoreSponsorFit(A, B, { forward: 0.9, backward: 0.8 })!;
    const ba = scoreSponsorFit(B, A, { forward: 0.8, backward: 0.9 })!;
    expect([ab.fit, ab.level, ab.confidence]).toEqual([ba.fit, ba.level, ba.confidence]);
  });

  it("ranks best fit first, then confidence, then name", () => {
    const mk = (name: string, f: number, b: number | null) => ({ name, fit: scoreSponsorFit(A, { name }, { forward: f, backward: b })! });
    expect(rankByFit([mk("C", 0.9, null), mk("A", 0.9, 0.9), mk("B", 0.95, 0.95)]).map((x) => x.name)).toEqual(["B", "A", "C"]);
  });
});

describe("rival and non-brand exclusion", () => {
  const brand = (id: string, extra: Partial<Brand> = {}): Brand => ({ id, name: id, affinity: 0.9, popularity: 0.8, ...extra });
  const results = [
    brand("Liquid Death", { affinity: 0.93, sectors: ["Beverage"] }),
    brand("Glossier", { affinity: 0.85, sectors: ["Beauty"] }),
    brand("Chelsea F.C.", { tags: ["England Soccer", "Sports Organization", "Soccer"] }),
    brand("Premier League", { brandTypes: ["Entertainment Brand"] }),
    brand("ACLU", { brandTypes: ["Nonprofit Brand"] }),
    brand("TSA PreCheck", { brandTypes: ["Government Brand"] }),
    brand("Uber Eats", { affinity: 0.92, sectors: ["Delivery"] }),
  ];

  it("drops teams (even without a brand_type), leagues, nonprofits and government from brands to pitch", () => {
    // Glossier is a real brand, dropped only for sitting below the brands' median affinity.
    const r = rankBrands(results, 10);
    expect(r.picks.map((p) => p.brand.name).sort()).toEqual(["Liquid Death", "Uber Eats"]);
    expect(r.dropped.filter((d) => d.reason === "not_a_sponsor").map((d) => d.item.name).sort()).toEqual(["ACLU", "Chelsea F.C.", "Premier League", "TSA PreCheck"]);
  });

  it("knows a team by Qloo's Sports Organization tag, and groups brands by Qloo's sector", () => {
    expect(isSportsOrganisation({ tags: ["NBA", "Sports Organization"] })).toBe(true);
    expect(isSportsOrganisation({ tags: ["Beverage"] })).toBe(false);
    expect(sectorOf({ sectors: ["Beverage", "Drinks"] })).toBe("Beverage");
    expect(sectorOf({})).toBe("Other");
  });
});

describe("pitch deck", () => {
  const p: PitchInput = {
    holder: "Ali Wong",
    brand: "Liquid Death",
    sector: "Beverage",
    fit: scoreSponsorFit(A, B, { forward: 0.94, backward: 0.88 })!,
    audience: { of: "Ali Wong", skewsTo: ["25–34", "35–44"], gender: "female" },
    cities: [
      { name: "Los Angeles", score: 1 },
      { name: "Seattle", score: 0.74 },
    ],
    mock: false,
  };

  it("contains no number that the engine did not produce", () => {
    const allowed = pitchNumbers(p);
    const text = pitchOutline(p)
      .flatMap((s) => [s.title, s.subtitle ?? "", s.note ?? "", ...(s.bullets ?? []), ...(s.table ? [...s.table.columns, ...s.table.rows.flat()] : [])])
      .join("\n");
    const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
    expect(numbers.length).toBeGreaterThan(4);
    for (const n of numbers) expect(allowed.has(n), `unexpected number ${n}`).toBe(true);
    expect(text).toContain("91 / 100");
    expect(text).toContain("0.94");
    expect(text).toContain("74 / 100");
    expect(text).toContain(TO_CONFIRM_COMMERCIAL);
    expect(text).not.toMatch(/reach of|impressions of|\$|€|£|fee of/i);
  });

  it("templates the pitch from names and Qloo values only", () => {
    expect(pitchText(p)).toBe(
      "Ali Wong and Liquid Death share an audience. Qloo puts Liquid Death at an affinity of 0.94 among Ali Wong fans. It puts Ali Wong at 0.88 among Liquid Death fans. The audience is strongest in Los Angeles and Seattle. We would like to explore a partnership that puts Liquid Death in front of these fans.",
    );
  });

  it("fit scores reach the screen and the deck only from engine code", () => {
    for (const f of ["components/workspace/sponsorship.tsx", "lib/sponsorship/service.ts", "lib/export/sponsor.ts", "lib/tools/sponsor.ts", "app/api/workspace/sponsorship/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/fit:\s*(Math|\d)/);
      expect(src, f).not.toMatch(/\.fit\s*[*/+-]\s*\d|affinity\s*[*/+-]\s*\d/);
    }
  });
});
