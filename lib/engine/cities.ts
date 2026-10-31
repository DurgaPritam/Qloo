import { ENGINE_CONFIG } from "./config";
import { distanceKm, isLatLon } from "./geo";
import { confidenceFor, isUnit } from "./shared";
import type { City, CityScore, Confidence, HeatCell } from "./types";

export interface Heat {
  mean: number;
  cells: number;
}

/**
 * Scores cities for two fanbases at once. Each side's heat is the mean affinity × popularity of its cells
 * within `radiusKm` of the city centre (config default; wider for regional overlap),
 * normalised 0–1 against the hottest scored city.
 * combined = sqrt(sA * sB), so a city only wins if it is warm for both sides, and the result
 * is symmetric in A and B. Sorted best first.
 */
export function scoreCities(
  heatA: readonly HeatCell[],
  heatB: readonly HeatCell[],
  cities: readonly City[],
  minPopulation: number,
  opts: { radiusKm?: number } = {},
): CityScore[] {
  const eligible = eligibleCities(cities, minPopulation);
  return scoreCityHeat(cityHeat(heatA, eligible, opts), cityHeat(heatB, eligible, opts), cities, minPopulation);
}

/** Each city's heat (by city id) for one fanbase: the first half of scoreCities, kept so it can be stored. */
export function cityHeat(cells: readonly HeatCell[], cities: readonly City[], opts: { radiusKm?: number } = {}): Map<string, Heat> {
  const radiusKm = opts.radiusKm ?? ENGINE_CONFIG.cities.radiusKm;
  const valid = cells.filter(validCell);
  return new Map(cities.filter((c) => isLatLon(c.lat, c.lon)).map((city) => [city.id, heatNear(valid, city, radiusKm)]));
}

/** The second half of scoreCities, from per-city heat. A city missing from a map has no heat for that side. */
export function scoreCityHeat(
  heatA: ReadonlyMap<string, Heat>,
  heatB: ReadonlyMap<string, Heat>,
  cities: readonly City[],
  minPopulation: number,
): CityScore[] {
  const eligible = eligibleCities(cities, minPopulation);
  const none: Heat = { mean: 0, cells: 0 };
  const raw = eligible.map((city) => ({
    city,
    a: heatA.get(city.id) ?? none,
    b: heatB.get(city.id) ?? none,
  }));
  const maxA = Math.max(0, ...raw.map((r) => r.a.mean));
  const maxB = Math.max(0, ...raw.map((r) => r.b.mean));

  const populationRank = new Map(
    [...eligible]
      .sort((x, y) => y.population - x.population || x.id.localeCompare(y.id))
      .map((c, i) => [c.id, i + 1]),
  );

  const scored = raw.map(({ city, a, b }) => {
    const sA = maxA > 0 ? a.mean / maxA : 0;
    const sB = maxB > 0 ? b.mean / maxB : 0;
    const combined = Math.sqrt(sA * sB);
    return {
      kind: "city" as const,
      city,
      sA,
      sB,
      combined,
      rank: 0,
      populationRank: populationRank.get(city.id) ?? 0,
      confidence: cityConfidence(sA, sB, a.cells, b.cells),
      evidence: { cellsA: a.cells, cellsB: b.cells },
    };
  });

  return scored
    .sort(
      (x, y) =>
        y.combined - x.combined ||
        x.populationRank - y.populationRank ||
        x.city.id.localeCompare(y.city.id),
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function eligibleCities(cities: readonly City[], minPopulation: number): City[] {
  return cities.filter((c) => c.population >= minPopulation && isLatLon(c.lat, c.lon));
}

function validCell(cell: HeatCell): boolean {
  return isUnit(cell.affinity) && isLatLon(cell.lat, cell.lon);
}

function heatNear(cells: readonly HeatCell[], city: City, radiusKm: number): Heat {
  let sum = 0;
  let count = 0;
  // Cheap degree box first: real heatmaps have ~10,000 cells per side.
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos((city.lat * Math.PI) / 180)));
  for (const cell of cells) {
    if (Math.abs(cell.lat - city.lat) > dLat || Math.abs(cell.lon - city.lon) > dLon) continue;
    if (distanceKm(city.lat, city.lon, cell.lat, cell.lon) <= radiusKm) {
      // Over-indexing weighted by presence, so a handful of small-town cells cannot win alone.
      sum += cell.affinity * (isUnit(cell.popularity) ? cell.popularity : 1);
      count++;
    }
  }
  return { mean: count ? sum / count : 0, cells: count };
}

function cityConfidence(sA: number, sB: number, cellsA: number, cellsB: number): Confidence {
  const base = confidenceFor(Math.min(sA, sB));
  if (base === "high" && Math.min(cellsA, cellsB) < ENGINE_CONFIG.cities.minCellsForHigh) {
    return "medium";
  }
  return base;
}
