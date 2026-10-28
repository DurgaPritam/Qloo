import { countryCode, countryFromDescription } from "@/lib/engine/markets";
import type { Brand, Candidate, Category, Entity, HeatCell, Place } from "@/lib/engine/types";

/**
 * Raw Qloo JSON → our engine types. Field paths are documented in docs/qloo-shapes.md; anything
 * missing or malformed is dropped here rather than guessed.
 */

export interface RawEntity {
  entity_id?: string;
  name?: string;
  types?: string[];
  /** Insights results say "urn:entity" here and put the real type in subtype. */
  type?: string;
  subtype?: string;
  popularity?: number;
  disambiguation?: string;
  query?: { affinity?: number };
  location?: { lat?: number; lon?: number };
  properties?: {
    akas?: Array<{ value?: string }>;
    short_description?: string;
    image?: { url?: string };
    citizenship?: string[];
    release_country?: string | string[];
    brand_type?: string[] | null;
    address?: string;
  };
  tags?: Array<{ id?: string; name?: string; type?: string }>;
}

export interface RawHeatCell {
  location?: { latitude?: number; longitude?: number; geohash?: string };
  query?: { affinity?: number; popularity?: number };
}

const CATEGORIES: ReadonlySet<string> = new Set<Category>([
  "artist",
  "person",
  "movie",
  "tv_show",
  "podcast",
  "brand",
  "book",
  "videogame",
  "place",
]);

export const urn = (c: Category) => `urn:entity:${c}`;

export function categoryOf(raw: RawEntity): Category | null {
  const t = (raw.types?.[0] ?? raw.subtype ?? raw.type ?? "").replace("urn:entity:", "");
  return CATEGORIES.has(t) ? (t as Category) : null;
}

/** Home country from Qloo properties, most reliable first. */
export function homeCountryOf(raw: RawEntity): string | undefined {
  const p = raw.properties ?? {};
  const release = Array.isArray(p.release_country) ? p.release_country[0] : p.release_country;
  return (
    countryCode(p.citizenship?.[0]) ??
    countryCode(release) ??
    countryFromDescription(p.short_description) ??
    undefined
  );
}

export function toEntity(raw: RawEntity): Entity | null {
  const category = categoryOf(raw);
  if (!raw.entity_id || !raw.name || !category) return null;
  return {
    id: raw.entity_id,
    name: raw.name,
    category,
    // Some results carry no popularity; treat them as unknown-to-most, not as famous.
    popularity: typeof raw.popularity === "number" ? raw.popularity : 0,
    imageUrl: raw.properties?.image?.url,
    description: raw.properties?.short_description || undefined,
    disambiguation: raw.disambiguation || undefined,
    homeCountry: homeCountryOf(raw),
    aliases: aliasesOf(raw),
    tags: tagNames(raw),
  };
}

/** Qloo's tag names (genres, sectors, "Sports Organization"…), for filters; capped, no aesthetic tags. */
function tagNames(raw: RawEntity): string[] | undefined {
  const names = (raw.tags ?? []).filter((t) => t.name && !t.type?.includes("aesthetic")).map((t) => t.name!.trim());
  return names.length ? [...new Set(names)].slice(0, 12) : undefined;
}

/** A brand's sectors: Qloo's genre:brand tags ("Beverage", "Streaming Service App"), in Qloo's order. */
function sectorsOf(raw: RawEntity): string[] | undefined {
  const names = (raw.tags ?? []).filter((t) => t.name && (t.type === "urn:tag:genre:brand" || t.id?.startsWith("urn:tag:genre:brand"))).map((t) => t.name!.trim());
  return names.length ? [...new Set(names)].slice(0, 5) : undefined;
}

function aliasesOf(raw: RawEntity): string[] | undefined {
  const names = [...new Set((raw.properties?.akas ?? []).map((a) => a.value?.trim()).filter((v): v is string => Boolean(v)))];
  const others = names.filter((n) => n !== raw.name).slice(0, 25);
  return others.length ? others : undefined;
}

/** An insights result relative to the signal. Missing affinity or popularity → NaN, so the engine drops it as invalid. */
export function toCandidate(raw: RawEntity, category: Category): Candidate | null {
  const base = toEntity({ ...raw, types: raw.types ?? [raw.subtype ?? urn(category)] });
  if (!base) return null;
  return {
    ...base,
    category: base.category === "place" ? category : base.category,
    popularity: typeof raw.popularity === "number" ? raw.popularity : Number.NaN,
    affinity: typeof raw.query?.affinity === "number" ? raw.query.affinity : Number.NaN,
  };
}

export function toHeatCell(raw: RawHeatCell): HeatCell | null {
  const lat = raw.location?.latitude;
  const lon = raw.location?.longitude;
  const affinity = raw.query?.affinity;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof affinity !== "number") return null;
  const popularity = raw.query?.popularity;
  return { lat, lon, affinity, popularity: typeof popularity === "number" ? popularity : undefined, geohash: raw.location?.geohash };
}

/** Place tag names (lower case) from Qloo's category and genre place tags, for matching. */
function placeTagNames(tags: RawEntity["tags"]): string[] {
  const names = (tags ?? [])
    .filter((t) => /^urn:tag:(category|genre):place:/.test(t.id ?? ""))
    .map((t) => (t.name ?? "").toLowerCase())
    .filter(Boolean);
  return [...new Set(names)];
}

export function toPlace(raw: RawEntity): Place | null {
  if (!raw.entity_id || !raw.name) return null;
  return {
    id: raw.entity_id,
    name: raw.name,
    affinity: typeof raw.query?.affinity === "number" ? raw.query.affinity : Number.NaN,
    popularity: typeof raw.popularity === "number" ? raw.popularity : Number.NaN,
    tags: placeTagNames(raw.tags),
    address: raw.properties?.address || undefined,
    description: raw.properties?.short_description || undefined,
    lat: raw.location?.lat,
    lon: raw.location?.lon,
  };
}

export function toBrand(raw: RawEntity): Brand | null {
  if (!raw.entity_id || !raw.name) return null;
  return {
    id: raw.entity_id,
    name: raw.name,
    affinity: typeof raw.query?.affinity === "number" ? raw.query.affinity : Number.NaN,
    popularity: typeof raw.popularity === "number" ? raw.popularity : Number.NaN,
    brandTypes: raw.properties?.brand_type ?? undefined,
    description: raw.properties?.short_description || undefined,
    tags: tagNames(raw),
    sectors: sectorsOf(raw),
  };
}

export const compact = <T>(xs: Array<T | null>): T[] => xs.filter((x): x is T => x !== null);
