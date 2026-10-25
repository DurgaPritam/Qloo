import { ENGINE_CONFIG } from "./config";
import type { Entity } from "./types";

export interface MatchOption {
  entity: Entity;
  /** 0–1 name similarity to the query. */
  similarity: number;
}

export type MatchResult =
  | { kind: "resolved"; entity: Entity; similarity: number }
  | { kind: "ambiguous"; options: MatchOption[] }
  | { kind: "did_you_mean"; options: MatchOption[] }
  | { kind: "none" };

/**
 * Decides what a search result list means for the typed name:
 * one clear same-name match → resolved; several same-name matches in different categories with
 * comparable popularity → ambiguous; only near names → did_you_mean; nothing close → none.
 * Search order breaks ties, since Qloo ranks its own results.
 */
export function classifyMatches(query: string, results: readonly Entity[]): MatchResult {
  const cfg = ENGINE_CONFIG.match;
  // A name typed in another script ("अरिजीत सिंह") is compared with Qloo's other names too. Latin
  // queries are not: Qloo's aliases include short forms ("Mercury" for Phoenix Mercury).
  const useAliases = !LATIN_ONLY.test(query);
  const scored = mergeSamePerson(results).map((entity) => ({
    entity,
    similarity: Math.max(
      nameSimilarity(query, entity.name),
      ...(useAliases ? (entity.aliases ?? []) : []).map((a) => nameSimilarity(query, a)),
    ),
  }));

  const exact = scored.filter((o) => o.similarity >= cfg.exactSimilarity);
  if (exact.length > 0) {
    const [first, ...rest] = [...exact].sort(
      (a, b) => b.entity.popularity - a.entity.popularity,
    );
    // Qloo popularity is a percentile bunched near 1, so compare distance from 1: a rival is no
    // more than dominanceFactor times rarer than the top match.
    const rarity = (e: Entity) => 1 - e.popularity;
    const rivals = rest.filter(
      (o) =>
        o.entity.category !== first.entity.category &&
        rarity(o.entity) <= cfg.dominanceFactor * Math.max(rarity(first.entity), 1e-6),
    );
    if (rivals.length === 0) {
      return { kind: "resolved", entity: first.entity, similarity: first.similarity };
    }
    return { kind: "ambiguous", options: [first, ...rivals].slice(0, cfg.maxOptions) };
  }

  const near = scored
    .filter((o) => o.similarity >= cfg.suggestSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, cfg.maxOptions);
  return near.length ? { kind: "did_you_mean", options: near } : { kind: "none" };
}

/** 1 - Levenshtein distance / longer length, on case-, accent- and punctuation-folded names. */
export function nameSimilarity(a: string, b: string): number {
  const x = foldName(a);
  const y = foldName(b);
  if (!x && !y) return 1;
  const longest = Math.max(x.length, y.length);
  return longest ? 1 - levenshtein(x, y) / longest : 0;
}

export function foldName(name: string): string {
  return (
    name
      .normalize("NFKD")
      // Latin accents only: other scripts' vowel signs are marks too and must stay.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      // Club suffixes: "Arsenal F.C." and "Arsenal" are the same name.
      .replace(/\b(a\.?f\.?c|f\.?c|c\.?f|s\.?c)\.?$/u, "")
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
      .replace(/^the /, "")
      .trim()
  );
}

const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\p{M}]*$/u;

const COMEDY = /\b(comedian|comedy|comic|stand-?up)\b/i;

export function isComedian(entity: Entity): boolean {
  return COMEDY.test(entity.description ?? "");
}

/**
 * Qloo lists famous people twice under one name: a person and an artist (docs/qloo-shapes.md).
 * Keep one: the person for comedians (comedy rooms, comedy partners), the artist otherwise
 * (music). Order and other results are unchanged.
 */
export function mergeSamePerson(results: readonly Entity[]): Entity[] {
  const drop = new Set<string>();
  const enrich = new Map<string, Entity>();
  for (const person of results.filter((e) => e.category === "person")) {
    const artist = results.find((e) => e.category === "artist" && foldName(e.name) === foldName(person.name));
    if (!artist) continue;
    if (isComedian(person) || isComedian(artist)) {
      drop.add(artist.id);
    } else {
      drop.add(person.id);
      // Only the person record carries citizenship.
      enrich.set(artist.id, { ...artist, homeCountry: artist.homeCountry ?? person.homeCountry });
    }
  }
  return results.filter((e) => !drop.has(e.id)).map((e) => enrich.get(e.id) ?? e);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length];
}
