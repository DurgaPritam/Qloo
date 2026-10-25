/**
 * SAMPLE DATA — not Qloo results. Used only by MockQlooSource when TAKEOVER_MOCK=1.
 * All names are fictional and marked "(sample)". Numbers are made up to exercise the engine.
 * Never copy this into tests/fixtures/ (real Qloo responses only) or the Redis cache.
 */
import type { Category } from "@/lib/engine/types";

export interface MockItem {
  name: string;
  affinity: number;
  popularity: number;
  tags?: string[];
}

/** A query with no vowels returns no results, to demo the empty-search fallback. */
export const MOCK_EMPTY_QUERY = /^[^aeiouy]*$/i;

export const MOCK_SEED = { category: "artist" as Category, popularity: 0.55 };

/**
 * Queries with scripted search results, to exercise each branch of the identify step. The
 * landing examples get a category so each format shows; the rest default to MOCK_SEED.
 */
export const MOCK_SEARCH: Record<
  string,
  Array<{ name: string; category: Category; popularity: number; description?: string }>
> = {
  "john mulaney": [{ name: "John Mulaney", category: "person", popularity: 0.7, description: "Stand-up comedian (sample description)" }],
  "phoebe bridgers": [{ name: "Phoebe Bridgers", category: "artist", popularity: 0.65 }],
  sinners: [{ name: "Sinners", category: "movie", popularity: 0.75 }],
  arsenal: [{ name: "Arsenal F.C.", category: "brand", popularity: 0.8 }],
  // Same name, two categories, similar reach: the picker.
  mercury: [
    { name: "Mercury", category: "artist", popularity: 0.6 },
    { name: "Mercury", category: "movie", popularity: 0.55 },
  ],
  // Nonsense: nothing found.
  asdfgh: [],
  // Misspellings: "did you mean".
  "kevn hart": [{ name: "Kevin Hart", category: "person", popularity: 0.85, description: "Comedian and actor (sample description)" }],
  "billie elish": [{ name: "Billie Eilish", category: "artist", popularity: 0.9 }],
};

/**
 * Values mimic real Qloo ranges (docs/qloo-shapes.md): affinity 0.85–0.98, popularity bunched
 * near 1. One mega-star and one barely-known entry exercise the popularity band.
 */
export const MOCK_CANDIDATES: Partial<Record<Category, MockItem[]>> = {
  artist: [
    { name: "Velvet Static (sample)", affinity: 0.971, popularity: 0.982 },
    { name: "Northbound Echo (sample)", affinity: 0.958, popularity: 0.951 },
    { name: "Paper Lanterns (sample)", affinity: 0.941, popularity: 0.973 },
    // Highest affinity but near-universal reach: the popularity band should drop it.
    { name: "Global Megastar (sample)", affinity: 0.985, popularity: 0.9996 },
  ],
  movie: [
    { name: "The Long Quiet (sample)", affinity: 0.932, popularity: 0.968 },
    { name: "Paper Satellites (sample)", affinity: 0.914, popularity: 0.981 },
    { name: "Low Tide (sample)", affinity: 0.897, popularity: 0.955 },
  ],
  tv_show: [
    { name: "Afterhours Kitchen (sample)", affinity: 0.962, popularity: 0.912 },
    { name: "Coastline Detectives (sample)", affinity: 0.948, popularity: 0.884 },
    { name: "Night Shift Diaries (sample)", affinity: 0.939, popularity: 0.902 },
  ],
  podcast: [
    { name: "Small Rooms, Loud Bands (sample)", affinity: 0.951, popularity: 0.976 },
    { name: "Weekly Roundup (sample)", affinity: 0.902, popularity: 0.988 },
    // Barely known: below the popularity band.
    { name: "Basement Tapes Pod (sample)", affinity: 0.958, popularity: 0.21 },
  ],
  person: [
    { name: "Ada Fictional (sample)", affinity: 0.944, popularity: 0.931 },
    { name: "Jo Placeholder (sample)", affinity: 0.921, popularity: 0.947 },
  ],
  brand: [
    { name: "Fieldnote Coffee (sample)", affinity: 0.928, popularity: 0.962 },
    { name: "Northway Outfitters (sample)", affinity: 0.911, popularity: 0.978 },
  ],
  videogame: [
    { name: "Lantern Drift (sample)", affinity: 0.874, popularity: 0.981 },
    { name: "Signal Lost (sample)", affinity: 0.861, popularity: 0.964 },
  ],
};

/** Real city centres, used only to place sample heat cells. */
export const MOCK_HEAT_CENTRES = [
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298 },
  { name: "Austin", lat: 30.2672, lon: -97.7431 },
  { name: "Nashville", lat: 36.1627, lon: -86.7816 },
  { name: "Seattle", lat: 47.6062, lon: -122.3321 },
  { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  { name: "London", lat: 51.5074, lon: -0.1278 },
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Mexico City", lat: 19.4326, lon: -99.1332 },
] as const;

/** Cells generated around each centre, offset by up to this many degrees. */
export const MOCK_CELL_OFFSETS = [
  [0, 0],
  [0.08, 0.05],
  [-0.06, 0.07],
  [0.04, -0.09],
] as const;

export const MOCK_PLACES: MockItem[] = [
  { name: "The Lamplight Room (sample)", affinity: 0.884, popularity: 0.97, tags: ["live music venue", "comedy club"] },
  { name: "Foundry Hall (sample)", affinity: 0.871, popularity: 0.95, tags: ["concert hall", "performing arts theater"] },
  { name: "Palisade Cinema (sample)", affinity: 0.869, popularity: 0.93, tags: ["movie theater"] },
  { name: "Northside Arena (sample)", affinity: 0.893, popularity: 0.99, tags: ["arena", "stadium", "live music venue"] },
  { name: "Copper Tap (sample)", affinity: 0.866, popularity: 0.88, tags: ["bar", "pub", "sports bar"] },
  { name: "Night Owl Cafe (sample)", affinity: 0.858, popularity: 0.84, tags: ["cafe", "book store"] },
  { name: "Riverside Pavilion (sample)", affinity: 0.848, popularity: 0.96, tags: ["live music venue", "night club"] },
  { name: "Late Shift Diner (sample)", affinity: 0.15, popularity: 0.6, tags: ["bar"] },
];

export const MOCK_BRANDS: MockItem[] = [
  { name: "Fieldnote Coffee (sample)", affinity: 0.952, popularity: 0.962 },
  { name: "Northway Outfitters (sample)", affinity: 0.945, popularity: 0.978 },
  { name: "Brightside Audio (sample)", affinity: 0.939, popularity: 0.951 },
  { name: "Harbor Supply Co. (sample)", affinity: 0.921, popularity: 0.944 },
  { name: "Everywhere Cola (sample)", affinity: 0.96, popularity: 0.9997 },
];
