import "server-only";

import type { Brand, Candidate, Category, Entity, HeatCell, Place } from "@/lib/engine/types";

import type { QlooParams } from "./cache";
import { normalizeParams } from "./cache";
import {
  MOCK_BRANDS,
  MOCK_CANDIDATES,
  MOCK_CELL_OFFSETS,
  MOCK_EMPTY_QUERY,
  MOCK_HEAT_CENTRES,
  MOCK_PLACES,
  MOCK_SEED,
} from "./mock-data";
import type { QlooSource, SourceResult } from "./source";

/**
 * Sample data for building the UI without a Qloo key. Deterministic: the same inputs always give
 * the same output, with small per-seed variation so different searches look different.
 * Never touches lib/qloo/client.ts, so nothing here reaches the Redis cache or the run budget.
 */
export class MockQlooSource implements QlooSource {
  readonly mock = true;

  async searchEntities(
    query: string,
    categories: readonly Category[] | undefined,
  ): Promise<SourceResult<Entity[]>> {
    const trimmed = query.trim();
    const data: Entity[] =
      !trimmed || MOCK_EMPTY_QUERY.test(trimmed)
        ? []
        : [{ id: `mock:seed:${slug(trimmed)}`, name: trimmed, ...MOCK_SEED }];
    return result(data, "/search", { query, types: categories?.map((c) => `urn:entity:${c}`) });
  }

  async candidates(
    entityIds: readonly string[],
    category: Category,
  ): Promise<SourceResult<Candidate[]>> {
    const seed = entityIds.join(",");
    const data = (MOCK_CANDIDATES[category] ?? []).map((item, i) => ({
      id: `mock:${category}:${i}`,
      name: item.name,
      category,
      affinity: jitter(item.affinity, `${seed}|${category}|${i}`),
      popularity: item.popularity,
    }));
    return result(data, "/v2/insights", {
      "filter.type": `urn:entity:${category}`,
      "signal.interests.entities": entityIds,
    });
  }

  async heatmap(
    entityIds: readonly string[],
    location: string | undefined,
  ): Promise<SourceResult<HeatCell[]>> {
    const seed = entityIds.join(",");
    const data = MOCK_HEAT_CENTRES.flatMap((centre) =>
      MOCK_CELL_OFFSETS.map(([dLat, dLon], i) => ({
        lat: centre.lat + dLat,
        lon: centre.lon + dLon,
        affinity: 0.1 + 0.85 * unit(`${seed}|${centre.name}|${i}`),
      })),
    );
    return result(data, "/v2/insights", {
      "filter.type": "urn:heatmap",
      "signal.interests.entities": entityIds,
      "filter.location.query": location,
    });
  }

  async places(
    entityIds: readonly string[],
    cityQuery: string,
    tags: readonly string[] | undefined,
  ): Promise<SourceResult<Place[]>> {
    const seed = `${entityIds.join(",")}|${cityQuery}`;
    const data = MOCK_PLACES.map((item, i) => ({
      id: `mock:place:${i}`,
      name: item.name,
      affinity: jitter(item.affinity, `${seed}|${i}`),
      popularity: item.popularity,
      tags: item.tags ?? [],
    }));
    return result(data, "/v2/insights", {
      "filter.type": "urn:entity:place",
      "signal.interests.entities": entityIds,
      "filter.location.query": cityQuery,
      "filter.tags": tags,
    });
  }

  async brands(
    entityIds: readonly string[],
    cityQuery: string | undefined,
  ): Promise<SourceResult<Brand[]>> {
    const seed = `${entityIds.join(",")}|${cityQuery ?? ""}`;
    const data = MOCK_BRANDS.map((item, i) => ({
      id: `mock:brand:${i}`,
      name: item.name,
      affinity: jitter(item.affinity, `${seed}|${i}`),
      popularity: item.popularity,
    }));
    return result(data, "/v2/insights", {
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": entityIds,
      "signal.location.query": cityQuery,
    });
  }
}

function result<T>(data: T, endpoint: string, params: QlooParams): SourceResult<T> {
  return {
    data,
    meta: { endpoint, params: normalizeParams(params), cached: false, ms: 0, mock: true },
  };
}

/** FNV-1a, mapped to [0, 1). */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** ±0.05 per seed, clamped to [0, 1]. */
function jitter(value: number, seed: string): number {
  return Math.min(1, Math.max(0, value + (unit(seed) - 0.5) * 0.1));
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
