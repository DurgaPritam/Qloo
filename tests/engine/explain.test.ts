import { describe, expect, it } from "vitest";

import { scoreCities } from "@/lib/engine/cities";
import { explain } from "@/lib/engine/explain";
import { scorePartners } from "@/lib/engine/partners";
import { rankBrands, rankPlaces } from "@/lib/engine/places";
import type { Pick } from "@/lib/engine/types";

import { ALPHA, BETA, candidate, heatAt } from "./builders";

/** Every number in the sentence must come from the pick (2 dp) or be a rank. */
function numbersIn(sentence: string): string[] {
  return sentence.match(/\d+(\.\d+)?/g) ?? [];
}

function allowedNumbers(pick: Pick): Set<string> {
  const values: number[] = [pick.rank];
  if (pick.kind === "city") {
    values.push(pick.combined, pick.sA, pick.sB, pick.populationRank);
  } else {
    values.push(pick.score, pick.evidence.affinity, pick.evidence.popularity);
    if ("relativeAffinity" in pick.evidence) values.push(pick.evidence.relativeAffinity);
  }
  return new Set(values.flatMap((v) => [v.toFixed(2), String(v)]));
}

function expectOneSentence(text: string) {
  expect(text).toMatch(/^\S.*\.$/);
  expect(text.replace(/\d\.\d/g, "").split(". ")).toHaveLength(1);
  expect(text).not.toMatch(/undefined|NaN|null/);
}

describe("explain", () => {
  const picks: Pick[] = [
    scorePartners([candidate("Velvet", "tv_show", 0.95, 0.9), candidate("Echo", "movie", 0.9, 0.95)]).picks[0],
    scoreCities([...heatAt(ALPHA, 0.9), ...heatAt(BETA, 0.5)], heatAt(ALPHA, 0.6), [ALPHA, BETA], 0)[0],
    rankPlaces([{ id: "p", name: "Lamplight", affinity: 0.84, popularity: 0.4, tags: ["bar"] }], [
      "bar",
    ]).picks[0],
    rankBrands([{ id: "b", name: "Fieldnote", affinity: 0.92, popularity: 0.95 }]).picks[0],
  ];

  it.each(picks.map((p) => [p.kind, p] as const))("writes one sentence for a %s pick", (_kind, pick) => {
    const text = explain(pick);
    expectOneSentence(text);
    const allowed = allowedNumbers(pick);
    for (const num of numbersIn(text)) expect(allowed).toContain(num);
  });

  it("names the entity, its category and confidence", () => {
    expect(explain(picks[0])).toBe(
      "Velvet (TV show) ranks #1 with a score of 0.71, from affinity 0.95 (1.00 relative to its category) and popularity 0.90, high confidence.",
    );
  });

  it("mentions matched tags for places", () => {
    expect(explain(picks[2])).toContain("matching bar");
  });
});
