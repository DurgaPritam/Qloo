import "server-only";

import { cityQuery, PARTNER_CATEGORIES } from "@/lib/agent/tools";
import { cityHeat, scoreCityHeat } from "@/lib/engine/cities";
import { formatFor } from "@/lib/engine/formats";
import { rankLocal } from "@/lib/engine/local";
import { foldName } from "@/lib/engine/match";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import { scorePartners } from "@/lib/engine/partners";
import type { Category, City, Entity } from "@/lib/engine/types";
import { ENGINE_CONFIG } from "@/lib/engine/config";
import type { Snapshot, SnapshotEntry } from "@/lib/engine/watch";
import type { QlooCallOptions } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource, SourceMeta } from "@/lib/qloo/source";
import type { CallRecord } from "@/lib/roster/types";
import { describeFailure, metroPool } from "@/lib/tools/shared";

/** What a city is watched for: its top entities in these categories. */
export const CITY_CATEGORIES: readonly Category[] = ["artist", "podcast", "tv_show", "brand"];
/** Partner categories for a fanbase: the first two the agent tries, other than its own. */
const PARTNER_TRIES = 2;

/** Qloo calls one snapshot makes, for the estimate and the budget check. */
export const SNAPSHOT_CALLS = { fanbase: 1 + PARTNER_TRIES, city: CITY_CATEGORIES.length } as const;

export type SnapshotSummary = Snapshot & { market?: string; calls: CallRecord[]; failed: string[] };

const record = (m: SourceMeta): CallRecord => ({ endpoint: m.endpoint, params: m.params, cached: m.cached });

/**
 * A fanbase's week: where its fans are (heat by city in its home market, scaled to the hottest,
 * from scoreCityHeat) and its top partners (scorePartners), top 10 of each. A list Qloo did not
 * answer for is left out, so it is never compared against a real one.
 */
export async function fanbaseSnapshot(entity: Entity, source: QlooSource, opts: QlooCallOptions): Promise<SnapshotSummary> {
  const topN = ENGINE_CONFIG.watch.topN;
  const market = marketFor(entity.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
  const calls: CallRecord[] = [];
  const failed: string[] = [];
  const lists: Snapshot["lists"] = {};
  const soft = async <T>(what: string, call: () => Promise<T>) => {
    try {
      return await call();
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn(`[watch] ${what} failed:`, describeFailure(err));
      failed.push(what);
      return null;
    }
  };

  const categories = PARTNER_CATEGORIES.filter((c) => c !== entity.category).slice(0, PARTNER_TRIES);
  const [heat, ...candidates] = await Promise.all([
    soft("cities", () => source.heatmap([entity.id], market.name, opts)),
    ...categories.map((c) => soft("partners", () => source.candidates([entity.id], c, undefined, opts))),
  ]);
  if (heat) {
    calls.push(record(heat.meta));
    const pool = metroPool().filter((c) => c.country === market.code);
    const h = cityHeat(heat.data, pool);
    lists.cities = scoreCityHeat(h, h, pool, formatFor(entity).minPopulation)
      .filter((s) => s.combined > 0)
      .slice(0, topN)
      .map((s, i): SnapshotEntry => ({ id: s.city.id, name: s.city.name, rank: i + 1, value: s.combined }));
  }
  const ok = candidates.filter((c) => c !== null);
  for (const c of ok) calls.push(record(c.meta));
  if (ok.length === candidates.length) {
    const pool = ok.flatMap((c) => c.data);
    const twins = pool.filter((c) => foldName(c.name) === foldName(entity.name)).map((c) => c.id);
    lists.partners = scorePartners(pool, { count: topN, minCategories: 1, excludeIds: [entity.id, ...twins] }).picks.map(
      (p, i): SnapshotEntry => ({ id: p.entity.id, name: p.entity.name, rank: i + 1, value: p.entity.affinity, category: p.entity.category }),
    );
  }
  return { lists, market: market.code, calls, failed };
}

/** A city's week: what people there over-index on, top 10 per category (rankLocal, as the Venue booker). */
export async function citySnapshot(city: City, source: QlooSource, opts: QlooCallOptions): Promise<SnapshotSummary> {
  const topN = ENGINE_CONFIG.watch.topN;
  const calls: CallRecord[] = [];
  const failed: string[] = [];
  const lists: Snapshot["lists"] = {};
  const where = cityQuery(city);
  for (const category of CITY_CATEGORIES) {
    try {
      const res = await source.local(category, where, undefined, opts);
      calls.push(record(res.meta));
      lists[`category:${category}`] = rankLocal(res.data, { ...ENGINE_CONFIG.local, count: topN }).picks.map(
        (p): SnapshotEntry => ({ id: p.entity.id, name: p.entity.name, rank: p.rank, value: p.entity.affinity, category }),
      );
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn("[watch] city category failed:", describeFailure(err));
      failed.push(category);
    }
  }
  return { lists, market: city.country, calls, failed };
}
