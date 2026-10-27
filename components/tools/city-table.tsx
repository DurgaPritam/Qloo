"use client";

import type { CityScore } from "@/lib/engine/types";

import { GeoMap, type GeoPoint } from "../geo-map";
import { pct } from "../run/format";
import { DataTable, Num } from "../ui";

export function cityPoints(cities: readonly CityScore[], top = 1): GeoPoint[] {
  return cities.map((c, i) => ({
    id: c.city.id,
    name: c.city.name,
    lat: c.city.lat,
    lon: c.city.lon,
    value: String(pct(c.combined)),
    size: i < top ? 22 : 14,
    tone: i < top ? "acc" : "mute",
    ring: i === 0,
  }));
}

/** Cities by one audience's heat (0–100, relative to the hottest city in that country). */
export function CityTable({ cities }: { cities: readonly CityScore[] }) {
  return (
    <DataTable
      columns={["City", "Heat", "By population"]}
      template="minmax(0,1fr) 64px 104px"
      rows={cities.map((c, i) => [
        <span key="c" className="[overflow-wrap:anywhere]">
          {c.city.name}
          {c.city.admin1 && c.city.admin1 !== c.city.name ? <span className="text-mute">, {c.city.admin1}</span> : null}
        </span>,
        <Num key="h" top={i === 0}>
          {pct(c.combined)}
        </Num>,
        <Num key="p" mute>
          #{c.populationRank}
        </Num>,
      ])}
    />
  );
}

export function CityMap({ cities, label }: { cities: readonly CityScore[]; label: string }) {
  if (!cities.length) return null;
  return <GeoMap points={cityPoints(cities)} label={label} />;
}
