import { ENGINE_CONFIG } from "./config";
import { distanceKm } from "./geo";
import type { CityScore, TourPlan, TourStop } from "./types";

/**
 * Turns ranked cities into a tour: the best-scoring cities at least `minSpacingKm` apart, in the
 * order that makes the total travel shortest (exact search over every order; stops are few).
 * Distances are great-circle km, computed here.
 */
export function planTour(
  scores: readonly CityScore[],
  opts: { anchorId?: string; stops?: number; minSpacingKm?: number; minCombined?: number } = {},
): TourPlan {
  const cfg = ENGINE_CONFIG.tour;
  const want = Math.min(opts.stops ?? cfg.stops, cfg.maxStops);
  const spacing = opts.minSpacingKm ?? cfg.minSpacingKm;
  const floor = opts.minCombined ?? cfg.minCombined;
  const ranked = [...scores].sort((a, b) => a.rank - b.rank);
  // The chosen city is always on the tour; without one, the top city leads.
  const anchor = ranked.find((s) => s.city.id === opts.anchorId) ?? ranked[0];
  if (!anchor) return { stops: [], totalKm: 0, fallback: true, reason: "No cities were scored." };

  const pick = (pool: CityScore[]) => {
    const picked = [anchor];
    for (const s of pool) {
      if (picked.length === want) break;
      if (s === anchor || s.combined < floor) continue;
      if (picked.some((p) => km(p, s) < spacing)) continue;
      picked.push(s);
    }
    return picked;
  };

  // A tour stays in one country when it can; otherwise within reach of the chosen city.
  let picked = pick(ranked.filter((s) => s.city.country === anchor.city.country));
  let widened = false;
  if (picked.length < Math.min(cfg.minStopsInCountry, want)) {
    picked = pick(ranked.filter((s) => km(anchor, s) <= cfg.widenKm));
    widened = true;
  }

  if (picked.length < 2) {
    return {
      stops: picked.map((s) => stop(s, 0)),
      totalKm: 0,
      fallback: true,
      reason: `Only ${picked.length} ${picked.length === 1 ? "city scores" : "cities score"} high enough for a tour stop.`,
    };
  }

  const order = shortestOpenPath(picked, anchor);
  const stops = order.map((s, i) => stop(s, i === 0 ? 0 : km(order[i - 1], s)));
  const totalKm = stops.reduce((sum, s) => sum + s.legKm, 0);
  const scope = widened
    ? `within ${cfg.widenKm.toLocaleString("en-GB")} km of ${anchor.city.name}`
    : `in ${anchor.city.country}`;
  let reason = `${picked.length} stops ${scope}, ordered to keep travel short.`;
  if (picked.length < want) {
    reason = `Only ${picked.length} cities ${scope}, at least ${spacing} km apart, score high enough for a stop.`;
  }
  return { stops, totalKm, fallback: picked.length < want || widened, reason };
}

function stop(s: CityScore, legKm: number): TourStop {
  return { city: s.city, combined: s.combined, rank: s.rank, legKm: Math.round(legKm) };
}

function km(a: CityScore, b: CityScore): number {
  return distanceKm(a.city.lat, a.city.lon, b.city.lat, b.city.lon);
}

/**
 * Exact shortest path visiting every city once, any start, read so that it begins at whichever
 * end is closer to the anchor (usually the anchor itself).
 */
function shortestOpenPath(cities: CityScore[], anchor: CityScore): CityScore[] {
  let best: number[] = [];
  let bestKm = Infinity;
  const n = cities.length;
  const d = cities.map((a) => cities.map((b) => km(a, b)));
  const used = new Array<boolean>(n).fill(false);
  const path: number[] = [];

  const visit = (sofar: number) => {
    if (sofar >= bestKm) return;
    if (path.length === n) {
      bestKm = sofar;
      best = [...path];
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      const last = path.at(-1);
      path.push(i);
      visit(sofar + (last === undefined ? 0 : d[last][i]));
      path.pop();
      used[i] = false;
    }
  };
  visit(0);

  const ordered = best.map((i) => cities[i]);
  return km(ordered[0], anchor) <= km(ordered.at(-1)!, anchor) ? ordered : ordered.reverse();
}
