import { CITIES } from "./data";
import countries from "./data/countries.json";
import { foldName } from "./match";

/**
 * Markets are countries. Qloo heatmaps need a location, so cities are
 * ranked inside one market: the fanbase's home country when Qloo's own properties say it, else
 * the default.
 */
export interface Market {
  /** ISO 3166-1 alpha-2 */
  code: string;
  /** GeoNames country name, also the heatmap's filter.location.query. */
  name: string;
}

export const DEFAULT_MARKET = "US";

const BY_CODE = new Map(countries.map((c) => [c.code, c]));
const BY_NAME = new Map(countries.map((c) => [foldName(c.name), c.code]));

/** Common long or short forms Qloo uses that differ from GeoNames names. */
const ALIASES: Record<string, string> = {
  "united states of america": "US",
  usa: "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  "united kingdom of great britain and northern ireland": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "republic of korea": "KR",
  korea: "KR",
  "russian federation": "RU",
  "czech republic": "CZ",
  holland: "NL",
  "republic of ireland": "IE",
};

/** Nationality words in Qloo descriptions ("American actor and comedian", "An English band"). */
const DEMONYMS: Record<string, string> = {
  american: "US",
  british: "GB",
  english: "GB",
  scottish: "GB",
  welsh: "GB",
  irish: "IE",
  canadian: "CA",
  australian: "AU",
  "new zealand": "NZ",
  german: "DE",
  french: "FR",
  spanish: "ES",
  italian: "IT",
  mexican: "MX",
  brazilian: "BR",
  argentine: "AR",
  argentinian: "AR",
  colombian: "CO",
  japanese: "JP",
  "south korean": "KR",
  korean: "KR",
  indian: "IN",
  dutch: "NL",
  swedish: "SE",
  norwegian: "NO",
  danish: "DK",
  nigerian: "NG",
  "south african": "ZA",
  "puerto rican": "PR",
};

export function marketFor(code: string | undefined): Market | null {
  const c = code && BY_CODE.get(code.toUpperCase());
  return c ? { code: c.code, name: c.name } : null;
}

export function countryCode(name: string | undefined): string | null {
  if (!name) return null;
  const folded = foldName(name);
  return ALIASES[folded] ?? BY_NAME.get(folded) ?? null;
}

/**
 * The home country stated in a description: "based in London" (looked up in the city list),
 * else the earliest nationality word.
 */
export function countryFromDescription(text: string | undefined): string | null {
  if (!text) return null;
  const based = /\bbased in ([A-Z][\p{L}.' -]+?)(?:[,.;]| and | that | who |$)/u.exec(text);
  if (based) {
    const place = based[1].trim();
    const asCountry = countryCode(place);
    if (asCountry) return asCountry;
    const city = CITIES.find((c) => c.name === place);
    if (city) return city.country;
  }
  const lower = text.toLowerCase();
  let best: { at: number; len: number; code: string } | null = null;
  for (const [word, code] of Object.entries(DEMONYMS)) {
    const m = new RegExp(`\\b${word}\\b`).exec(lower);
    if (!m) continue;
    // Earliest wins; at the same position the longer phrase ("south korean" over "korean").
    if (!best || m.index < best.at || (m.index === best.at && word.length > best.len)) {
      best = { at: m.index, len: word.length, code };
    }
  }
  return best?.code ?? null;
}
