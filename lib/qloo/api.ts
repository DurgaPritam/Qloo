import "server-only";

import type { QlooParams } from "./cache";
import { getQlooClient, type QlooCallOptions, type QlooClient, type QlooResult } from "./client";

export type EntityType = `urn:entity:${string}`;

export interface QlooTag {
  tag_id?: string;
  id?: string;
  name: string;
  type?: string;
}

export interface QlooEntity {
  entity_id: string;
  name: string;
  types?: string[];
  subtype?: string;
  popularity?: number;
  query?: { affinity?: number; [key: string]: unknown };
  tags?: QlooTag[];
  properties?: Record<string, unknown>;
  location?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HeatmapPoint {
  location: { latitude: number; longitude: number; geohash?: string };
  query: { affinity?: number; affinity_rank?: number; popularity?: number };
}

export interface SearchResponse {
  results?: QlooEntity[];
}

export interface InsightsResponse {
  success?: boolean;
  results?: { entities?: QlooEntity[]; heatmap?: HeatmapPoint[] };
}

const SEARCH_PATH = "/search";
const INSIGHTS_PATH = "/v2/insights";

/** Typed wrappers over the Qloo endpoints the agent uses. Bound to a client so tests can inject one. */
export function createQlooApi(client: Pick<QlooClient, "get">) {
  const searchEntities = async (
    query: string,
    types: readonly EntityType[] | undefined,
    opts: QlooCallOptions,
  ): Promise<QlooResult<QlooEntity[]>> => {
    const res = await client.get<SearchResponse>(SEARCH_PATH, { query, types }, opts);
    return { data: res.data?.results ?? [], meta: res.meta };
  };

  const insights = (params: QlooParams, opts: QlooCallOptions) =>
    client.get<InsightsResponse>(INSIGHTS_PATH, params, opts);

  const entities = async (params: QlooParams, opts: QlooCallOptions) => {
    const res = await insights(params, opts);
    return { data: res.data?.results?.entities ?? [], meta: res.meta };
  };

  const heatmap = async (
    entityIds: readonly string[],
    location: string | undefined,
    opts: QlooCallOptions,
  ): Promise<QlooResult<HeatmapPoint[]>> => {
    const res = await insights(
      {
        "filter.type": "urn:heatmap",
        "signal.interests.entities": entityIds,
        "filter.location.query": location,
      },
      opts,
    );
    return { data: res.data?.results?.heatmap ?? [], meta: res.meta };
  };

  const places = (
    entityIds: readonly string[],
    cityQuery: string,
    tags: readonly string[] | undefined,
    opts: QlooCallOptions,
  ): Promise<QlooResult<QlooEntity[]>> =>
    entities(
      {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": entityIds,
        "filter.location.query": cityQuery,
        "filter.tags": tags,
      },
      opts,
    );

  const brands = (
    entityIds: readonly string[],
    cityQuery: string | undefined,
    opts: QlooCallOptions,
  ): Promise<QlooResult<QlooEntity[]>> =>
    entities(
      {
        "filter.type": "urn:entity:brand",
        "signal.interests.entities": entityIds,
        "signal.location.query": cityQuery,
      },
      opts,
    );

  return { searchEntities, insights, heatmap, places, brands };
}

const api = () => createQlooApi(getQlooClient());

export const searchEntities: ReturnType<typeof createQlooApi>["searchEntities"] = (...args) =>
  api().searchEntities(...args);
export const insights: ReturnType<typeof createQlooApi>["insights"] = (...args) =>
  api().insights(...args);
export const heatmap: ReturnType<typeof createQlooApi>["heatmap"] = (...args) =>
  api().heatmap(...args);
export const places: ReturnType<typeof createQlooApi>["places"] = (...args) =>
  api().places(...args);
export const brands: ReturnType<typeof createQlooApi>["brands"] = (...args) =>
  api().brands(...args);
