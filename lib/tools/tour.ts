import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { DEFAULT_MARKET, marketFor, type Market } from "@/lib/engine/markets";
import { planTour } from "@/lib/engine/tour";
import type { Entity, TourPlan } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooSource } from "@/lib/qloo/source";

import { metroPool, resolveEntity, view, type CallView, type Resolved } from "./shared";

/** Same floor as a tour stop in a takeover. */
const MIN_POPULATION = 250_000;

export type TourResult =
  | ({ status: "choose" | "none"; calls: CallView[]; mock: boolean } & Partial<Extract<Resolved, { kind: "choose" }>>)
  | { status: "done"; fanbase: Entity; market: Market; tour: TourPlan; calls: CallView[]; mock: boolean };

/** Tour planner: the fanbase's heatmap in a market, then the takeover's tour routing from its top city. */
export async function planFanTour(
  query: string,
  entityId: string | undefined,
  country: string | undefined,
  stops: number | undefined,
  source: QlooSource,
  opts: { runId: string },
): Promise<TourResult> {
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, FANBASE_CATEGORIES, entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", calls, mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, calls, mock: source.mock };
  const fanbase = resolved.entity;
  const market = marketFor(country) ?? marketFor(fanbase.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
  const res = await source.heatmap([fanbase.id], market.name, opts);
  calls.push(view(res.meta));
  const pool = metroPool().filter((c) => c.country === market.code);
  const scores = scoreCities(res.data, res.data, pool, MIN_POPULATION).filter((c) => c.combined > 0);
  return { status: "done", fanbase, market, tour: planTour(scores, { stops }), calls, mock: source.mock };
}
