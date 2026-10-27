import "server-only";

import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { scoreCities } from "@/lib/engine/cities";
import { DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import type { CityScore, Entity } from "@/lib/engine/types";
import type { QlooSource } from "@/lib/qloo/source";

import { describeFailure, metroPool, resolveEntity, view, type CallView, type Resolved } from "./shared";

/** Markets compared besides the fanbase's home: the largest English-speaking ones first. */
const MARKETS = ["US", "GB", "CA", "AU"];
const MIN_POPULATION = 150_000;

export interface MarketCities {
  market: Market;
  home: boolean;
  cities: CityScore[];
  error?: string;
}

export type CitiesResult =
  | ({ status: "choose" | "none"; calls: CallView[]; mock: boolean } & Partial<Extract<Resolved, { kind: "choose" }>>)
  | { status: "done"; fanbase: Entity; markets: MarketCities[]; calls: CallView[]; mock: boolean };

/**
 * City explorer: where one fanbase is strongest, market by market. One heatmap per market; cities
 * are scored by the takeover's city engine with the fanbase on both sides.
 */
export async function exploreCities(
  query: string,
  entityId: string | undefined,
  source: QlooSource,
  opts: { runId: string },
): Promise<CitiesResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, FANBASE_CATEGORIES, entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", calls, mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, calls, mock: source.mock };
  const fanbase = resolved.entity;

  const home = marketFor(fanbase.homeCountry)?.code ?? DEFAULT_MARKET;
  const codes = [home, ...MARKETS.filter((m) => m !== home)].slice(0, 4);
  const markets = await Promise.all(
    codes.map(async (code): Promise<MarketCities> => {
      const market = marketFor(code)!;
      try {
        const res = await source.heatmap([fanbase.id], market.name, opts);
        calls.push(view(res.meta));
        const pool = metroPool().filter((c) => c.country === code);
        const cities = scoreCities(res.data, res.data, pool, MIN_POPULATION).filter((c) => c.combined > 0).slice(0, 6);
        return { market, home: code === home, cities };
      } catch (err) {
        console.warn(`[tools/cities] ${code} failed:`, describeFailure(err));
        return { market, home: code === home, cities: [], error: "Qloo had no city data for this market right now." };
      }
    }),
  );
  return { status: "done", fanbase, markets, calls, mock: source.mock };
}
