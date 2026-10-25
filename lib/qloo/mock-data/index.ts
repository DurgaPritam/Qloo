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
  "everything everywhere all at once": [
    { name: "Everything Everywhere All at Once", category: "movie", popularity: 0.75 },
  ],
  "golden state warriors": [{ name: "Golden State Warriors", category: "brand", popularity: 0.8 }],
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

export const MOCK_CANDIDATES: Partial<Record<Category, MockItem[]>> = {
  artist: [
    { name: "Velvet Static (sample)", affinity: 0.88, popularity: 0.41 },
    { name: "Northbound Echo (sample)", affinity: 0.74, popularity: 0.22 },
    // Highest affinity but near-universal reach: the bias guard should drop it.
    { name: "Global Megastar (sample)", affinity: 0.95, popularity: 0.99 },
  ],
  movie: [
    { name: "The Long Quiet (sample)", affinity: 0.69, popularity: 0.35 },
    { name: "Paper Satellites (sample)", affinity: 0.52, popularity: 0.6 },
  ],
  tv_show: [
    { name: "Afterhours Kitchen (sample)", affinity: 0.81, popularity: 0.48 },
    { name: "Coastline Detectives (sample)", affinity: 0.44, popularity: 0.7 },
  ],
  podcast: [
    { name: "Small Rooms, Loud Bands (sample)", affinity: 0.86, popularity: 0.12 },
    { name: "Weekly Roundup (sample)", affinity: 0.25, popularity: 0.5 },
  ],
  person: [{ name: "Ada Fictional (sample)", affinity: 0.63, popularity: 0.3 }],
  brand: [{ name: "Fieldnote Coffee (sample)", affinity: 0.72, popularity: 0.28 }],
  videogame: [{ name: "Lantern Drift (sample)", affinity: 0.58, popularity: 0.33 }],
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
  { name: "The Lamplight Room (sample)", affinity: 0.84, popularity: 0.4, tags: ["music venue", "comedy club"] },
  { name: "Foundry Hall (sample)", affinity: 0.71, popularity: 0.62, tags: ["concert hall", "theater"] },
  { name: "Palisade Cinema (sample)", affinity: 0.69, popularity: 0.5, tags: ["movie theater", "cinema"] },
  { name: "Northside Arena (sample)", affinity: 0.63, popularity: 0.8, tags: ["arena", "stadium"] },
  { name: "Copper Tap (sample)", affinity: 0.66, popularity: 0.3, tags: ["bar", "pub", "sports bar"] },
  { name: "Night Owl Cafe (sample)", affinity: 0.58, popularity: 0.25, tags: ["cafe", "bookstore"] },
  { name: "Riverside Pavilion (sample)", affinity: 0.48, popularity: 0.75, tags: ["music venue", "arena"] },
  { name: "Late Shift Diner (sample)", affinity: 0.15, popularity: 0.2, tags: ["restaurant", "bar"] },
];

export const MOCK_BRANDS: MockItem[] = [
  { name: "Fieldnote Coffee (sample)", affinity: 0.72, popularity: 0.28 },
  { name: "Northway Outfitters (sample)", affinity: 0.65, popularity: 0.45 },
  { name: "Brightside Audio (sample)", affinity: 0.59, popularity: 0.22 },
  { name: "Everywhere Cola (sample)", affinity: 0.9, popularity: 0.99 },
];
