import "server-only";

import { PARTNER_CATEGORIES } from "@/lib/agent/tools";
import { cityHeat, scoreCityHeat } from "@/lib/engine/cities";
import { formatFor } from "@/lib/engine/formats";
import { foldName } from "@/lib/engine/match";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import { scorePartners } from "@/lib/engine/partners";
import { rankBrands } from "@/lib/engine/places";
import { actConfidence } from "@/lib/engine/roster";
import type { Candidate, Entity } from "@/lib/engine/types";
import type { QlooCallOptions } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { describeFailure, metroPool, view } from "@/lib/tools/shared";

import { PROFILE_CALLS } from "./plan";
import type { ActProfile } from "./types";

/** Partner categories asked per act (the first the agent tries, other than the act's own); plus one heatmap and one brand list. */
const PARTNER_TRIES = PROFILE_CALLS - 2;

/**
 * One act's best city, top partner and top sponsor, with the same engine functions as a plan:
 * scoreCities (on the act's own heat), scorePartners and rankBrands. Each part falls back on its
 * own and says so in `notes`; a budget error stops the profile so the caller can record it.
 */
export async function profileAct(entity: Entity, source: QlooSource, opts: QlooCallOptions): Promise<ActProfile> {
  const notes: string[] = [];
  const market = marketFor(entity.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
  const format = formatFor(entity);
  const categories = PARTNER_CATEGORIES.filter((c) => c !== entity.category).slice(0, PARTNER_TRIES);

  const soft = async <T>(what: string, call: () => Promise<T>): Promise<T | null> => {
    try {
      return await call();
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn(`[roster/profile] ${what} failed:`, describeFailure(err));
      notes.push(`Qloo did not answer for the ${what}.`);
      return null;
    }
  };

  const [candidates, heat, brands] = await Promise.all([
    Promise.all(categories.map((c) => soft("partner", () => source.candidates([entity.id], c, undefined, opts)))),
    soft("city", () => source.heatmap([entity.id], market.name, opts)),
    soft("sponsor", () => source.brands([entity.id], undefined, opts)),
  ]);

  // The act itself and its twin records (Qloo lists people as both person and artist).
  const pool: Candidate[] = candidates.flatMap((r) => r?.data ?? []);
  const twins = pool.filter((c) => foldName(c.name) === foldName(entity.name)).map((c) => c.id);
  const partner = scorePartners(pool, { count: 1, minCategories: 1, excludeIds: [entity.id, ...twins] }).picks[0] ?? null;
  if (!partner && candidates.some(Boolean)) notes.push("No partner stood out among its fans.");

  const cities = metroPool().filter((c) => c.country === market.code);
  const heatByCity = heat ? cityHeat(heat.data, cities) : new Map();
  const top = heat ? scoreCityHeat(heatByCity, heatByCity, cities, format.minPopulation).find((c) => c.combined > 0) : undefined;
  if (heat && !top) notes.push(`No city-level data in ${market.name}.`);

  const sponsor = brands ? (rankBrands(brands.data, 1).picks[0] ?? null) : null;
  if (brands && !sponsor) notes.push("No sponsor brand passed the filters.");

  const calls = [...candidates.map((r) => r?.meta), heat?.meta, brands?.meta].filter((m) => m !== undefined).map(view);
  const stored: ActProfile["heat"] = {};
  for (const [id, h] of heatByCity) if (h.cells > 0) stored[id] = [h.mean, h.cells];

  const city = top
    ? { id: top.city.id, name: top.city.name, country: top.city.country, confidence: top.confidence, evidence: { heat: heatByCity.get(top.city.id)!.mean, cells: top.evidence.cellsA } }
    : null;
  return {
    entityId: entity.id,
    market: market.code,
    city,
    heat: stored,
    partner: partner
      ? { id: partner.entity.id, name: partner.entity.name, category: partner.entity.category, score: partner.score, confidence: partner.confidence, evidence: partner.evidence }
      : null,
    sponsor: sponsor ? { id: sponsor.brand.id, name: sponsor.brand.name, score: sponsor.score, confidence: sponsor.confidence, evidence: sponsor.evidence } : null,
    confidence: actConfidence([city?.confidence, partner?.confidence, sponsor?.confidence]),
    notes,
    calls,
    mock: source.mock,
  };
}
