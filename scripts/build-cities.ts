/**
 * Regenerates lib/engine/data/cities.json from GeoNames cities15000 (CC BY 4.0).
 *
 *   npx tsx scripts/build-cities.ts
 *
 * Keeps populated places with population >= 100,000, dropping city sections and historical or
 * abandoned places. Data © GeoNames, https://www.geonames.org/, licensed under
 * https://creativecommons.org/licenses/by/4.0/
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { unzipSync, strFromU8 } from "fflate";

const DUMP = "https://download.geonames.org/export/dump";
const MIN_POPULATION = 100_000;
// PPLX: section of a populated place; PPLH: historical; PPLQ: abandoned; PPLW: destroyed.
const EXCLUDED_CODES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW"]);
const OUT = path.resolve(import.meta.dirname, "..", "lib", "engine", "data", "cities.json");

interface CityRow {
  id: string;
  name: string;
  country: string;
  admin1: string;
  lat: number;
  lon: number;
  population: number;
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function parseAdmin1(text: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [code, name] = line.split("\t");
    if (code && name) names.set(code, name);
  }
  return names;
}

function parseCities(text: string, admin1: Map<string, string>): CityRow[] {
  const rows: CityRow[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 19) continue;
    const population = Number(f[14]);
    if (population < MIN_POPULATION || f[6] !== "P" || EXCLUDED_CODES.has(f[7])) continue;
    rows.push({
      id: f[0],
      name: f[1],
      country: f[8],
      admin1: admin1.get(`${f[8]}.${f[10]}`) ?? "",
      lat: Number(Number(f[4]).toFixed(4)),
      lon: Number(Number(f[5]).toFixed(4)),
      population,
    });
  }
  return rows.sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
}

async function main() {
  console.log("Downloading GeoNames cities15000 and admin1 codes…");
  const [zip, admin1Bytes] = await Promise.all([
    download(`${DUMP}/cities15000.zip`),
    download(`${DUMP}/admin1CodesASCII.txt`),
  ]);
  const txt = unzipSync(zip)["cities15000.txt"];
  if (!txt) throw new Error("cities15000.txt not found in the zip");

  const cities = parseCities(strFromU8(txt), parseAdmin1(strFromU8(admin1Bytes)));
  await mkdir(path.dirname(OUT), { recursive: true });
  // One city per line keeps diffs readable when GeoNames updates.
  await writeFile(OUT, `[\n${cities.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`);
  console.log(`Wrote ${cities.length} cities to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
