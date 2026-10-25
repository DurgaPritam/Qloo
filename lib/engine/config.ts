import type { Category } from "./types";

/**
 * Every engine threshold lives here. Values are first guesses until the probe shows Qloo's
 * real affinity and popularity distributions (see docs/after-key.md).
 */
export const ENGINE_CONFIG = {
  partners: {
    count: 3,
    minCategories: 2,
    /** Bias guard: anything more popular than this is "everyone likes it", not a crossover. */
    maxPopularity: 0.97,
    minAffinity: 0.3,
    /** score = affinity * (1 - popularity) ^ popularityExponent */
    popularityExponent: 0.5,
  },
  cities: {
    /** Heat cells within this distance of a city centre count towards it. */
    radiusKm: 40,
    /** Used instead when city-level data is thin ("regional overlap"). */
    regionalRadiusKm: 150,
    /** Fewer cells than this on either side lowers confidence. */
    minCellsForHigh: 3,
    /**
     * A city within this distance of a larger one is folded into it (boroughs, suburbs). Equal to
     * radiusKm, since closer cities would share the same heat cells.
     */
    metroMergeKm: 40,
    /** Rows in the "with Qloo vs population" table. */
    tableSize: 5,
  },
  tour: {
    stops: 6,
    /** Exact ordering tries every order, so keep this small (8! = 40,320). */
    maxStops: 8,
    /** Stops closer than this would split one audience across two nights. */
    minSpacingKm: 150,
    /** A stop must score at least this combined (0–1). */
    minCombined: 0.3,
    /** Tours stay in the chosen city's country; below this many stops they widen to a radius. */
    minStopsInCountry: 3,
    /** The radius around the chosen city used when the country alone is too thin. */
    widenKm: 2500,
  },
  places: {
    /** Venues considered for the main room. */
    count: 5,
    /** After-show or watch-party spots. */
    spots: 3,
    minAffinity: 0.2,
    /** Weight kept by a place that matches none of the requested tags. */
    tagBaseWeight: 0.5,
  },
  brands: {
    count: 3,
    maxPopularity: 0.97,
    minAffinity: 0.2,
    popularityExponent: 0.5,
  },
  /** Partners: thresholds on affinity. Cities: on min(sA, sB). */
  confidence: {
    high: 0.7,
    medium: 0.4,
  },
  /** Venues and sponsors: by how many results qualified and the gap between first and second. */
  rankConfidence: {
    highCount: 5,
    mediumCount: 2,
    /** (score1 - score2) / score1 below this makes the top pick one level less certain. */
    minRelativeGap: 0.05,
  },
  match: {
    /** Name similarity (0–1) at or above which a search result counts as the same name. */
    exactSimilarity: 0.95,
    /** Below this a result is not offered as a "did you mean" suggestion. */
    suggestSimilarity: 0.5,
    maxOptions: 3,
    /**
     * Two same-name matches in different categories are ambiguous unless one is clearly better
     * known: its distance from popularity 1 is at least this many times smaller.
     */
    dominanceFactor: 5,
  },
} as const;

export type FormatId = "tour_stop" | "screening_tour" | "live_show" | "fan_fest";

export interface FormatRule {
  format: FormatId;
  /** Smallest city worth the format. */
  minPopulation: number;
  /** Any of these makes a place a candidate main room. */
  venueTags: readonly string[];
  /** Any of these makes a place an after-show or watch-party spot. */
  spotTags: readonly string[];
}

export const FORMAT_LABEL: Record<FormatId, string> = {
  tour_stop: "Tour stop",
  screening_tour: "Screening tour",
  live_show: "Live show",
  fan_fest: "Fan fest",
};

/**
 * Readable place tags, as Qloo names them (docs/qloo-shapes.md); lib/qloo/tags.ts maps them to ids.
 * Sports teams are Qloo brands, so brands get the fan fest.
 */
export const FORMAT_BY_CATEGORY: Record<Category, FormatRule> = {
  artist: {
    format: "tour_stop",
    minPopulation: 250_000,
    venueTags: ["live music venue", "concert hall"],
    spotTags: ["bar", "night club"],
  },
  // Comedians. Other people (actors, hosts) get PERSON_LIVE_SHOW via formatFor.
  person: {
    format: "tour_stop",
    minPopulation: 250_000,
    venueTags: ["comedy club", "performing arts theater"],
    spotTags: ["bar", "pub"],
  },
  movie: {
    format: "screening_tour",
    minPopulation: 150_000,
    venueTags: ["movie theater"],
    spotTags: ["bar", "pub"],
  },
  tv_show: {
    format: "screening_tour",
    minPopulation: 150_000,
    venueTags: ["movie theater"],
    spotTags: ["bar", "pub"],
  },
  podcast: {
    format: "live_show",
    minPopulation: 250_000,
    venueTags: ["performing arts theater", "comedy club", "live music venue"],
    spotTags: ["bar", "cafe"],
  },
  book: {
    format: "live_show",
    minPopulation: 150_000,
    venueTags: ["performing arts theater", "book store"],
    spotTags: ["cafe", "bar"],
  },
  brand: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["stadium", "arena", "sports bar"],
    spotTags: ["sports bar", "pub", "bar"],
  },
  videogame: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["arena", "convention center"],
    spotTags: ["bar", "night club"],
  },
  place: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["arena", "stadium"],
    spotTags: ["bar", "pub"],
  },
};

/** People whose Qloo description is not comedy (actors, hosts): a live show in a theatre. */
export const PERSON_LIVE_SHOW: FormatRule = {
  format: "live_show",
  minPopulation: 250_000,
  venueTags: ["performing arts theater", "live music venue"],
  spotTags: ["bar", "pub"],
};

/** Brand types never offered as sponsors (Qloo `brand_type`). */
export const NON_SPONSOR_BRAND_TYPES: readonly string[] = ["Nonprofit Brand", "Government Brand"];

export type EngineConfig = typeof ENGINE_CONFIG;
