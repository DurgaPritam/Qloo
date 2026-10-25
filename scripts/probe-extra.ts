/**
 * Second probe, after the first showed that heatmaps need a location and guessed tag ids were
 * wrong: locality insights, country-filtered heatmaps, typed search, sports clubs, real tag ids,
 * and places with real tags. Saves raw JSON to tests/fixtures/extra/.
 *
 *   npx tsx --conditions=react-server scripts/probe-extra.ts [1|2]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MemoryCache, type QlooParams } from "../lib/qloo/cache";
import { createQlooClient } from "../lib/qloo/client";
import { QlooError } from "../lib/qloo/errors";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "tests", "fixtures", "extra");
process.loadEnvFile(path.join(ROOT, ".env.local"));

const MULANEY = "BDA4DDC1-E7C1-410E-8001-C1E17E29465C";
const SABRINA_PERSON = "Sabrina Carpenter";
const SABRINA_ARTIST = "F5453A45-593C-41EC-BD5A-453D1AEC565C";
const OH_HELLO = "78160D1E-A84C-40F3-B0FE-A527D60C24F1";
const ARSENAL = "0119CDA9-A9D1-42C9-B06F-3F03AEC2AC05";
const FAN_TYPES = ["artist", "person", "movie", "tv_show", "podcast", "brand", "book", "videogame"].map((t) => `urn:entity:${t}`);

const client = createQlooClient({ cache: new MemoryCache(), budget: 200 });
let calls = 0;
let quota: number | undefined;

async function get(name: string, endpoint: string, params: QlooParams) {
  try {
    const { data, meta } = await client.get<unknown>(endpoint, params, { runId: "probe-extra" });
    calls++;
    quota = meta.quotaRemaining ?? quota;
    await writeFile(path.join(OUT, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`✓ ${name} (${meta.ms}ms)`);
    return data as Record<string, unknown>;
  } catch (err) {
    calls++;
    console.log(`✗ ${name}: ${err instanceof QlooError ? `${err.kind} ${err.status ?? ""} ${err.message.slice(0, 200)}` : String(err)}`);
    return null;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const stage = process.argv[2] ?? "1";

  if (stage === "1") {
    // Cities: locality insights, globally and per country; heatmap with a country filter.
    await get("locality-mulaney", "/v2/insights", { "filter.type": "urn:entity:locality", "signal.interests.entities": [MULANEY], take: 30 });
    await get("locality-mulaney-us", "/v2/insights", {
      "filter.type": "urn:entity:locality",
      "signal.interests.entities": [MULANEY],
      "filter.location.query": "United States",
      take: 30,
    });
    await get("heatmap-mulaney-us", "/v2/insights", {
      "filter.type": "urn:heatmap",
      "signal.interests.entities": [MULANEY],
      "filter.location.query": "United States",
    });
    // Search restricted to fanbase types; sports clubs.
    await get("search-typed-asdfgh", "/search", { query: "asdfgh", types: FAN_TYPES });
    await get("search-typed-sabrina", "/search", { query: SABRINA_PERSON, types: FAN_TYPES, take: 5 });
    for (const q of ["Arsenal F.C.", "Golden State Warriors", "Manchester United"]) {
      await get(`search-${q.toLowerCase().replace(/[^a-z]+/g, "-")}`, "/search", { query: q, take: 8 });
    }
    for (const q of ["music venue", "comedy club", "theater", "movie theater", "stadium", "arena", "sports bar", "concert hall", "pub", "cafe"]) {
      await get(`tags-${q.replace(/\s+/g, "-")}`, "/v2/tags", { "filter.query": q, "filter.parents.types": "urn:entity:place", take: 10 });
    }
  }

  if (stage === "2") {
    for (const q of ["live music venue", "performing arts theater", "night club", "bookstore", "convention center"]) {
      await get(`tags-${q.replace(/\s+/g, "-")}`, "/v2/tags", { "filter.query": q, "filter.parents.types": "urn:entity:place", take: 10 });
    }
    // Places with real tags, one and two signals; brands in a city.
    await get("places-comedy-chicago", "/v2/insights", {
      "filter.type": "urn:entity:place",
      "signal.interests.entities": [MULANEY],
      "filter.location.query": "Chicago",
      "filter.tags": ["urn:tag:category:place:comedy_club"],
      take: 10,
    });
    await get("places-bar-pub-chicago-two-signals", "/v2/insights", {
      "filter.type": "urn:entity:place",
      "signal.interests.entities": [MULANEY, OH_HELLO],
      "filter.location.query": "Chicago",
      "filter.tags": ["urn:tag:category:place:bar", "urn:tag:category:place:pub"],
      take: 10,
    });
    await get("brands-chicago-two-signals", "/v2/insights", {
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": [MULANEY, OH_HELLO],
      "signal.location.query": "Chicago",
      take: 10,
    });
    await get("artists-near-chicago", "/v2/insights", {
      "filter.type": "urn:entity:person",
      "signal.interests.entities": [MULANEY, OH_HELLO],
      "signal.location.query": "Chicago",
      take: 10,
    });
    // Partner heatmap (a podcast) and a UK club heatmap.
    await get("heatmap-ohhello-us", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": [OH_HELLO], "filter.location.query": "United States" });
    await get("heatmap-arsenal-gb", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": [ARSENAL], "filter.location.query": "United Kingdom" });
    // Person vs artist entity for a musician: which gives better partners?
    await get("insights-sabrina-artist-podcast", "/v2/insights", { "filter.type": "urn:entity:podcast", "signal.interests.entities": [SABRINA_ARTIST], take: 20 });
  }
  if (stage === "3") {
    // Partner candidates for the club and for a musician's artist entity (tuning, step 4).
    for (const [who, id, own] of [
      ["arsenal", ARSENAL, "brand"],
      ["sabrina-artist", SABRINA_ARTIST, "artist"],
    ] as const) {
      for (const c of ["artist", "movie", "tv_show", "podcast", "person", "brand", "videogame"]) {
        if (c === own) continue;
        await get(`partners-${who}-${c}`, "/v2/insights", { "filter.type": `urn:entity:${c}`, "signal.interests.entities": [id], take: 20 });
      }
    }
  }
  console.log(`\nQloo calls: ${calls}; monthly quota remaining: ${quota ?? "unknown"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
