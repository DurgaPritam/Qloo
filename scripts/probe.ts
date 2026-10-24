/**
 * Probes the Qloo API with a spread of inputs and saves raw responses as test fixtures.
 *
 *   npm run probe                    # city defaults to London
 *   npm run probe -- --city "Chicago"
 *   npm run probe -- --fresh         # skip Redis, memory cache only
 *
 * Every call goes through lib/qloo/client.ts. Each input gets its own runId, so its own budget.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MemoryCache, type QlooParams } from "../lib/qloo/cache";
import { createQlooClient } from "../lib/qloo/client";
import { QlooError } from "../lib/qloo/errors";

const INPUTS = [
  { name: "comedian", query: "John Mulaney" },
  { name: "music-artist", query: "Taylor Swift" },
  { name: "film", query: "Everything Everywhere All at Once" },
  { name: "podcast", query: "Call Her Daddy" },
  { name: "sports-team", query: "Golden State Warriors" },
  { name: "misspelled", query: "Beyonse" },
  { name: "nonsense", query: "xqzvbnmlkjhg" },
  { name: "niche-act", query: "Black Country, New Road" },
] as const;

const CATEGORIES = ["artist", "movie", "tv_show", "podcast", "person", "brand", "videogame"] as const;

// Best guesses at Qloo place tag ids. The /v2/tags lookups below record the real ones.
const PLACE_TAGS = {
  venues: ["urn:tag:genre:place:music_venue"],
  bars: ["urn:tag:genre:place:bar"],
} as const;

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");

type Outcome =
  | { ok: true; file: string; ms: number; cached: boolean; count: number | null }
  | { ok: false; error: string; kind: string; status?: number };

interface CallRecord {
  input: string;
  step: string;
  endpoint: string;
  params: Record<string, string>;
  outcome: Outcome;
}

interface FieldStats {
  affinity: Set<string>;
  popularity: Set<string>;
  location: Set<string>;
  images: Set<string>;
}

function parseArgs(argv: string[]) {
  const cityIdx = argv.indexOf("--city");
  return {
    city: cityIdx >= 0 && argv[cityIdx + 1] ? argv[cityIdx + 1] : "London",
    fresh: argv.includes("--fresh"),
  };
}

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(ROOT, file));
    } catch {
      // missing file is fine
    }
  }
  const missing = ["QLOO_API_KEY", "QLOO_BASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Add them to .env.local (see .env.example).`);
    process.exit(1);
  }
}

/** Collects JSON paths (array indices collapsed to []) whose key matches each field family. */
function collectFields(value: unknown, stats: FieldStats, prefix = "") {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) collectFields(item, stats, `${prefix}[]`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const k = key.toLowerCase();
    if (k.includes("affinity")) stats.affinity.add(p);
    if (k.includes("popularity")) stats.popularity.add(p);
    if (["geohash", "lat", "lon", "lng", "latitude", "longitude"].includes(k)) stats.location.add(p);
    if (k.includes("image") || k.includes("photo") || k.includes("thumbnail")) stats.images.add(p);
    collectFields(child, stats, p);
  }
}

function countResults(data: unknown): number | null {
  const results = (data as { results?: unknown })?.results;
  if (Array.isArray(results)) return results.length;
  if (results && typeof results === "object") {
    for (const v of Object.values(results)) if (Array.isArray(v)) return v.length;
  }
  return null;
}

async function main() {
  const { city, fresh } = parseArgs(process.argv.slice(2));
  loadEnv();

  const client = createQlooClient(fresh ? { cache: new MemoryCache() } : {});
  const calls: CallRecord[] = [];
  const fields: FieldStats = {
    affinity: new Set(),
    popularity: new Set(),
    location: new Set(),
    images: new Set(),
  };

  async function call(
    input: string,
    step: string,
    endpoint: string,
    params: QlooParams,
    file: string,
  ): Promise<unknown> {
    const runId = `probe-${input}`;
    try {
      const { data, meta } = await client.get<unknown>(endpoint, params, { runId });
      const out = path.join(FIXTURES, file);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(data, null, 2)}\n`);
      collectFields(data, fields, endpoint);
      calls.push({
        input,
        step,
        endpoint,
        params: meta.params,
        outcome: { ok: true, file, ms: meta.ms, cached: meta.cached, count: countResults(data) },
      });
      return data;
    } catch (err) {
      const q = err instanceof QlooError ? err : undefined;
      calls.push({
        input,
        step,
        endpoint,
        params: q?.params ?? {},
        outcome: {
          ok: false,
          kind: q?.kind ?? "error",
          status: q?.status,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return undefined;
    }
  }

  const typesByInput: Record<string, { top: string | null; searchTypes: string[]; nonEmpty: string[] }> = {};

  for (const tagQuery of ["music venue", "bar"]) {
    await call("tags", `tags:${tagQuery}`, "/v2/tags", { "filter.query": tagQuery, take: 20 },
      `tags/${tagQuery.replace(/\s+/g, "-")}.json`);
  }

  for (const { name, query } of INPUTS) {
    console.log(`→ ${name}: "${query}"`);
    const search = (await call(name, "search", "/search", { query }, `search/${name}.json`)) as
      | { results?: Array<{ entity_id?: string; name?: string; types?: string[] }> }
      | undefined;

    const results = search?.results ?? [];
    const top = results[0];
    typesByInput[name] = {
      top: top ? `${top.name} (${top.entity_id})` : null,
      searchTypes: [...new Set(results.flatMap((r) => r.types ?? []))],
      nonEmpty: [],
    };
    if (!top?.entity_id) continue;

    const id = top.entity_id;
    const own = new Set(top.types ?? []);
    for (const category of CATEGORIES) {
      const type = `urn:entity:${category}`;
      if (own.has(type)) continue;
      const data = await call(name, `insights:${category}`, "/v2/insights",
        { "filter.type": type, "signal.interests.entities": [id], take: 20 },
        `insights/${name}/${category}.json`);
      if ((countResults(data) ?? 0) > 0) typesByInput[name].nonEmpty.push(category);
    }

    await call(name, "heatmap", "/v2/insights",
      { "filter.type": "urn:heatmap", "signal.interests.entities": [id] },
      `heatmap/${name}.json`);

    for (const [label, tags] of Object.entries(PLACE_TAGS)) {
      await call(name, `places:${label}`, "/v2/insights",
        {
          "filter.type": "urn:entity:place",
          "signal.interests.entities": [id],
          "filter.location.query": city,
          "filter.tags": tags,
          take: 20,
        },
        `places/${name}/${label}.json`);
    }

    await call(name, "brands", "/v2/insights",
      {
        "filter.type": "urn:entity:brand",
        "signal.interests.entities": [id],
        "signal.location.query": city,
        take: 20,
      },
      `places/${name}/brands.json`);
  }

  const failures = calls.filter((c) => !c.outcome.ok);
  const summary = {
    probedAt: new Date().toISOString(),
    city,
    typesByInput,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [...v].sort()])),
    calls,
  };
  await mkdir(FIXTURES, { recursive: true });
  await writeFile(path.join(FIXTURES, "probe-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\n=== Entity types per input (city: ${city}) ===`);
  for (const [name, t] of Object.entries(typesByInput)) {
    console.log(`${name.padEnd(13)} top: ${t.top ?? "(no results)"}`);
    console.log(`${"".padEnd(13)} search types: ${t.searchTypes.join(", ") || "-"}`);
    console.log(`${"".padEnd(13)} non-empty insights: ${t.nonEmpty.join(", ") || "-"}`);
  }

  console.log("\n=== Fields ===");
  for (const [family, paths] of Object.entries(summary.fields)) {
    console.log(`${family}:`);
    for (const p of paths.length ? paths : ["(none found)"]) console.log(`  ${p}`);
  }

  console.log(`\n=== Calls: ${calls.length - failures.length} ok, ${failures.length} failed ===`);
  for (const c of failures) {
    if (c.outcome.ok) continue;
    const status = c.outcome.status ? ` ${c.outcome.status}` : "";
    console.log(`✗ ${c.input} ${c.step} [${c.outcome.kind}${status}] ${c.outcome.error}`);
  }
  console.log(`\nFixtures in tests/fixtures, summary in tests/fixtures/probe-summary.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
