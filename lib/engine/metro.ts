import { ENGINE_CONFIG } from "./config";
import { distanceKm } from "./geo";
import type { City } from "./types";

/**
 * Folds each city into any larger city within `mergeKm`, so boroughs and suburbs (Brooklyn,
 * Islington, Salford) do not crowd the ranking next to the city they belong to.
 */
export function metroCities(
  cities: readonly City[],
  mergeKm: number = ENGINE_CONFIG.cities.metroMergeKm,
): City[] {
  const kept: City[] = [];
  const byPopulation = [...cities].sort(
    (a, b) => b.population - a.population || a.id.localeCompare(b.id),
  );
  for (const city of byPopulation) {
    const absorbed = kept.some((k) => distanceKm(k.lat, k.lon, city.lat, city.lon) <= mergeKm);
    if (!absorbed) kept.push(city);
  }
  return kept;
}

/** The nearest cities to `from`, closest first, with distances computed here, never by the model. */
export function nearestCities(
  from: City,
  cities: readonly City[],
  count: number,
): Array<{ city: City; distanceKm: number }> {
  return cities
    .filter((c) => c.id !== from.id)
    .map((city) => ({ city, distanceKm: distanceKm(from.lat, from.lon, city.lat, city.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.city.id.localeCompare(b.city.id))
    .slice(0, count);
}
