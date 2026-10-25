/**
 * Writes tests/fixtures/qloo/ from the raw probe output in tests/fixtures/ (gitignored):
 * only the fields lib/qloo/api.ts reads, and every third heatmap cell. See docs/decisions.md D6.
 *
 *   npx tsx scripts/trim-fixtures.ts
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "tests", "fixtures");
const OUT = path.join(ROOT, "qloo");
const KEEP_PROPS = ["short_description", "image", "citizenship", "release_country", "release_year", "brand_type", "address"];

type Json = Record<string, unknown>;

const round = (n: unknown) => (typeof n === "number" ? Math.round(n * 1e4) / 1e4 : n);

function props(p: unknown): Json | undefined {
  if (!p || typeof p !== "object") return undefined;
  const out: Json = {};
  for (const k of KEEP_PROPS) if ((p as Json)[k] !== undefined) out[k] = (p as Json)[k];
  return Object.keys(out).length ? out : undefined;
}

function tags(t: unknown): Json[] | undefined {
  if (!Array.isArray(t)) return undefined;
  const kept = t
    .filter((x) => /category:place|genre:place|urn:tag:genre:music/.test(String((x as Json).id)))
    .map((x) => ({ id: (x as Json).id, name: (x as Json).name }));
  return kept.length ? kept : undefined;
}

function entity(e: Json): Json {
  const q = e.query as Json | undefined;
  const loc = e.location as Json | undefined;
  return {
    entity_id: e.entity_id,
    name: e.name,
    types: e.types,
    type: e.type,
    popularity: round(e.popularity),
    disambiguation: e.disambiguation || undefined,
    query: q ? { affinity: round(q.affinity) } : undefined,
    location: loc ? { lat: round(loc.lat), lon: round(loc.lon) } : undefined,
    properties: props(e.properties),
    tags: tags(e.tags),
  };
}

function trim(raw: Json): Json | null {
  const results = raw.results as unknown;
  if (Array.isArray(results)) return { results: results.slice(0, 10).map((e) => entity(e as Json)) };
  if (!results || typeof results !== "object") return null;
  const r = results as Json;
  if (Array.isArray(r.entities)) return { results: { entities: r.entities.map((e) => entity(e as Json)) } };
  if (Array.isArray(r.heatmap)) {
    const cells = [...r.heatmap]
      .sort((a, b) => String((a as Json).location && ((a as Json).location as Json).geohash).localeCompare(String((b as Json).location && ((b as Json).location as Json).geohash)))
      .filter((_, i) => i % 3 === 0)
      .map((c) => {
        const loc = (c as Json).location as Json;
        return { location: { latitude: round(loc.latitude), longitude: round(loc.longitude), geohash: loc.geohash }, query: { affinity: round(((c as Json).query as Json).affinity) } };
      });
    return { results: { heatmap: cells } };
  }
  if (Array.isArray(r.tags)) {
    return { results: { tags: r.tags.slice(0, 6).map((t) => ({ id: (t as Json).id, name: (t as Json).name })) } };
  }
  return null;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== OUT) out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".json") && entry.name !== "probe-summary.json") out.push(full);
  }
  return out;
}

async function main() {
  let written = 0;
  for (const file of await walk(ROOT)) {
    const trimmed = trim(JSON.parse(await readFile(file, "utf8")) as Json);
    if (!trimmed) continue;
    const target = path.join(OUT, path.relative(ROOT, file));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(trimmed));
    written++;
  }
  console.log(`Wrote ${written} trimmed fixtures to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
