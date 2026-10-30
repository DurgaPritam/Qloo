import type { SavedTourResult } from "@/lib/tools/tour";

import { DEFAULT_PACE_KM, isIsoDate, newId, type Itinerary } from "./types";

/**
 * A finished Tour optimizer route as the planner's first draft: its cities in order, each with
 * the Qloo heat score and evidence the route used. Nothing else is filled in: venue, support act,
 * sponsors and dates are the user's to set (or to ask Qloo for, one stop at a time).
 * `admin1` fills each city's region from the city list when the caller has it (server side).
 */
export function itineraryFromTour(r: SavedTourResult, opts: { startDate?: string; admin1?: (cityId: string) => string } = {}): Itinerary {
  const regional = r.markets.length > 1 || Boolean(r.states);
  return {
    v: 1,
    name: `${r.fanbase.name} · ${r.route.stops.length} stops · ${r.markets.map((m) => m.name).join(", ")}`.slice(0, 120),
    fanbase: { id: r.fanbase.id, name: r.fanbase.name, category: r.fanbase.category },
    startDate: opts.startDate && isIsoDate(opts.startDate) ? opts.startDate : "",
    kmPerTravelDay: DEFAULT_PACE_KM,
    mock: r.mock,
    stops: r.route.stops.map((s) => {
      const call = r.heatCalls[s.city.country];
      const params = call ? Object.entries(call.params).filter(([k]) => k.startsWith("filter") || k.startsWith("signal")).map(([k, v]) => `${k}=${v}`).join(" · ") : "";
      return {
        id: newId(),
        city: { id: s.city.id, name: s.city.name, admin1: opts.admin1?.(s.city.id) ?? "", country: s.city.country, lat: s.city.lat, lon: s.city.lon },
        heat: s.city.cells > 0 ? { score: s.city.score, cells: s.city.cells, against: regional ? "the hottest city in the region" : `the hottest city in ${s.city.country}`, ...(call ? { call: `GET ${call.endpoint}${params ? ` · ${params}` : ""}`.slice(0, 400) } : {}) } : null,
        role: s.role,
        date: "",
        shows: 1,
        restAfter: 0,
        venue: null,
        support: null,
        sponsor: null,
        contacts: [],
        notes: "",
      };
    }),
  };
}
