import { ENGINE_CONFIG } from "./config";
import { foldName, levenshtein } from "./match";
import type { Candidate, City } from "./types";

export interface LocalPick {
  entity: Candidate;
  /** 1-based, in Qloo's order after the popularity band. */
  rank: number;
}

/**
 * Who people in a city over-index on. With a place as the only signal Qloo's affinity is close
 * to 1 for most results, so its own order is kept; the popularity band drops mega-stars and acts
 * too obscure to sell tickets, and duplicate names are merged.
 */
export function rankLocal(
  candidates: readonly Candidate[],
  cfg: { count: number; minPopularity: number; maxPopularity: number } = ENGINE_CONFIG.local,
): { picks: LocalPick[]; dropped: number } {
  const seen = new Set<string>();
  const kept = candidates.filter((c) => {
    const key = foldName(c.name);
    if (seen.has(key) || !(c.popularity >= cfg.minPopularity && c.popularity <= cfg.maxPopularity)) return false;
    seen.add(key);
    return true;
  });
  return { picks: kept.slice(0, cfg.count).map((entity, i) => ({ entity, rank: i + 1 })), dropped: candidates.length - kept.length };
}

/**
 * A typed city name ("Seattle", "Portland, Maine", "london uk") to a city in the list: exact name
 * first, then a name it starts, then the nearest spelling; narrowed by the text after a comma
 * (region or country), largest population wins.
 */
export function findCity(text: string, cities: readonly City[]): City | null {
  const [name, ...rest] = text.split(",");
  const want = foldName(name ?? "");
  if (!want) return null;
  const hint = foldName(rest.join(" "));
  const matches = (exact: boolean) =>
    cities.filter((c) => (exact ? foldName(c.name) === want : foldName(c.name).startsWith(want)));
  let pool = matches(true);
  if (pool.length === 0) pool = matches(false);
  if (pool.length === 0) pool = nearMisses(want, cities);
  if (hint) {
    const narrowed = pool.filter((c) => foldName(c.admin1).includes(hint) || foldName(c.country) === hint || (hint === "uk" && c.country === "GB"));
    if (narrowed.length) pool = narrowed;
  }
  return pool.reduce<City | null>((best, c) => (!best || c.population > best.population ? c : best), null);
}

/**
 * Typos ("Ne york", "Seatle"): the cities fewest edits away, with or without a trailing "City".
 * One edit allowed from 4 letters, two from 8; shorter names must match exactly.
 */
function nearMisses(want: string, cities: readonly City[]): City[] {
  const allowed = want.length >= 8 ? 2 : want.length >= 4 ? 1 : 0;
  if (!allowed) return [];
  let best = allowed + 1;
  let pool: City[] = [];
  for (const c of cities) {
    const name = foldName(c.name);
    const d = Math.min(levenshtein(want, name), levenshtein(want, name.replace(/ city$/, "")));
    if (d < best) [best, pool] = [d, [c]];
    else if (d === best) pool.push(c);
  }
  return pool;
}
