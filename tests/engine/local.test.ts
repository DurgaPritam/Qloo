import { describe, expect, it } from "vitest";

import { CITIES } from "@/lib/engine/data";
import { findCity, rankLocal } from "@/lib/engine/local";
import type { Candidate } from "@/lib/engine/types";

const c = (name: string, popularity: number): Candidate => ({ id: name, name, category: "artist", popularity, affinity: 1 });

describe("rankLocal", () => {
  it("keeps Qloo's order inside the popularity band and merges repeated names", () => {
    const { picks, dropped } = rankLocal([c("Mega Star", 0.9999), c("Local Hero", 0.62), c("Obscure", 0.1), c("Band", 0.95), c("band", 0.9)]);
    expect(picks.map((p) => [p.rank, p.entity.name])).toEqual([
      [1, "Local Hero"],
      [2, "Band"],
    ]);
    expect(dropped).toBe(3);
  });
});

describe("findCity", () => {
  it("picks the largest city with the name, narrowed by region or country after a comma", () => {
    expect(findCity("Portland", CITIES)).toMatchObject({ name: "Portland", admin1: "Oregon" });
    expect(findCity("Manchester, UK", CITIES)).toMatchObject({ name: "Manchester", country: "GB" });
    expect(findCity("austin", CITIES)).toMatchObject({ name: "Austin", country: "US" });
    expect(findCity("Nowhereville", CITIES)).toBeNull();
    expect(findCity("", CITIES)).toBeNull();
  });

  it("forgives a typo or two, picking the largest of the nearest spellings", () => {
    expect(findCity("Ne york", CITIES)).toMatchObject({ name: "New York City", country: "US" });
    expect(findCity("Seatle", CITIES)).toMatchObject({ name: "Seattle" });
    expect(findCity("Machester, UK", CITIES)).toMatchObject({ name: "Manchester", country: "GB" });
    expect(findCity("Nashvile", CITIES)).toMatchObject({ name: "Nashville" });
    // Short names get no slack: "Rme" is not Rome.
    expect(findCity("Rme", CITIES)).toBeNull();
  });
});
