import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { scorePartners } from "@/lib/engine/partners";
import type { Category, CityScore, Entity, PartnerPick } from "@/lib/engine/types";
import type { QlooSource } from "@/lib/qloo/source";

import { describeFailure, metroPool, resolveEntity, view, type CallView, type Resolved } from "./shared";

/** Who a brand's customers over-index on, by the kind of partner a brand books. */
const LISTS: Array<{ category: Category; label: string }> = [
  { category: "artist", label: "Artists" },
  { category: "person", label: "People" },
  { category: "podcast", label: "Podcasts" },
  { category: "tv_show", label: "TV shows" },
];

/** Cities for an activation: big enough to matter (same floor as a fan fest). */
const MIN_POPULATION = 300_000;

export interface BrandList {
  category: Category;
  label: string;
  picks: PartnerPick[];
  reason: string;
  error?: string;
}

export type BrandResult =
  | ({ status: "choose" | "none"; calls: CallView[]; mock: boolean } & Partial<Extract<Resolved, { kind: "choose" }>>)
  | {
      status: "done";
      brand: Entity;
      market: Market;
      lists: BrandList[];
      cities: CityScore[];
      citiesError?: string;
      calls: CallView[];
      mock: boolean;
    };

/**
 * Brand match: resolve the brand, then one Qloo call per partner category and one heatmap in its
 * home market. Scored by the same engine as takeover partners and cities.
 */
export async function matchBrand(
  query: string,
  entityId: string | undefined,
  source: QlooSource,
  opts: { runId: string },
): Promise<BrandResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, ["brand"], entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", calls, mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, calls, mock: source.mock };
  const brand = resolved.entity;
  const market = marketFor(brand.homeCountry) ?? marketFor(DEFAULT_MARKET)!;

  const [lists, heat] = await Promise.all([
    Promise.all(
      LISTS.map(async ({ category, label }): Promise<BrandList> => {
        try {
          const res = await source.candidates([brand.id], category, undefined, opts);
          calls.push(view(res.meta));
          const scored = scorePartners(res.data, { count: 5, minCategories: 1, excludeIds: [brand.id] });
          return { category, label, picks: scored.picks, reason: scored.reason };
        } catch (err) {
          console.warn(`[tools/brand] ${category} failed:`, describeFailure(err));
          return { category, label, picks: [], reason: "", error: "Qloo had no answer for this list; try again shortly." };
        }
      }),
    ),
    source.heatmap([brand.id], market.name, opts).then(
      (res) => {
        calls.push(view(res.meta));
        return res.data;
      },
      (err) => {
        console.warn("[tools/brand] heatmap failed:", describeFailure(err));
        return null;
      },
    ),
  ]);

  // One audience, so it is scored against itself: combined = its own heat.
  const pool = metroPool().filter((c) => c.country === market.code);
  const cities = heat ? scoreCities(heat, heat, pool, MIN_POPULATION).filter((c) => c.combined > 0).slice(0, 8) : [];
  return {
    status: "done",
    brand,
    market,
    lists,
    cities,
    citiesError: heat ? undefined : "Qloo had no city data for this brand right now.",
    calls,
    mock: source.mock,
  };
}
