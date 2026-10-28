import "server-only";

import { cityHeat, scoreCityHeat } from "@/lib/engine/cities";
import { cityIndex, matchCity, type CityIndex } from "@/lib/engine/city-match";
import { CITIES } from "@/lib/engine/data";
import { formatFor } from "@/lib/engine/formats";
import { countryCode, DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { optimizeRoute, type RouteCity, type RouteResult } from "@/lib/engine/route";
import type { City, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";

import { describeFailure, metroPool, resolveEntity, view, type CallView, type Resolved } from "./shared";

/**
 * Tour optimizer: the fanbase's heat in each country of the region (one Qloo heatmap each), cities
 * scored by the engine, then optimizeRoute under the user's constraints. The constraints are the
 * user's own and are shown as "Your data"; they never change a Qloo score.
 */

/** Regions offered besides a single country: at most five countries, one heatmap each. */
export const REGIONS: Record<string, { label: string; countries: string[] }> = {
  "us-ca": { label: "United States and Canada", countries: ["US", "CA"] },
  "uk-ie": { label: "UK and Ireland", countries: ["GB", "IE"] },
  "w-europe": { label: "Western Europe", countries: ["GB", "FR", "DE", "NL", "ES"] },
  "au-nz": { label: "Australia and New Zealand", countries: ["AU", "NZ"] },
};

export interface TourInput {
  /** A REGIONS key, an ISO country code, or empty for the fanbase's home country. */
  region?: string;
  stops: number;
  maxLegKm: number | null;
  start?: string;
  end?: string;
  include?: string[];
  exclude?: string[];
}

export type TourResult =
  | ({ status: "choose" | "none"; calls: CallView[]; mock: boolean } & Partial<Extract<Resolved, { kind: "choose" }>>)
  | {
      status: "done";
      fanbase: Entity;
      markets: Market[];
      route: RouteResult;
      /** The constraints as understood: typed names matched to cities, and those that did not match. */
      understood: { start: string | null; end: string | null; include: string[]; exclude: string[]; unmatched: string[] };
      /** The heatmap request behind each country's scores, for evidence. */
      heatCalls: Record<string, CallView>;
      /** Countries Qloo did not answer for; their cities are left out. */
      missing: string[];
      calls: CallView[];
      mock: boolean;
    };

let index: CityIndex | undefined;
const cities = () => (index ??= cityIndex(CITIES, metroPool()));

export function regionCountries(region: string | undefined, fanbase: Entity): string[] {
  if (region && REGIONS[region]) return REGIONS[region].countries;
  const one = region && marketFor(region) ? region.toUpperCase() : null;
  return [one ?? marketFor(fanbase.homeCountry)?.code ?? DEFAULT_MARKET];
}

/** A typed city, inside the region's countries; null when no single city matches. */
function cityIn(name: string, countries: readonly string[]): City | null {
  const m = matchCity(name, cities(), { countryCode });
  if (m.status === "matched") return countries.includes(m.city.country) ? m.city : null;
  if (m.status === "ambiguous") {
    const inside = m.options.filter((o) => countries.includes(o.country));
    return inside.length === 1 ? inside[0] : null;
  }
  return null;
}

export async function optimizeFanTour(query: string, entityId: string | undefined, input: TourInput, source: QlooSource, opts: { runId: string }): Promise<TourResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, FANBASE_CATEGORIES, entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", calls, mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, calls, mock: source.mock };
  const fanbase = resolved.entity;
  const countries = regionCountries(input.region, fanbase);
  const markets = countries.map((c) => marketFor(c)!).filter(Boolean);
  const format = formatFor(fanbase);

  const heatCalls: Record<string, CallView> = {};
  const missing: string[] = [];
  const scored: RouteCity[] = [];
  await Promise.all(
    markets.map(async (market) => {
      try {
        const res = await source.heatmap([fanbase.id], market.name, opts);
        calls.push(view(res.meta));
        heatCalls[market.code] = view(res.meta);
        const pool = metroPool().filter((c) => c.country === market.code);
        const heat = cityHeat(res.data, pool);
        // Scaled to the hottest city in each country (heatmaps are per country).
        for (const s of scoreCityHeat(heat, heat, pool, format.minPopulation)) {
          if (s.combined > 0) scored.push({ id: s.city.id, name: s.city.name, country: s.city.country, lat: s.city.lat, lon: s.city.lon, score: s.combined, cells: s.evidence.cellsA });
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        console.warn("[tools/tour] heatmap failed:", describeFailure(err));
        missing.push(market.name);
      }
    }),
  );

  // Typed cities: matched inside the region; a named city with no heat can still be a stop (score 0).
  const unmatched: string[] = [];
  const named = (name: string | undefined) => {
    const n = name?.trim();
    if (!n) return null;
    const c = cityIn(n, countries);
    if (!c) {
      unmatched.push(n);
      return null;
    }
    if (!scored.some((s) => s.id === c.id)) scored.push({ id: c.id, name: c.name, country: c.country, lat: c.lat, lon: c.lon, score: 0, cells: 0 });
    return c;
  };
  const start = named(input.start);
  const end = named(input.end);
  const include = (input.include ?? []).map(named).filter((c): c is City => c !== null);
  const exclude = (input.exclude ?? []).map(named).filter((c): c is City => c !== null);

  const route = optimizeRoute(scored, {
    stops: input.stops,
    maxLegKm: input.maxLegKm,
    startId: start?.id,
    endId: end?.id,
    include: include.map((c) => c.id),
    exclude: exclude.map((c) => c.id),
  });
  return {
    status: "done",
    fanbase,
    markets,
    route,
    understood: { start: start?.name ?? null, end: end?.name ?? null, include: include.map((c) => c.name), exclude: exclude.map((c) => c.name), unmatched },
    heatCalls,
    missing,
    calls,
    mock: source.mock,
  };
}
