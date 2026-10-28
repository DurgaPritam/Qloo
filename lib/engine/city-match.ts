import { ENGINE_CONFIG } from "./config";
import { distanceKm } from "./geo";
import type { City } from "./types";

/**
 * Matches a city name typed by a user (a ticketing or CRM export) to a GeoNames city, then to
 * the metro the engine scores (boroughs and suburbs fold into their city, as in metroCities).
 * Nothing here is a score: it only decides which city a row is about, and says when it cannot.
 */
export type CityMatch =
  | { status: "matched"; city: City; note?: string }
  | { status: "ambiguous"; options: City[] }
  | { status: "unmatched" };

/** A same-name city this many times larger than the next is taken without asking. */
export const AUTO_PICK_RATIO = 10;

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Short forms people type that GeoNames does not list. */
const ALIASES: Record<string, string> = {
  nyc: "new york city",
  "new york ny": "new york city",
  la: "los angeles",
  sf: "san francisco",
  dc: "washington",
  "washington dc": "washington",
  philly: "philadelphia",
  vegas: "las vegas",
};

export function foldPlace(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bst\b/g, "saint")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const withoutCity = (folded: string) => folded.replace(/ city$/, "");

export interface CityIndex {
  byName: Map<string, City[]>;
  metroOf: (city: City) => City;
}

/** Built once per city list: names (and names without "City") to cities, and each city's metro. */
export function cityIndex(cities: readonly City[], metros: readonly City[], mergeKm = ENGINE_CONFIG.cities.metroMergeKm): CityIndex {
  const byName = new Map<string, City[]>();
  const add = (key: string, c: City) => {
    const list = byName.get(key) ?? [];
    if (!list.includes(c)) byName.set(key, [...list, c]);
  };
  for (const c of cities) {
    add(foldPlace(c.name), c);
    add(withoutCity(foldPlace(c.name)), c);
  }
  const metroIds = new Set(metros.map((m) => m.id));
  const metroOf = (city: City) => {
    if (metroIds.has(city.id)) return city;
    // The largest metro of the same country within the merge distance absorbed it.
    return metros.find((m) => m.country === city.country && distanceKm(m.lat, m.lon, city.lat, city.lon) <= mergeKm) ?? city;
  };
  return { byName, metroOf };
}

function regionMatches(city: City, region: string, countryName: (code: string) => string | undefined): boolean {
  const r = foldPlace(region);
  if (!r) return true;
  const state = US_STATES[region.trim().toUpperCase().replace(/\./g, "")];
  if (city.country === "US" && state && foldPlace(state) === foldPlace(city.admin1)) return true;
  if (foldPlace(city.admin1) === r) return true;
  if (city.country.toLowerCase() === r.replace(/ /g, "")) return true;
  return foldPlace(countryName(city.country) ?? "") === r;
}

/**
 * "Portland", "Portland, OR", "Portland, Oregon, US" or "Montreal" → a metro. A country (code or
 * name) from another column narrows the search. Several cities left → the largest when it is at
 * least AUTO_PICK_RATIO times the next (London, England over London, Ontario), else ambiguous.
 */
export function matchCity(
  raw: string,
  index: CityIndex,
  opts: { country?: string | null; countryName?: (code: string) => string | undefined; countryCode?: (name: string) => string | null } = {},
): CityMatch {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { status: "unmatched" };
  const name = foldPlace(parts[0]);
  const regions = parts.slice(1);
  const key = ALIASES[name] ?? ALIASES[foldPlace(parts.join(" "))] ?? name;
  let found = index.byName.get(key) ?? index.byName.get(withoutCity(key)) ?? [];

  const countryName = opts.countryName ?? (() => undefined);
  for (const region of regions) found = found.filter((c) => regionMatches(c, region, countryName));
  const country = opts.country?.trim();
  if (country) {
    const code = country.length === 2 ? country.toUpperCase() : (opts.countryCode?.(country) ?? null);
    if (code) found = found.filter((c) => c.country === code);
  }

  const metros = [...new Map(found.map((c) => [index.metroOf(c).id, index.metroOf(c)])).values()].sort(
    (a, b) => b.population - a.population || a.id.localeCompare(b.id),
  );
  if (!metros.length) return { status: "unmatched" };
  const note = (m: City) => (found.some((c) => c.id === m.id) ? undefined : `${found[0].name} counted in ${m.name}`);
  if (metros.length === 1) return { status: "matched", city: metros[0], note: note(metros[0]) };
  if (metros[0].population >= AUTO_PICK_RATIO * metros[1].population) {
    return { status: "matched", city: metros[0], note: `the largest of ${metros.length} places named ${parts[0]}` };
  }
  return { status: "ambiguous", options: metros.slice(0, 5) };
}

/**
 * The home city Qloo's own description names ("… a professional NBA basketball team based in San
 * Francisco …"): the words after "based in", "from" or "located in", matched to one city of the
 * entity's country. Null when the description names none or the name is ambiguous.
 */
export function cityNamedIn(description: string | undefined, index: CityIndex, country?: string | null): City | null {
  if (!description) return null;
  const m = description.match(/\b(?:based in|located in|hails from|from)\s+((?:[A-Z][\w'.-]*)(?:\s+[A-Z][\w'.-]*){0,3})/);
  if (!m) return null;
  const words = m[1].split(/\s+/);
  // Longest run of capitalised words that is a city ("New York City" before "New York").
  for (let n = words.length; n > 0; n--) {
    const found = matchCity(words.slice(0, n).join(" "), index, { country });
    if (found.status === "matched") return found.city;
  }
  return null;
}
