import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { scorePartners } from "@/lib/engine/partners";
import { isSportsOrganisation, rankByFit, scoreSponsorFit, type SponsorFit } from "@/lib/engine/sponsor";
import type { Candidate, Category, CityScore, Entity, PartnerPick } from "@/lib/engine/types";
import type { QlooCallOptions } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";

import { audienceProfiles, type AudienceProfile } from "./audience";

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
  /** The Qloo request behind the list. */
  call?: CallView;
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
      /** Sponsorship only: who the brand's fans are (demographics), and the best fits both ways. */
      audience?: AudienceProfile | null;
      fits?: BrandFit[];
      /** The heatmap and demographics requests, for sources. */
      heatCall?: CallView;
      audienceCall?: CallView;
      calls: CallView[];
      mock: boolean;
    };

export interface BrandFit {
  /** The talent, show, podcast or team. */
  name: string;
  id: string;
  category: Category;
  list: string;
  fit: SponsorFit;
  /** The request for the brand among this one's fans (the reverse check), and for its list. */
  forwardCall?: CallView;
  listCall?: CallView;
}

/**
 * Brand match: resolve the brand, then one Qloo call per partner category and one heatmap in its
 * home market. Scored by the same engine as takeover partners and cities.
 */
export async function matchBrand(
  query: string,
  entityId: string | undefined,
  source: QlooSource,
  opts: QlooCallOptions,
  /** Sponsorship's brand view adds teams, the audience skew and the reverse direction for the top `reverse` matches. */
  more: { teams?: boolean; audience?: boolean; reverse?: number } = {},
): Promise<BrandResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, ["brand"], entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", calls, mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, calls, mock: source.mock };
  const brand = resolved.entity;
  const market = marketFor(brand.homeCountry) ?? marketFor(DEFAULT_MARKET)!;

  let heatCall: CallView | undefined;
  const [lists, heat] = await Promise.all([
    Promise.all(
      LISTS.map(async ({ category, label }): Promise<BrandList> => {
        try {
          const res = await source.candidates([brand.id], category, undefined, opts);
          calls.push(view(res.meta));
          const scored = scorePartners(res.data, { count: 5, minCategories: 1, excludeIds: [brand.id] });
          return { category, label, picks: scored.picks, reason: scored.reason, call: view(res.meta) };
        } catch (err) {
          console.warn(`[tools/brand] ${category} failed:`, describeFailure(err));
          return { category, label, picks: [], reason: "", error: "Qloo had no answer for this list; try again shortly." };
        }
      }),
    ),
    source.heatmap([brand.id], market.name, opts).then(
      (res) => {
        calls.push(view(res.meta));
        heatCall = view(res.meta);
        return res.data;
      },
      (err) => {
        console.warn("[tools/brand] heatmap failed:", describeFailure(err));
        return null;
      },
    ),
  ]);

  if (more.teams) {
    try {
      const res = await source.brands([brand.id], undefined, opts);
      calls.push(view(res.meta));
      // Teams are brands to Qloo; only sports organisations go in this list.
      const teams: Candidate[] = res.data
        .filter(isSportsOrganisation)
        .map((b) => ({ id: b.id, name: b.name, category: "brand", affinity: b.affinity, popularity: b.popularity, tags: b.tags }));
      const scored = scorePartners(teams, { count: 5, minCategories: 1, excludeIds: [brand.id] });
      lists.push({ category: "brand", label: "Teams", picks: scored.picks, reason: scored.reason, call: view(res.meta) });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn("[tools/brand] teams failed:", describeFailure(err));
      lists.push({ category: "brand", label: "Teams", picks: [], reason: "", error: "Qloo had no answer for this list; try again shortly." });
    }
  }
  const audience = more.audience ? ((await audienceProfiles([brand.id], source, opts, calls))[0] ?? null) : undefined;
  const audienceCall = more.audience ? calls.find((c) => c.params["filter.type"] === "urn:demographics") : undefined;

  // The reverse direction for the strongest picks: the brand among each one's fans.
  let fits: BrandFit[] | undefined;
  if (more.reverse) {
    const top = lists
      .flatMap((l) => l.picks.map((p) => ({ list: l.label, pick: p, listCall: l.call })))
      .sort((a, b) => b.pick.score - a.pick.score)
      .slice(0, more.reverse);
    const scored = await Promise.all(
      top.map(async ({ list, pick, listCall }): Promise<BrandFit | null> => {
        let forward: number | null = null;
        let forwardCall: CallView | undefined;
        try {
          const res = await source.affinityOf([pick.entity.id], brand.id, "brand", opts);
          calls.push(view(res.meta));
          forwardCall = view(res.meta);
          forward = res.data?.affinity ?? null;
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          console.warn("[tools/brand] reverse failed:", describeFailure(err));
        }
        // The pick's own affinity is it among the brand's fans: the backward direction.
        const fit = scoreSponsorFit(pick.entity, brand, { forward, backward: pick.entity.affinity });
        return fit ? { name: pick.entity.name, id: pick.entity.id, category: pick.entity.category, list, fit, forwardCall, listCall } : null;
      }),
    );
    fits = rankByFit(scored.filter((f): f is BrandFit => f !== null));
  }

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
    ...(audience !== undefined ? { audience, audienceCall } : {}),
    ...(fits ? { fits } : {}),
    heatCall,
    calls,
    mock: source.mock,
  };
}
