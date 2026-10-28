import "server-only";

import { scoreCities } from "@/lib/engine/cities";
import { formatFor } from "@/lib/engine/formats";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import { rankBrands } from "@/lib/engine/places";
import { rankByFit, scoreSponsorFit, sectorOf, type SponsorFit } from "@/lib/engine/sponsor";
import type { Category, CityScore, Entity } from "@/lib/engine/types";
import type { QlooCallOptions } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";

import { audienceProfiles, type AudienceProfile } from "./audience";
import { describeFailure, metroPool, view, type CallView } from "./shared";

/**
 * Who is selling the sponsorship: one act or team (a Qloo entity), an event (a saved plan:
 * fanbase with partner) or a whole roster (its acts together as one signal).
 */
export type RightsHolder =
  | { kind: "entity"; entity: Pick<Entity, "id" | "name" | "category" | "homeCountry" | "description" | "tags" | "popularity"> }
  | { kind: "event"; name: string; ids: string[]; cities: CityScore[] }
  | { kind: "roster"; name: string; ids: string[] };

export interface PitchBrand {
  id: string;
  name: string;
  sector: string;
  description?: string;
  fit: SponsorFit;
  /** The request for the holder among this brand's fans (the reverse check). */
  backwardCall?: CallView;
}

export interface BrandsToPitch {
  holder: { kind: RightsHolder["kind"]; name: string; ids: string[]; category?: Category };
  groups: { sector: string; brands: PitchBrand[] }[];
  cities: CityScore[];
  audience: AudienceProfile | null;
  /** The requests behind the brand list, the cities and the audience. */
  sourceCalls: { brands: CallView; heat?: CallView; audience?: CallView };
  /** Why something is missing, in plain words. */
  notes: string[];
  calls: CallView[];
  mock: boolean;
}

/** Brands ranked per holder, then the reverse direction for this many of the best. */
export const REVERSE_CHECKS = 5;

const holderName = (h: RightsHolder) => (h.kind === "entity" ? h.entity.name : h.name);
const holderIds = (h: RightsHolder) => (h.kind === "entity" ? [h.entity.id] : h.ids);

/**
 * Brands to pitch: brands the holder's fans over-index on (Qloo insights with the holder as
 * signal), through rankBrands (which drops nonprofits, government, teams and leagues, so rival
 * teams never appear), scored with scoreSponsorFit and grouped by Qloo's sector tag. For one act
 * or team the best REVERSE_CHECKS also get the other direction (the holder among each brand's
 * fans); events and rosters are a combined signal, so they have one direction, labelled.
 */
export async function brandsToPitch(holder: RightsHolder, source: QlooSource, opts: QlooCallOptions): Promise<BrandsToPitch> {
  const calls: CallView[] = [];
  const notes: string[] = [];
  const ids = holderIds(holder);
  const name = holderName(holder);

  const res = await source.brands(ids, undefined, opts);
  calls.push(view(res.meta));
  const ranked = rankBrands(res.data, 15);
  if (!ranked.picks.length) notes.push(ranked.reason);

  const backward = new Map<string, number | null>();
  const backwardCalls = new Map<string, CallView>();
  if (holder.kind === "entity") {
    await Promise.all(
      ranked.picks.slice(0, REVERSE_CHECKS).map(async (p) => {
        try {
          const r = await source.affinityOf([p.brand.id], holder.entity.id, holder.entity.category, opts);
          calls.push(view(r.meta));
          backwardCalls.set(p.brand.id, view(r.meta));
          backward.set(p.brand.id, r.data?.affinity ?? null);
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          console.warn("[tools/sponsor] reverse failed:", describeFailure(err));
        }
      }),
    );
  } else {
    notes.push(`${holder.kind === "event" ? "An event" : "A roster"} is a combined audience, so only one direction is measured: the brand among its fans.`);
  }

  const brands = ranked.picks.flatMap((p): PitchBrand[] => {
    const fit = scoreSponsorFit({ name }, p.brand, { forward: p.brand.affinity, backward: backward.get(p.brand.id) ?? null });
    return fit ? [{ id: p.brand.id, name: p.brand.name, sector: sectorOf(p.brand), description: p.brand.description, fit, backwardCall: backwardCalls.get(p.brand.id) }] : [];
  });
  const bySector = new Map<string, PitchBrand[]>();
  for (const b of rankByFit(brands)) bySector.set(b.sector, [...(bySector.get(b.sector) ?? []), b]);
  const groups = [...bySector].map(([sector, list]) => ({ sector, brands: list }));

  let cities: CityScore[] = [];
  let heatCall: CallView | undefined;
  let audience: AudienceProfile | null = null;
  if (holder.kind === "entity") {
    const market = marketFor(holder.entity.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
    const [heat, profiles] = await Promise.all([
      source.heatmap([holder.entity.id], market.name, opts).then(
        (r) => {
          calls.push(view(r.meta));
          heatCall = view(r.meta);
          return r.data;
        },
        (err) => {
          if (err instanceof BudgetExceededError) throw err;
          notes.push("Qloo had no city data for this act right now.");
          return null;
        },
      ),
      audienceProfiles([holder.entity.id], source, opts, calls),
    ]);
    const pool = metroPool().filter((c) => c.country === market.code);
    cities = heat ? scoreCities(heat, heat, pool, formatFor({ ...holder.entity } as Entity).minPopulation).filter((c) => c.combined > 0).slice(0, 5) : [];
    audience = profiles[0] ?? null;
  } else if (holder.kind === "event") {
    cities = holder.cities.slice(0, 5);
  }
  return {
    holder: { kind: holder.kind, name, ids, ...(holder.kind === "entity" ? { category: holder.entity.category } : {}) },
    groups,
    cities,
    audience,
    sourceCalls: { brands: view(res.meta), heat: heatCall, audience: calls.find((c) => c.params["filter.type"] === "urn:demographics") },
    notes,
    calls,
    mock: source.mock,
  };
}
