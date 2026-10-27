import "server-only";

import type { Category } from "@/lib/engine/types";

import { getQlooClient, type QlooCallMeta, type QlooClient } from "./client";
import {
  compact,
  toBrand,
  toCandidate,
  toEntity,
  toHeatCell,
  toPlace,
  urn,
  type RawEntity,
  type RawHeatCell,
} from "./map";
import type { QlooSource, SourceMeta } from "./source";
import { placeTagIds } from "./tags";

/**
 * Types a fanbase can be. Places, localities and video games are excluded: Qloo rejects them as
 * signals ("All of the provided signal.interests.entities were invalid"). Video games can still
 * be partners.
 */
export const FANBASE_CATEGORIES: readonly Category[] = ["artist", "person", "movie", "tv_show", "podcast", "brand", "book"];

interface RawList {
  results?: RawEntity[] | { entities?: RawEntity[]; heatmap?: RawHeatCell[] };
}

const entities = (data: RawList): RawEntity[] =>
  Array.isArray(data.results) ? data.results : (data.results?.entities ?? []);

const live = (meta: QlooCallMeta): SourceMeta => ({ ...meta, mock: false });

/**
 * The real Qloo source. Every call goes through the client (cache, timeout, retry, run budget);
 * responses are mapped into engine types by lib/qloo/map.ts.
 */
export class QlooApiSource implements QlooSource {
  readonly mock = false;

  constructor(private readonly client: Pick<QlooClient, "get"> = getQlooClient()) {}

  async searchEntities(query: string, categories: readonly Category[] | undefined, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/search",
      { query, types: (categories ?? FANBASE_CATEGORIES).map(urn), take: 10 },
      opts,
    );
    return { data: compact(entities(res.data).map(toEntity)), meta: live(res.meta) };
  }

  async candidates(entityIds: readonly string[], category: Category, location: string | undefined, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/v2/insights",
      {
        "filter.type": urn(category),
        "signal.interests.entities": entityIds,
        "signal.location.query": location,
        take: 20,
      },
      opts,
    );
    return { data: compact(entities(res.data).map((e) => toCandidate(e, category))), meta: live(res.meta) };
  }

  async local(category: Category, location: string, tags: readonly string[] | undefined, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/v2/insights",
      { "filter.type": urn(category), "signal.location.query": location, "filter.tags": tags?.length ? [...tags] : undefined, take: 20 },
      opts,
    );
    return { data: compact(entities(res.data).map((e) => toCandidate(e, category))), meta: live(res.meta) };
  }

  async heatmap(entityIds: readonly string[], location: string | undefined, opts: { runId: string }) {
    // Qloo requires a location for heatmaps (docs/qloo-shapes.md); callers pass the market.
    if (!location) throw new Error("A heatmap needs a location (a country name).");
    const res = await this.client.get<RawList>(
      "/v2/insights",
      { "filter.type": "urn:heatmap", "signal.interests.entities": entityIds, "filter.location.query": location },
      opts,
    );
    const cells = Array.isArray(res.data.results) ? [] : (res.data.results?.heatmap ?? []);
    return { data: compact(cells.map(toHeatCell)), meta: live(res.meta) };
  }

  async demographics(entityIds: readonly string[], opts: { runId: string }) {
    type Raw = { results?: { demographics?: Array<{ entity_id?: string; query?: { age?: Record<string, number>; gender?: Record<string, number> } }> } };
    const res = await this.client.get<Raw>(
      "/v2/insights",
      { "filter.type": "urn:demographics", "signal.interests.entities": entityIds },
      opts,
    );
    const data = (res.data.results?.demographics ?? []).flatMap((d) =>
      d.entity_id && d.query?.age && d.query.gender ? [{ entityId: d.entity_id, age: d.query.age, gender: d.query.gender }] : [],
    );
    return { data, meta: live(res.meta) };
  }

  async affinityOf(signalIds: readonly string[], target: string, category: Category, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/v2/insights",
      { "filter.type": urn(category), "signal.interests.entities": signalIds, "filter.results.entities": target },
      opts,
    );
    const hit = entities(res.data).map((e) => toCandidate(e, category)).find((c) => c?.id === target) ?? null;
    return { data: hit, meta: live(res.meta) };
  }

  async places(entityIds: readonly string[], cityQuery: string, tags: readonly string[] | undefined, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/v2/insights",
      {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": entityIds,
        "filter.location.query": cityQuery,
        "filter.tags": placeTagIds(tags),
        take: 20,
      },
      opts,
    );
    return { data: compact(entities(res.data).map(toPlace)), meta: live(res.meta) };
  }

  async brands(entityIds: readonly string[], cityQuery: string | undefined, opts: { runId: string }) {
    const res = await this.client.get<RawList>(
      "/v2/insights",
      {
        "filter.type": "urn:entity:brand",
        "signal.interests.entities": entityIds,
        "signal.location.query": cityQuery,
        take: 25,
      },
      opts,
    );
    return { data: compact(entities(res.data).map(toBrand)), meta: live(res.meta) };
  }
}
