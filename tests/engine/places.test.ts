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
    expect(noMatch.reason).toMatch(/no venue matched/i);

    const empty = rankPlaces([], ["music venue"]);
    expect(empty).toMatchObject({ picks: [], fallback: true });
    expect(empty.reason).toMatch(/no venues were returned/i);
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
