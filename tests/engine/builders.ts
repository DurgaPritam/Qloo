import type { Candidate, City, HeatCell } from "@/lib/engine/types";

/** Hand-built engine inputs. Not Qloo data: tests/fixtures/ is reserved for real responses. */

export function candidate(
  id: string,
  category: Candidate["category"],
  affinity: number,
  popularity: number,
): Candidate {
  return { id, name: id, category, affinity, popularity };
}

export function city(id: string, lat: number, lon: number, population: number): City {
  return { id, name: id, country: "Testland", lat, lon, population };
}

/** `count` cells of equal affinity at a city centre. */
export function heatAt(c: City, affinity: number, count = 3): HeatCell[] {
  return Array.from({ length: count }, () => ({ lat: c.lat, lon: c.lon, affinity }));
}

// Far enough apart that radii never overlap.
export const ALPHA = city("alpha", 10, 10, 5_000_000);
export const BETA = city("beta", 20, 20, 2_000_000);
export const GAMMA = city("gamma", 30, 30, 800_000);
export const TINY = city("tiny", 40, 40, 50_000);
