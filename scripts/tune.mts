/**
 * Offline tuning on raw probe fixtures (no Qloo calls): runs the partner engine for each seed and
 * prints the picks and the most popular candidates. Used for docs/tuning.md.
 *
 *   npx tsx scripts/tune.mts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { scorePartners } from "@/lib/engine/partners";
import type { Candidate, Category } from "@/lib/engine/types";
import { compact, toCandidate, type RawEntity } from "@/lib/qloo/map";

const F = path.resolve(import.meta.dirname, "..", "tests", "fixtures");

export const SEEDS: Record<string, { label: string; files: string[] }> = {
  comedian: { label: "John Mulaney", files: dir("insights/comedian") },
  "music-artist": { label: "Sabrina Carpenter (artist)", files: glob("extra", "partners-sabrina-artist-") },
  film: { label: "Sinners", files: dir("insights/film") },
  podcast: { label: "Call Her Daddy", files: dir("insights/podcast") },
  club: { label: "Arsenal F.C.", files: glob("extra", "partners-arsenal-") },
  misspelled: { label: "Billie Eilish (person)", files: dir("insights/misspelled") },
  niche: { label: "Black Country, New Road", files: dir("insights/niche-act") },
};

function dir(rel: string) {
  return readdirSync(path.join(F, rel)).map((f) => path.join(rel, f));
}
function glob(rel: string, prefix: string) {
  return readdirSync(path.join(F, rel)).filter((f) => f.startsWith(prefix)).map((f) => path.join(rel, f));
}

export function candidatesFor(seed: string): Candidate[] {
  return SEEDS[seed].files.flatMap((rel) => {
    const category = path.basename(rel, ".json").split("-").at(-1)!.replace("show", "_show").replace("tv__show", "tv_show") as Category;
    const cat = (category.endsWith("tv_show") ? "tv_show" : category) as Category;
    const raw = JSON.parse(readFileSync(path.join(F, rel), "utf8")) as { results?: { entities?: RawEntity[] } };
    return compact((raw.results?.entities ?? []).map((e) => toCandidate(e, cat)));
  });
}

const f2 = (x: number) => x.toFixed(3);

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  for (const seed of Object.keys(SEEDS)) {
    const cands = candidatesFor(seed);
    const res = scorePartners(cands);
    console.log(`\n### ${SEEDS[seed].label} (${cands.length} candidates)`);
    console.log(`  picks: ${res.picks.map((p) => `${p.entity.name} [${p.entity.category}] a${f2(p.entity.affinity)} p${f2(p.entity.popularity)}`).join(" | ") || "-"}`);
    console.log(`  fallback=${res.fallback} · ${res.reason}`);
    const famous = [...cands].sort((a, b) => b.popularity - a.popularity).slice(0, 6);
    console.log(`  most popular: ${famous.map((c) => `${c.name} [${c.category}] p${c.popularity.toFixed(4)}`).join(" | ")}`);
  }
}

// ---- Sponsors and cities (run with: npx tsx scripts/tune.mts more) ----
import { scoreCities } from "@/lib/engine/cities";
import { CITIES } from "@/lib/engine/data";
import { metroCities } from "@/lib/engine/metro";
import { rankBrands } from "@/lib/engine/places";
import { compact as compactAll, toBrand, toHeatCell, type RawHeatCell } from "@/lib/qloo/map";

const load = (rel: string) => JSON.parse(readFileSync(path.join(F, rel), "utf8"));

export function sponsorsFor(rel: string) {
  return compactAll(((load(rel).results?.entities ?? []) as RawEntity[]).map(toBrand));
}

export function heatFor(rel: string) {
  return compactAll(((load(rel).results?.heatmap ?? []) as RawHeatCell[]).map(toHeatCell));
}

export function citiesFor(a: string, b: string, country: string, minPopulation: number) {
  const pool = metroCities(CITIES).filter((c) => c.country === country);
  const first = scoreCities(heatFor(a), heatFor(b), pool, minPopulation);
  const overlap = first.filter((s) => s.combined > 0).map((s) => s.city);
  return scoreCities(heatFor(a), heatFor(b), overlap.length ? overlap : pool, minPopulation);
}

if (process.argv[2] === "more") {
  console.log("\n===== Sponsors =====");
  for (const rel of ["extra/brands-chicago-two-signals.json", ...readdirSync(path.join(F, "places")).map((d) => `places/${d}/brands.json`)]) {
    const brands = sponsorsFor(rel);
    if (!brands.length) continue;
    const r = rankBrands(brands);
    console.log(`${rel}: ${r.picks.map((p) => `${p.brand.name} p${p.brand.popularity.toFixed(4)} [${p.confidence}]`).join(" | ") || "-"} · ${r.reason}`);
  }
  console.log("\n===== Cities =====");
  for (const [label, a, b, cc] of [
    ["Mulaney × Oh, Hello (US)", "extra/heatmap-mulaney-us.json", "extra/heatmap-ohhello-us.json", "US"],
    ["Mulaney alone (US)", "extra/heatmap-mulaney-us.json", "extra/heatmap-mulaney-us.json", "US"],
    ["Arsenal alone (GB)", "extra/heatmap-arsenal-gb.json", "extra/heatmap-arsenal-gb.json", "GB"],
  ] as const) {
    for (const minPop of [150_000, 250_000, 300_000]) {
      const s = citiesFor(a, b, cc, minPop);
      const top = s.slice(0, 5);
      const differs = top.filter((x) => x.rank !== x.populationRank).length;
      console.log(`${label} min ${minPop / 1000}k (${s.length} cities): ${top.map((x) => `${x.city.name} ${(x.combined * 100).toFixed(0)} pop#${x.populationRank} cells ${x.evidence.cellsA}/${x.evidence.cellsB}`).join(" | ")} · rank≠pop in ${differs}/5`);
    }
  }
}
