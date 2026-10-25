import { describe, expect, it } from "vitest";

import { FORMAT_BY_CATEGORY } from "@/lib/engine/config";
import { CITIES } from "@/lib/engine/data";
import { metroCities, nearestCities } from "@/lib/engine/metro";

const find = (name: string, country: string) => {
  const c = CITIES.find((x) => x.name === name && x.country === country);
  if (!c) throw new Error(`${name} missing from cities.json`);
  return c;
};

describe("cities.json", () => {
  it("holds GeoNames cities of 100k+ with every field", () => {
    expect(CITIES.length).toBeGreaterThan(4000);
    for (const c of CITIES) {
      expect(c.population).toBeGreaterThanOrEqual(100_000);
      expect(c.country).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
    expect(find("Chicago", "US").admin1).toBe("Illinois");
  });
});

describe("metroCities", () => {
  it("folds boroughs into the larger city but keeps separate cities", () => {
    const names = new Set(metroCities(CITIES).map((c) => c.name));
    expect(names.has("New York City")).toBe(true);
    expect(names.has("Brooklyn")).toBe(false);
    expect(names.has("London")).toBe(true);
    expect(names.has("Islington")).toBe(false);
    expect(names.has("Manchester")).toBe(true);
    expect(names.has("Leeds")).toBe(true);
  });

  it("never merges across a border", () => {
    const kept = metroCities(CITIES);
    const has = (name: string, country: string) => kept.some((c) => c.name === name && c.country === country);
    expect(has("San Diego", "US")).toBe(true);
    expect(has("Tijuana", "MX")).toBe(true);
    expect(has("El Paso", "US")).toBe(true);
    expect(has("Laredo", "US")).toBe(true);
  });
});

describe("nearestCities", () => {
  it("computes distances in code, closest first", () => {
    const leeds = find("Leeds", "GB");
    const near = nearestCities(leeds, [find("Manchester", "GB"), find("London", "GB")], 2);
    expect(near.map((n) => n.city.name)).toEqual(["Manchester", "London"]);
    expect(near[0].distanceKm).toBeGreaterThan(50);
    expect(near[0].distanceKm).toBeLessThan(65);
  });
});

describe("FORMAT_BY_CATEGORY", () => {
  it("maps fanbase types to the four formats", () => {
    expect(FORMAT_BY_CATEGORY.artist.format).toBe("tour_stop");
    expect(FORMAT_BY_CATEGORY.person.format).toBe("tour_stop");
    expect(FORMAT_BY_CATEGORY.movie.format).toBe("screening_tour");
    expect(FORMAT_BY_CATEGORY.podcast.format).toBe("live_show");
    expect(FORMAT_BY_CATEGORY.brand.format).toBe("fan_fest");
  });
});
