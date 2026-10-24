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
    const res = rankBrands([brand("a", 0.6, 0.2), brand("b", 0.59, 0.2), brand("c", 0.3, 0.2)]);
    expect(res.picks.map((p) => p.confidence)).toEqual(["low", "medium", "medium"]);
  });

  it("treats requested tags as alternatives", () => {
    const res = rankPlaces([place("hall", 0.7, ["concert hall"])], ["music venue", "concert hall"]);
    expect(res.picks[0].score).toBeCloseTo(0.7);
    expect(res.fallback).toBe(false);
  });
});

describe("rankBrands", () => {
  it("applies the bias guard and niche score", () => {
    const res = rankBrands([
      brand("everywhere", 0.95, 0.99),
      brand("mainstream", 0.8, 0.9),
      brand("niche", 0.6, 0.2),
    ]);

    expect(res.picks.map((p) => p.brand.id)).toEqual(["niche", "mainstream"]);
    expect(res.dropped).toEqual([
      { item: expect.objectContaining({ id: "everywhere" }), reason: "too_popular" },
    ]);
    expect(res.picks[0].confidence).toBe("medium");
  });

  it("returns fallback with a reason when nothing qualifies", () => {
    const res = rankBrands([brand("everywhere", 0.95, 0.99)]);

    expect(res).toMatchObject({ picks: [], fallback: true });
    expect(res.reason).toMatch(/1 too mainstream/);
  });
});
