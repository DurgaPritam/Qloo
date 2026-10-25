import { describe, expect, it } from "vitest";

import { scoreCities } from "@/lib/engine/cities";
import { CITIES } from "@/lib/engine/data";
import { planTour } from "@/lib/engine/tour";
import type { City, CityScore } from "@/lib/engine/types";

const find = (name: string, country: string) => CITIES.find((c) => c.name === name && c.country === country)!;

/** CityScores in the given rank order with the given combined scores. */
function ranked(cities: City[], combined: number[]): CityScore[] {
  return cities.map((city, i) => ({
    kind: "city",
    city,
    sA: combined[i],
    sB: combined[i],
    combined: combined[i],
    rank: i + 1,
    populationRank: i + 1,
    confidence: "high",
    evidence: { cellsA: 3, cellsB: 3 },
  }));
}

describe("planTour", () => {
  const west = ["Seattle", "Portland", "San Francisco", "Los Angeles", "San Diego"].map((n) => find(n, "US"));

  it("orders stops to keep total travel shortest, with legs computed in code", () => {
    // Ranked out of geographic order on purpose.
    const tour = planTour(ranked([west[3], west[0], west[4], west[2], west[1]], [0.9, 0.85, 0.8, 0.75, 0.7]), { stops: 5 });

    const names = tour.stops.map((s) => s.city.name);
    // A coastal line, in either direction, never zig-zagging.
    expect([names.join(">"), [...names].reverse().join(">")]).toContain("San Diego>Los Angeles>San Francisco>Portland>Seattle");
    expect(tour.stops[0].legKm).toBe(0);
    expect(tour.totalKm).toBe(tour.stops.reduce((s, x) => s + x.legKm, 0));
    expect(tour.totalKm).toBeGreaterThan(1500);
    expect(tour.totalKm).toBeLessThan(2200);
    expect(tour.fallback).toBe(false);
  });

  it("skips cities too close to a better one and too weak to stop in", () => {
    const la = find("Los Angeles", "US");
    const longBeach = find("Long Beach", "US");
    const sd = find("San Diego", "US");
    const sf = find("San Francisco", "US");
    const tour = planTour(ranked([la, longBeach, sd, sf], [0.9, 0.88, 0.2, 0.7]), { stops: 4 });

    expect(tour.stops.map((s) => s.city.name).sort()).toEqual(["Los Angeles", "San Francisco"]);
    expect(tour.fallback).toBe(true);
    expect(tour.reason).toMatch(/Only 2 cities/);
  });

  it("labels a fallback when fewer than two cities qualify", () => {
    const tour = planTour(ranked([west[0], west[1]], [0.9, 0.1]));
    expect(tour).toMatchObject({ totalKm: 0, fallback: true });
    expect(tour.stops).toHaveLength(1);
  });

  it("caps stops at the configured maximum and works on real scores", () => {
    const heat = CITIES.slice(0, 60).map((c, i) => ({ lat: c.lat, lon: c.lon, affinity: 0.4 + (i % 7) / 12 }));
    const scores = scoreCities(heat, heat, CITIES.slice(0, 60), 0);
    const tour = planTour(scores, { stops: 20 });
    expect(tour.stops.length).toBeLessThanOrEqual(8);
  });
});

describe("planTour scope", () => {
  const us = ["Austin", "Chicago", "Seattle", "Nashville"].map((n) => find(n, "US"));
  const far = [find("London", "GB"), find("Mexico City", "MX")];

  it("always includes the chosen city and stays in its country", () => {
    // Chicago is chosen though Austin ranks first; London and Mexico City score well but are abroad.
    const scores = ranked([us[0], far[0], us[1], far[1], us[2], us[3]], [0.9, 0.88, 0.8, 0.79, 0.7, 0.6]);
    const tour = planTour(scores, { anchorId: us[1].id, stops: 6 });

    const names = tour.stops.map((s) => s.city.name);
    expect(names).toContain("Chicago");
    expect(names).not.toContain("London");
    expect(names).not.toContain("Mexico City");
    expect(tour.stops.every((s) => s.city.country === "US")).toBe(true);
    expect(tour.reason).toMatch(/in US/);
  });

  it("widens to a radius around the chosen city when its country is too thin, and says so", () => {
    const toronto = find("Toronto", "CA");
    const scores = ranked([toronto, find("Chicago", "US"), find("New York City", "US"), find("London", "GB")], [0.9, 0.8, 0.7, 0.85]);
    const tour = planTour(scores, { anchorId: toronto.id, stops: 4 });

    expect(tour.stops.map((s) => s.city.name)).toEqual(expect.arrayContaining(["Toronto", "Chicago", "New York City"]));
    expect(tour.stops.map((s) => s.city.name)).not.toContain("London");
    expect(tour.fallback).toBe(true);
    expect(tour.reason).toMatch(/within 2,500 km of Toronto/);
  });
});
