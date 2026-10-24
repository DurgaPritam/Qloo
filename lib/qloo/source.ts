import "server-only";

import type { Brand, Candidate, Category, Entity, HeatCell, Place } from "@/lib/engine/types";
import { assertMockAllowed, isMockMode } from "@/lib/mock-mode";

import { QlooApiSource } from "./api";
import type { QlooCallMeta, QlooCallOptions } from "./client";
import { MockQlooSource } from "./mock";

export interface SourceMeta extends QlooCallMeta {
  /** True for sample data. Every API response built from this must carry mock: true. */
  mock: boolean;
}

export interface SourceResult<T> {
  data: T;
  meta: SourceMeta;
}

/** Everything the agent needs from Qloo, in our own types. */
export interface QlooSource {
  readonly mock: boolean;
  searchEntities(
    query: string,
    categories: readonly Category[] | undefined,
    opts: QlooCallOptions,
  ): Promise<SourceResult<Entity[]>>;
  /** Entities of one category that fans of `entityIds` over-index on. */
  candidates(
    entityIds: readonly string[],
    category: Category,
    opts: QlooCallOptions,
  ): Promise<SourceResult<Candidate[]>>;
  heatmap(
    entityIds: readonly string[],
    location: string | undefined,
    opts: QlooCallOptions,
  ): Promise<SourceResult<HeatCell[]>>;
  places(
    entityIds: readonly string[],
    cityQuery: string,
    tags: readonly string[] | undefined,
    opts: QlooCallOptions,
  ): Promise<SourceResult<Place[]>>;
  brands(
    entityIds: readonly string[],
    cityQuery: string | undefined,
    opts: QlooCallOptions,
  ): Promise<SourceResult<Brand[]>>;
}

/** The mock source only when TAKEOVER_MOCK=1, and never in Vercel production. */
export function getQlooSource(env: Record<string, string | undefined> = process.env): QlooSource {
  assertMockAllowed(env);
  return isMockMode(env) ? new MockQlooSource() : new QlooApiSource();
}
