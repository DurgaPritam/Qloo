import { describe, expect, it } from "vitest";

import { ENGINE_CONFIG } from "@/lib/engine/config";
import { CITIES } from "@/lib/engine/data";
import { distanceKm } from "@/lib/engine/geo";
import { optimizeRoute, satisfies, type RouteCity, type RouteConstraints } from "@/lib/engine/route";

const city = (name: string, score: number): RouteCity => {
  const c = CITIES.find((x) => x.name === name && x.country === "US")!;
  return { id: c.id, name: c.name, country: c.country, lat: c.lat, lon: c.lon, score, cells: 10 };
};

/** Fifteen US cities with made-up scores (test input, not Qloo data). */
const US = [
  city("Los Angeles", 0.91), city("New York City", 0.77), city("Chicago", 0.79), city("Austin", 0.79), city("Seattle", 0.74),
  city("Portland", 0.62), city("San Francisco", 0.7), city("Denver", 0.66), city("Nashville", 0.68), city("Atlanta", 0.58),
  city("Phoenix", 0.6), city("Boston", 0.72), city("Philadelphia", 0.65), city("Minneapolis", 0.55), city("Houston", 0.64),
];
const id = (name: string) => US.find((c) => c.name === name)!.id;
const names = (r: ReturnType<typeof optimizeRoute>) => r.stops.map((s) => s.city.name);

/** A small seeded generator, so the random cases are the same every run. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("distance math", () => {
  it("is great-circle distance from coordinates", () => {
    const la = US.find((c) => c.name === "Los Angeles")!;
    const ny = US.find((c) => c.name === "New York City")!;
    expect(distanceKm(la.lat, la.lon, ny.lat, ny.lon)).toBeGreaterThan(3900);
    expect(distanceKm(la.lat, la.lon, ny.lat, ny.lon)).toBeLessThan(3990);
    expect(distanceKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(344, -1); // London–Paris
    expect(distanceKm(10, 20, 10, 20)).toBe(0);
  });

  it("reports each leg and the total from the stops' coordinates", () => {
    const r = optimizeRoute(US, { stops: 4, maxLegKm: null });
    let sum = 0;
    r.stops.forEach((s, i) => {
      if (i === 0) return expect(s.legKm).toBe(0);
      const p = r.stops[i - 1].city;
      expect(s.legKm).toBe(Math.round(distanceKm(p.lat, p.lon, s.city.lat, s.city.lon)));
      sum += distanceKm(p.lat, p.lon, s.city.lat, s.city.lon);
    });
    expect(r.totalKm).toBe(Math.round(sum));
    expect(r.objective).toBeCloseTo(r.scoreSum - (r.distanceWeight * sum) / 1000);
  });
});

describe("constraints are always respected", () => {
  it("over 300 random constraint sets, every route passes the constraint check (or none is returned, with the reason)", () => {
    const rand = rng(42);
    const pickCity = () => US[Math.floor(rand() * US.length)].id;
    let routes = 0;
    for (let i = 0; i < 300; i++) {
      const c: RouteConstraints = {
        stops: 2 + Math.floor(rand() * 7),
        maxLegKm: rand() < 0.3 ? null : 800 + Math.floor(rand() * 3000),
        startId: rand() < 0.4 ? pickCity() : null,
        endId: rand() < 0.3 ? pickCity() : null,
        include: rand() < 0.4 ? [pickCity()] : [],
        exclude: rand() < 0.5 ? [pickCity(), pickCity()] : [],
      };
      const r = optimizeRoute(US, c);
      if (r.infeasible) {
        expect(r.stops).toEqual([]);
        continue;
      }
      routes++;
      expect(satisfies(r.stops.map((s) => s.city), c, US), JSON.stringify(c)).toBe(true);
    }
    expect(routes).toBeGreaterThan(100);
  });

  it("puts the start first and the end last, keeps includes, drops excludes, and keeps every leg under the maximum", () => {
    const r = optimizeRoute(US, { stops: 5, maxLegKm: 2500, startId: id("Seattle"), endId: id("Boston"), include: [id("Denver")], exclude: [id("Los Angeles")] });
    expect(r.infeasible).toBeNull();
    expect(names(r)[0]).toBe("Seattle");
    expect(names(r).at(-1)).toBe("Boston");
    expect(names(r)).toContain("Denver");
    expect(names(r)).not.toContain("Los Angeles");
    expect(r.stops.every((s) => s.legKm <= 2500)).toBe(true);
    expect(r.stops.map((s) => s.role)).toEqual(["start", ...r.stops.slice(1, -1).map((s) => (s.city.name === "Denver" ? "included" : "chosen")), "end"]);
  });

  it("returns no route, and says which constraint, when they cannot all be met", () => {
    expect(optimizeRoute(US, { stops: 3, maxLegKm: null, include: [id("Austin")], exclude: [id("Austin")] }).infeasible).toMatch(/both required and excluded/);
    expect(optimizeRoute(US, { stops: 2, maxLegKm: null, startId: id("Seattle"), endId: id("Boston"), include: [id("Denver")] }).infeasible).toMatch(/more than the 2 stops/);
    const r = optimizeRoute(US, { stops: 3, maxLegKm: 500, startId: id("Seattle"), endId: id("Boston") });
    expect(r.infeasible).toMatch(/every leg under 500 km/);
    expect(r.stops).toEqual([]);
  });

  it("gives fewer stops, and says so, when no route of the asked length fits", () => {
    const r = optimizeRoute(US, { stops: 6, maxLegKm: 700, startId: id("Seattle") });
    expect(r.infeasible).toBeNull();
    expect(r.stops.length).toBeLessThan(6);
    expect(r.note).toMatch(/^Only \d stops? fit your constraints\.$/);
    expect(r.stops.every((s) => s.legKm <= 700)).toBe(true);
  });
});

describe("determinism and search", () => {
  it("gives the same route for the same inputs, in any input order", () => {
    const c: RouteConstraints = { stops: 6, maxLegKm: 3000, include: [id("Nashville")] };
    const a = optimizeRoute(US, c);
    const shuffled = [...US].reverse();
    const b = optimizeRoute(shuffled, c);
    const again = optimizeRoute(US, c);
    expect(names(b)).toEqual(names(a));
    expect(again).toEqual(a);
    expect(a.method).toBe("heuristic");
  });

  it("searches exactly when the candidates are few, and the heuristic comes close to the exact answer", () => {
    const small = US.slice(0, ENGINE_CONFIG.route.exactMaxCandidates);
    const c: RouteConstraints = { stops: 5, maxLegKm: null };
    const ex = optimizeRoute(small, c);
    expect(ex.method).toBe("exact");
    // Force the heuristic on the same nine cities by padding with cities that can never be picked.
    const pad = Array.from({ length: 6 }, (_, i) => ({ ...US[0], id: `zz${i}`, name: `Far ${i}`, lat: -40 - i * 3, lon: 170, score: 0 }));
    const he = optimizeRoute([...small, ...pad], c);
    expect(he.method).toBe("heuristic");
    expect(he.objective).toBeGreaterThanOrEqual(ex.objective * 0.97);
  });

  it("trades score against distance by the weight it shows", () => {
    const far = optimizeRoute(US, { stops: 4, maxLegKm: null, distanceWeight: 0 });
    const near = optimizeRoute(US, { stops: 4, maxLegKm: null, distanceWeight: 60 });
    expect(far.distanceWeight).toBe(0);
    expect(near.totalKm).toBeLessThan(far.totalKm);
    expect(far.scoreSum).toBeGreaterThanOrEqual(near.scoreSum);
  });
});

describe("why not", () => {
  it("names the constraint or trade-off that kept each strong city off", () => {
    const r = optimizeRoute(US, { stops: 3, maxLegKm: 1600, startId: id("Seattle"), exclude: [id("Los Angeles")] });
    const why = new Map(r.whyNot.map((w) => [w.city.name, w.reason]));
    expect(why.get("Los Angeles")).toEqual({ kind: "excluded", text: "You excluded it." });
    const kinds = new Set(r.whyNot.map((w) => w.reason.kind));
    expect(kinds.has("max_leg") || kinds.has("objective")).toBe(true);
    for (const w of r.whyNot) expect(names(r)).not.toContain(w.city.name);
    const nyc = why.get("New York City")!;
    expect(nyc.kind).toBe("max_leg");
    expect(nyc.text).toBe("Every place on the route would need a leg over 1,600 km.");
  });

  it("explains spacing: a strong city too close to a stop", () => {
    const sf = US.find((c) => c.name === "San Francisco")!;
    const oakland: RouteCity = { ...sf, id: "oak", name: "Oakland", lat: 37.8044, lon: -122.2712, score: 0.69 };
    const r = optimizeRoute([...US, oakland], { stops: 4, maxLegKm: null, include: [sf.id] });
    const reason = r.whyNot.find((w) => w.city.name === "Oakland")?.reason;
    expect(reason?.kind).toBe("spacing");
    expect(reason?.text).toMatch(/km from San Francisco, under the 150 km minimum between stops\./);
  });

  it("explains a trade-off with the points it would cost", () => {
    const r = optimizeRoute(US, { stops: 3, maxLegKm: null, distanceWeight: 20 });
    const obj = r.whyNot.find((w) => w.reason.kind === "objective");
    expect(obj?.reason.text).toMatch(/scores \d+\.\d points less once distance is counted\./);
  });
});
