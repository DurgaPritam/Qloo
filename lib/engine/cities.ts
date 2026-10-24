import { ENGINE_CONFIG } from "./config";
import { distanceKm, isLatLon } from "./geo";
import { confidenceFor, isUnit } from "./shared";
import type { City, CityScore, Confidence, HeatCell } from "./types";

interface Heat {
  mean: number;
  cells: number;
}

/**
 * Scores cities for two fanbases at once. Each side's heat is the mean affinity of its cells
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
  const radiusKm = opts.radiusKm ?? ENGINE_CONFIG.cities.radiusKm;
  const eligible = cities.filter(
    (c) => c.population >= minPopulation && isLatLon(c.lat, c.lon),
  );
  const cellsA = heatA.filter(validCell);
  const cellsB = heatB.filter(validCell);

  const raw = eligible.map((city) => ({
    city,
    a: heatNear(cellsA, city, radiusKm),
    b: heatNear(cellsB, city, radiusKm),
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

function validCell(cell: HeatCell): boolean {
  return isUnit(cell.affinity) && isLatLon(cell.lat, cell.lon);
}

function heatNear(cells: readonly HeatCell[], city: City, radiusKm: number): Heat {
  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    if (distanceKm(city.lat, city.lon, cell.lat, cell.lon) <= radiusKm) {
      sum += cell.affinity;
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
