import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { classifyMatches, mergeSamePerson } from "@/lib/engine/match";
import { formatFor } from "@/lib/engine/formats";
import { countryFromDescription } from "@/lib/engine/markets";
import { QlooApiSource } from "@/lib/qloo/api";
import type { QlooClient } from "@/lib/qloo/client";
import { compact, toEntity, type RawEntity } from "@/lib/qloo/map";

/** Trimmed real Qloo responses (tests/fixtures/qloo, from scripts/trim-fixtures.ts). */
const fixture = (rel: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/qloo", rel), "utf8")) as { results: unknown };
const searchOf = (rel: string) => compact((fixture(rel).results as RawEntity[]).map(toEntity));

function sourceReturning(rel: string) {
  const get = vi.fn(async (_path: string, params: Record<string, unknown>) => ({
    data: fixture(rel),
    meta: { endpoint: _path, params: params as Record<string, string>, cached: false, ms: 1 },
  }));
  return { source: new QlooApiSource({ get } as unknown as Pick<QlooClient, "get">), get };
}

const run = { runId: "t" };

describe("QlooApiSource on real responses", () => {
  it("search: typed request, entities with description, image and home country", async () => {
    const { source, get } = sourceReturning("search/comedian.json");
    const { data, meta } = await source.searchEntities("John Mulaney", undefined, run);

    expect(get.mock.calls[0][1]).toMatchObject({ query: "John Mulaney", take: 10 });
    expect((get.mock.calls[0][1] as { types: string[] }).types).toContain("urn:entity:person");
    expect((get.mock.calls[0][1] as { types: string[] }).types).not.toContain("urn:entity:place");
    expect(meta.mock).toBe(false);
    const mulaney = data[0];
    expect(mulaney).toMatchObject({ name: "John Mulaney", category: "person", homeCountry: "US" });
    expect(mulaney.description).toMatch(/comedian/);
    expect(mulaney.imageUrl).toMatch(/^https:\/\/images\.qloo\.com\//);
  });

  it("partners: affinity from query.affinity, popularity 0–1", async () => {
    const { source } = sourceReturning("insights/comedian/podcast.json");
    const { data } = await source.candidates(["x"], "podcast", undefined, run);
    expect(data.length).toBeGreaterThan(10);
    for (const c of data) {
      expect(c.category).toBe("podcast");
      expect(c.affinity).toBeGreaterThan(0);
      expect(c.affinity).toBeLessThanOrEqual(1);
      expect(c.popularity).toBeLessThanOrEqual(1);
    }
  });

  it("heatmap: requires a location and maps cells", async () => {
    const { source, get } = sourceReturning("extra/heatmap-mulaney-us.json");
    await expect(source.heatmap(["x"], undefined, run)).rejects.toThrow(/location/);
    const { data } = await source.heatmap(["x"], "United States", run);
    expect(get.mock.calls[0][1]).toMatchObject({ "filter.type": "urn:heatmap", "filter.location.query": "United States" });
    expect(data.length).toBeGreaterThan(2000);
    expect(data[0]).toEqual({ lat: expect.any(Number), lon: expect.any(Number), affinity: expect.any(Number), geohash: expect.any(String) });
  });

  it("places: real tag ids in the request, tag names and address in the result", async () => {
    const { source, get } = sourceReturning("extra/places-comedy-chicago.json");
    const { data } = await source.places(["x"], "Chicago, Illinois", ["comedy club", "performing arts theater"], run);
    expect((get.mock.calls[0][1] as Record<string, unknown>)["filter.tags"]).toEqual([
      "urn:tag:category:place:comedy_club",
      "urn:tag:category:place:performing_arts_theater",
    ]);
    expect(data[0]).toMatchObject({ name: "The Second City", tags: expect.arrayContaining(["comedy club"]) });
    expect(data[0].address).toMatch(/Chicago/);
  });

  it("brands: brand types come through for sponsor filtering", async () => {
    const { source } = sourceReturning("extra/brands-chicago-two-signals.json");
    const { data } = await source.brands(["x", "y"], "Chicago, Illinois", run);
    expect(data.find((b) => b.name === "ACLU")?.brandTypes).toEqual(["Nonprofit Brand"]);
  });
});

describe("matching on real search results", () => {
  it("merges the person and artist entries of one person, keeping the right one", () => {
    const mulaney = mergeSamePerson(searchOf("search/comedian.json")).filter((e) => e.name === "John Mulaney");
    expect(mulaney.map((e) => e.category)).toEqual(["person"]);

    const sabrina = mergeSamePerson(searchOf("extra/search-typed-sabrina.json")).filter((e) => e.name === "Sabrina Carpenter");
    expect(sabrina.map((e) => e.category)).toEqual(["artist"]);
    expect(sabrina[0].homeCountry).toBe("US");
  });

  it("resolves famous names without a picker, and the club behind 'Arsenal F.C.'", () => {
    expect(classifyMatches("John Mulaney", searchOf("search/comedian.json"))).toMatchObject({ kind: "resolved", entity: { category: "person" } });
    expect(classifyMatches("Sabrina Carpenter", searchOf("extra/search-typed-sabrina.json"))).toMatchObject({ kind: "resolved", entity: { category: "artist" } });
    expect(classifyMatches("Sinners", searchOf("search/film.json"))).toMatchObject({ kind: "resolved", entity: { category: "movie" } });
    const club = classifyMatches("Arsenal", searchOf("extra/search-arsenal-f-c-.json"));
    expect(club).toMatchObject({ kind: "resolved", entity: { name: "Arsenal F.C.", category: "brand" } });
  });

  it("offers did-you-mean for a misspelling and nothing for nonsense", () => {
    const typo = classifyMatches("Billie Elish", searchOf("search/misspelled.json"));
    expect(typo.kind).toBe("did_you_mean");
    if (typo.kind === "did_you_mean") expect(typo.options[0].entity.name).toBe("Billie Eilish");
    expect(classifyMatches("asdfgh", searchOf("extra/search-typed-asdfgh.json"))).toEqual({ kind: "none" });
  });

  it("formats follow Qloo's description", () => {
    const [mulaney] = searchOf("search/comedian.json");
    expect(formatFor(mulaney).venueTags).toContain("comedy club");
    const [club] = searchOf("extra/search-arsenal-f-c-.json");
    expect(formatFor(club).format).toBe("fan_fest");
  });

  it("finds home countries in descriptions", () => {
    expect(countryFromDescription("Arsenal F.C. is a professional football club based in London, competing in the league.")).toBe("GB");
    expect(countryFromDescription("An English post-punk and experimental rock band")).toBe("GB");
    expect(countryFromDescription("A South Korean boy band")).toBe("KR");
    expect(countryFromDescription("Alex Cooper tackles candid topics")).toBeNull();
  });
});
