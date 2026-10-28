import "server-only";

import { cityHeat, scoreCityHeat, type Heat } from "@/lib/engine/cities";
import { cityIndex, matchCity, type CityIndex } from "@/lib/engine/city-match";
import { CITIES } from "@/lib/engine/data";
import { formatFor } from "@/lib/engine/formats";
import { countryCode, DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { optimizeRoute, type RouteCity, type RouteResult } from "@/lib/engine/route";
import type { City, Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { kvGet, kvSet } from "@/lib/server/kv";

import { describeFailure, metroPool, resolveEntity, view, type CallView, type Resolved } from "./shared";

/**
 * Tour optimizer: the fanbase's heat in each country of the region (one Qloo heatmap each), cities
 * scored by the engine on one scale across the region, then optimizeRoute under the user's constraints. The constraints are the
 * user's own and are shown as "Your data"; they never change a Qloo score.
 */

/**
 * Regions offered besides a single country: at most five countries, one heatmap each. US regions
 * are the Census regions: one US heatmap, then only cities in those states.
 */
const US_WEST = ["Alaska", "Arizona", "California", "Colorado", "Hawaii", "Idaho", "Montana", "Nevada", "New Mexico", "Oregon", "Utah", "Washington", "Wyoming"];
const US_MIDWEST = ["Illinois", "Indiana", "Iowa", "Kansas", "Michigan", "Minnesota", "Missouri", "Nebraska", "North Dakota", "Ohio", "South Dakota", "Wisconsin"];
const US_SOUTH = ["Alabama", "Arkansas", "Delaware", "District of Columbia", "Florida", "Georgia", "Kentucky", "Louisiana", "Maryland", "Mississippi", "North Carolina", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Virginia", "West Virginia"];
const US_NORTHEAST = ["Connecticut", "Maine", "Massachusetts", "New Hampshire", "New Jersey", "New York", "Pennsylvania", "Rhode Island", "Vermont"];

export const REGIONS: Record<string, { label: string; countries: string[]; states?: string[] }> = {
  "us-ca": { label: "United States and Canada", countries: ["US", "CA"] },
  "us-west": { label: "US West", countries: ["US"], states: US_WEST },
  "us-midwest": { label: "US Midwest", countries: ["US"], states: US_MIDWEST },
  "us-south": { label: "US South", countries: ["US"], states: US_SOUTH },
  "us-northeast": { label: "US Northeast", countries: ["US"], states: US_NORTHEAST },
  "uk-ie": { label: "UK and Ireland", countries: ["GB", "IE"] },
  "w-europe": { label: "Western Europe", countries: ["GB", "FR", "DE", "NL", "ES"] },
  "au-nz": { label: "Australia and New Zealand", countries: ["AU", "NZ"] },
};

/** Distance weight bounds for the UI's slider (km cost per 1,000 km, in score points). */
export const DISTANCE_WEIGHT = { min: 0, max: 20 } as const;

export interface TourInput {
  /** A REGIONS key, an ISO country code, or empty for the fanbase's home country. */
  region?: string;
  stops: number;
  maxLegKm: number | null;
  start?: string;
  end?: string;
  include?: string[];
  exclude?: string[];
  /** Score points a 1,000 km drive costs; default from the engine config. */
  distanceWeight?: number;
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
      /** The US states the region is limited to, when it is a US region. */
      states: string[] | null;
      calls: CallView[];
      mock: boolean;
    };

/** A finished tour, as saved to a workspace. */
export type SavedTourResult = Extract<TourResult, { status: "done" }>;

const TOUR_DRAFT_TTL = 24 * 60 * 60;
const tourDraftKey = (id: string) => `takeover:tour:draft:v1:${id}`;

/** Keeps a finished tour server-side for a day, so saving it stores the engine's result, not the browser's copy. */
export async function saveTourDraft(result: SavedTourResult): Promise<string> {
  const id = crypto.randomUUID();
  await kvSet(tourDraftKey(id), result, TOUR_DRAFT_TTL);
  return id;
}

export async function tourDraft(id: string): Promise<SavedTourResult | null> {
  return /^[0-9a-f-]{36}$/.test(id) ? kvGet<SavedTourResult>(tourDraftKey(id)) : null;
}

let index: CityIndex | undefined;
const cities = () => (index ??= cityIndex(CITIES, metroPool()));

export function regionCountries(region: string | undefined, fanbase: Entity): string[] {
  if (region && REGIONS[region]) return REGIONS[region].countries;
  const one = region && marketFor(region) ? region.toUpperCase() : null;
  return [one ?? marketFor(fanbase.homeCountry)?.code ?? DEFAULT_MARKET];
}

/** A typed city, inside the region (its countries, and its states for a US region); null when no single city matches. */
function cityIn(name: string, countries: readonly string[], states: ReadonlySet<string> | null): City | null {
  const inside = (c: City) => countries.includes(c.country) && (!states || states.has(c.admin1));
  const m = matchCity(name, cities(), { countryCode });
  if (m.status === "matched") return inside(m.city) ? m.city : null;
  if (m.status === "ambiguous") {
    const options = m.options.filter(inside);
    return options.length === 1 ? options[0] : null;
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
  const states = input.region && REGIONS[input.region]?.states ? new Set(REGIONS[input.region].states) : null;
  const inRegion = (c: City) => !states || states.has(c.admin1);
  const heats = new Map<string, Heat>();
  const pools: City[][] = [];
  await Promise.all(
    markets.map(async (market) => {
      try {
        const res = await source.heatmap([fanbase.id], market.name, opts);
        calls.push(view(res.meta));
        heatCalls[market.code] = view(res.meta);
        const pool = metroPool().filter((c) => c.country === market.code && inRegion(c));
        for (const [id, h] of cityHeat(res.data, pool)) heats.set(id, h);
        pools.push(pool);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        console.warn("[tools/tour] heatmap failed:", describeFailure(err));
        missing.push(market.name);
      }
    }),
  );
  // One scale for the whole region: each city against the hottest city anywhere in it, so the route
  // compares like with like across borders. Each country's own scale is kept for display only.
  const byCountry = new Map<string, number>();
  for (const pool of pools) for (const s of scoreCityHeat(heats, heats, pool, format.minPopulation)) byCountry.set(s.city.id, s.combined);
  const scored: RouteCity[] = [];
  for (const s of scoreCityHeat(heats, heats, pools.flat(), format.minPopulation)) {
    if (s.combined > 0)
      scored.push({ id: s.city.id, name: s.city.name, country: s.city.country, lat: s.city.lat, lon: s.city.lon, score: s.combined, countryScore: byCountry.get(s.city.id) ?? 0, cells: s.evidence.cellsA });
  }

  // Typed cities: matched inside the region; a named city with no heat can still be a stop (score 0).
  const unmatched: string[] = [];
  const named = (name: string | undefined) => {
    const n = name?.trim();
    if (!n) return null;
    const c = cityIn(n, countries, states);
    if (!c) {
      unmatched.push(n);
      return null;
    }
    if (!scored.some((s) => s.id === c.id)) scored.push({ id: c.id, name: c.name, country: c.country, lat: c.lat, lon: c.lon, score: 0, countryScore: 0, cells: 0 });
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
    ...(input.distanceWeight !== undefined ? { distanceWeight: input.distanceWeight } : {}),
  });
  return {
    status: "done",
    fanbase,
    markets,
    route,
    understood: { start: start?.name ?? null, end: end?.name ?? null, include: include.map((c) => c.name), exclude: exclude.map((c) => c.name), unmatched },
    heatCalls,
    missing,
    states: states ? [...states] : null,
    calls,
    mock: source.mock,
  };
}
