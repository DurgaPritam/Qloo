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
  const scored = results.map((entity) => ({ entity, similarity: nameSimilarity(query, entity.name) }));

  const exact = scored.filter((o) => o.similarity >= cfg.exactSimilarity);
  if (exact.length > 0) {
    const [first, ...rest] = [...exact].sort(
      (a, b) => b.entity.popularity - a.entity.popularity,
    );
    const rivals = rest.filter(
      (o) =>
        o.entity.category !== first.entity.category &&
        o.entity.popularity >= first.entity.popularity * cfg.ambiguityPopularityRatio,
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
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^the /, "")
    .trim();
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
