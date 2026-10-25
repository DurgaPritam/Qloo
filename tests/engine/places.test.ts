import { describe, expect, it } from "vitest";

import { rankBrands, rankPlaces } from "@/lib/engine/places";
import type { Brand, Place } from "@/lib/engine/types";

const place = (id: string, affinity: number, tags: string[], popularity = 0.5): Place => ({
  id,
  name: id,
  affinity,
  popularity,
  tags,
});

const brand = (id: string, affinity: number, popularity: number): Brand => ({
  id,
  name: id,
  affinity,
  popularity,
});

describe("rankPlaces", () => {
  it("prefers places matching the requested tags, with evidence", () => {
    const res = rankPlaces(
      [place("bar-only", 0.8, ["bar"]), place("venue", 0.7, ["Music Venue"])],
      ["music venue"],
    );

    expect(res.picks[0].place.id).toBe("venue");
    expect(res.picks[0].evidence).toEqual({
      affinity: 0.7,
      popularity: 0.5,
      matchedTags: ["music venue"],
      requestedTags: ["music venue"],
    });
    expect(res.picks[1].confidence).toBe("low");
    expect(res.fallback).toBe(false);
  });

  it("does not discount popular venues", () => {
    const res = rankPlaces([place("famous", 0.8, [], 0.99), place("small", 0.6, [], 0.1)], []);

    expect(res.picks.map((p) => p.place.id)).toEqual(["famous", "small"]);
  });

  it("labels a fallback when nothing matches the tags or nothing is returned", () => {
    const noMatch = rankPlaces([place("bar", 0.8, ["bar"])], ["music venue"]);
    expect(noMatch.fallback).toBe(true);
    expect(noMatch.reason).toMatch(/no place matched music venue/i);

    const empty = rankPlaces([], ["music venue"]);
    expect(empty).toMatchObject({ picks: [], fallback: true });
    expect(empty.reason).toMatch(/no places were returned/i);
  });
});

describe("rank confidence", () => {
  it("rises with the number of qualifying results", () => {
    const five = rankPlaces(
      [0.9, 0.7, 0.6, 0.5, 0.4].map((a, i) => place(`p${i}`, a, ["bar"])),
      ["bar"],
    );
    expect(five.picks.map((p) => p.confidence)).toEqual(["high", "high", "high", "high", "high"]);

    const two = rankPlaces([place("a", 0.9, ["bar"]), place("b", 0.5, ["bar"])], ["bar"]);
    expect(two.picks.map((p) => p.confidence)).toEqual(["medium", "medium"]);

    const one = rankPlaces([place("a", 0.9, ["bar"])], ["bar"]);
    expect(one.picks[0].confidence).toBe("low");
  });

  it("lowers the top pick when first and second are nearly tied", () => {
    // Relative affinity within the list: median 0.90 → a = 1, b = 0.98, c = 0; a and b nearly tie.
    const res = rankBrands([
      brand("a", 0.95, 0.9),
      brand("b", 0.949, 0.9),
      brand("c", 0.9, 0.9),
      brand("d", 0.89, 0.9),
      brand("e", 0.88, 0.9),
    ]);
    expect(res.picks.map((p) => p.brand.id)).toEqual(["a", "b", "c"]);
    expect(res.picks.map((p) => p.confidence)).toEqual(["low", "medium", "medium"]);
  });

  it("treats requested tags as alternatives, preferring the first", () => {
    const res = rankPlaces([place("hall", 0.7, ["concert hall"])], ["music venue", "concert hall"]);
    expect(res.picks[0].score).toBeCloseTo(0.7 * 0.9);
    expect(res.fallback).toBe(false);
  });

  it("weights down rooms of the wrong size for the format", () => {
    const res = rankPlaces(
      [place("stadium", 0.9, ["live music venue", "stadium"]), place("club", 0.85, ["live music venue"])],
      ["live music venue"],
      5,
      ["stadium", "arena"],
    );
    expect(res.picks.map((p) => p.place.id)).toEqual(["club", "stadium"]);
  });
});

describe("rankBrands", () => {
  it("applies the popularity band and the niche score", () => {
    const res = rankBrands([
      brand("everywhere", 0.97, 0.9999),
      brand("mainstream", 0.95, 0.999),
      brand("niche", 0.95, 0.95),
      brand("weak", 0.9, 0.95),
      brand("unknown", 0.96, 0.2),
    ]);

    expect(res.picks[0].brand.id).toBe("niche");
    expect(res.dropped).toEqual(
      expect.arrayContaining([
        { item: expect.objectContaining({ id: "everywhere" }), reason: "too_popular" },
        { item: expect.objectContaining({ id: "unknown" }), reason: "too_obscure" },
      ]),
    );
  });

  it("never offers nonprofits or government programmes as sponsors", () => {
    const res = rankBrands([
      { ...brand("ngo", 0.99, 0.95), brandTypes: ["Nonprofit Brand"] },
      { ...brand("agency", 0.98, 0.95), brandTypes: ["Government Brand"] },
      { ...brand("media", 0.95, 0.95), brandTypes: ["Media Brand"] },
    ]);
    expect(res.picks.map((p) => p.brand.id)).toEqual(["media"]);
    expect(res.reason).toMatch(/2 nonprofit or government/);
  });

  it("returns fallback with a reason when nothing qualifies", () => {
    const res = rankBrands([brand("everywhere", 0.95, 0.9999)]);
    expect(res).toMatchObject({ picks: [], fallback: true });
    expect(res.reason).toMatch(/1 too mainstream/);
  });
});
