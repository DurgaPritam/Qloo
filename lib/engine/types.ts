/**
 * Our own domain types. Qloo responses are mapped into these at the source boundary
 * (lib/qloo/source.ts), so the engine never depends on Qloo's raw response shape.
 */

export type Category =
  | "artist"
  | "movie"
  | "tv_show"
  | "podcast"
  | "person"
  | "brand"
  | "videogame"
  | "book"
  | "place";

export type Confidence = "high" | "medium" | "low";

export interface Entity {
  id: string;
  name: string;
  category: Category;
  /** 0–1, share of the population that knows this entity. */
  popularity: number;
  imageUrl?: string;
  tags?: string[];
}

/** An entity returned relative to a seed, with the seed audience's affinity for it. */
export interface Candidate extends Entity {
  /** 0–1, how strongly the seed's fans over-index on this entity. */
  affinity: number;
}

export interface HeatCell {
  lat: number;
  lon: number;
  /** 0–1 */
  affinity: number;
  geohash?: string;
}

/** Static reference data from GeoNames (lib/engine/data/cities.json), not from Qloo. */
export interface City {
  /** GeoNames id */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  /** First-level region name, e.g. "Illinois"; empty when GeoNames has none. */
  admin1: string;
  lat: number;
  lon: number;
  population: number;
}

export interface Place {
  id: string;
  name: string;
  /** 0–1 */
  affinity: number;
  /** 0–1 */
  popularity: number;
  tags: string[];
  address?: string;
  lat?: number;
  lon?: number;
}

export interface Brand {
  id: string;
  name: string;
  /** 0–1 */
  affinity: number;
  /** 0–1 */
  popularity: number;
  tags?: string[];
}

export type DropReason = "too_popular" | "below_min_affinity" | "invalid_data";

export interface Dropped<T> {
  item: T;
  reason: DropReason;
}

export interface RankResult<P, T> {
  picks: P[];
  dropped: Dropped<T>[];
  /** True when the result is a best effort that does not meet the normal rules. */
  fallback: boolean;
  reason: string;
}

interface PickBase {
  /** 1-based */
  rank: number;
  score: number;
  confidence: Confidence;
}

export interface PartnerPick extends PickBase {
  kind: "partner";
  entity: Candidate;
  evidence: { affinity: number; popularity: number };
}

export interface PlacePick extends PickBase {
  kind: "place";
  place: Place;
  evidence: {
    affinity: number;
    popularity: number;
    matchedTags: string[];
    requestedTags: string[];
  };
}

export interface BrandPick extends PickBase {
  kind: "brand";
  brand: Brand;
  evidence: { affinity: number; popularity: number };
}

export interface CityScore {
  kind: "city";
  city: City;
  /** Seed fanbase heat, normalised 0–1 across the scored cities. */
  sA: number;
  /** Partner fanbase heat, normalised 0–1 across the scored cities. */
  sB: number;
  /** sqrt(sA * sB) */
  combined: number;
  /** 1-based rank by combined score. */
  rank: number;
  /** 1-based rank by population alone: the "without Qloo" answer. */
  populationRank: number;
  confidence: Confidence;
  evidence: { cellsA: number; cellsB: number };
}

export type Pick = PartnerPick | PlacePick | BrandPick | CityScore;
