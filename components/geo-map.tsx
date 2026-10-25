"use client";

/**
 * The real map behind the design's DotMap ("swap in a real map"): Natural Earth country outlines
 * (world-atlas, served from /geo) drawn in design tokens, fitted to the cities shown. Dots and
 * labels keep DotMap's look and sit in HTML on top so text stays legible at any width.
 */
import { geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, MultiLineString, MultiPoint } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

import { cx } from "./ui";

export interface GeoPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Shown after the name, e.g. the 0–100 score. */
  value: string;
  size: number;
  tone: "acc" | "mute" | "line";
  ring?: boolean;
}

const W = 1000;
const H = 625; // 16:10, the design's map aspect
const PAD = 70;
/** Never zoom in further than this many degrees, so one-country results keep context. */
const MIN_SPAN = { lon: 22, lat: 12 };

interface Atlas {
  land: FeatureCollection | Feature;
  borders: MultiLineString;
}

let atlas: Promise<Atlas> | null = null;
function loadAtlas(): Promise<Atlas> {
  atlas ??= fetch("/geo/countries-50m.json")
    .then((r) => r.json() as Promise<Topology<{ countries: GeometryCollection; land: GeometryCollection }>>)
    .then((topo) => ({
      land: feature(topo, topo.objects.land),
      borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
    }));
  return atlas;
}

function fit(points: { lat: number; lon: number }[]): GeoProjection {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const halfLon = Math.max(MIN_SPAN.lon, Math.max(...lons) - Math.min(...lons)) / 2;
  const halfLat = Math.max(MIN_SPAN.lat, Math.max(...lats) - Math.min(...lats)) / 2;
  const frame: MultiPoint = {
    type: "MultiPoint",
    coordinates: [
      [cLon - halfLon, cLat - halfLat],
      [cLon + halfLon, cLat + halfLat],
      [cLon - halfLon, cLat + halfLat],
      [cLon + halfLon, cLat - halfLat],
    ],
  };
  return geoNaturalEarth1().fitExtent(
    [
      [PAD, PAD],
      [W - PAD, H - PAD],
    ],
    frame,
  );
}

const LABEL_CHAR_PX = 6.6; // JetBrains Mono at 10.5px
const LABEL_H = 15;

/** Greedy placement: best points first, below then above then right; hide what still collides. */
function placeLabels(placed: Array<GeoPoint & { x: number; y: number }>, widthPx: number) {
  const scale = widthPx / W;
  const heightPx = H * scale;
  // Every dot is an obstacle from the start, so no label covers a dot placed after it.
  const dots: Array<[number, number, number, number]> = placed.map((p) => {
    const r = p.size / 2 + 2;
    return [p.x * scale - r, p.y * scale - r, p.x * scale + r, p.y * scale + r];
  });
  const boxes: Array<[number, number, number, number]> = [];
  const hit = (b: [number, number, number, number]) =>
    [...boxes, ...dots].some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  return placed.map((p) => {
    const cx = p.x * scale;
    const cy = p.y * scale;
    const w = `${p.name} ${p.value}`.length * LABEL_CHAR_PX;
    const r = p.size / 2 + 3;
    const options: Array<{ pos: "below" | "above" | "right"; box: [number, number, number, number] }> = [
      { pos: "below", box: [cx - w / 2, cy + r, cx + w / 2, cy + r + LABEL_H] },
      { pos: "above", box: [cx - w / 2, cy - r - LABEL_H, cx + w / 2, cy - r] },
      { pos: "right", box: [cx + r, cy - LABEL_H / 2, cx + r + w, cy + LABEL_H / 2] },
    ];
    const inside = (b: [number, number, number, number]) => b[0] >= 0 && b[2] <= widthPx && b[1] >= 0 && b[3] <= heightPx;
    const free = options.find((o) => inside(o.box) && !hit(o.box));
    if (free) boxes.push(free.box);
    return free?.pos ?? null;
  });
}

export function GeoMap({
  points,
  route,
  label,
  aspect = "aspect-[16/10]",
}: {
  points: GeoPoint[];
  /** Drawn as a dashed line through these points, in order. */
  route?: { lat: number; lon: number }[];
  label: string;
  aspect?: string;
}) {
  const [geo, setGeo] = useState<Atlas | null>(null);
  const [width, setWidth] = useState(W / 2);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadAtlas()
      .then((a) => live && setGeo(a))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => fit([...points, ...(route ?? [])]), [points, route]);
  const paths = useMemo(() => {
    if (!geo) return null;
    const path = geoPath(projection);
    return { land: path(geo.land) ?? "", borders: path(geo.borders) ?? "" };
  }, [geo, projection]);

  const placed = useMemo(
    () =>
      points.flatMap((p) => {
        const xy = projection([p.lon, p.lat]);
        return xy ? [{ ...p, x: xy[0], y: xy[1] }] : [];
      }),
    [points, projection],
  );
  const labels = useMemo(() => placeLabels(placed, width), [placed, width]);
  const routeLine = useMemo(() => {
    const xy = (route ?? []).map((p) => projection([p.lon, p.lat])).filter((p): p is [number, number] => Boolean(p));
    return xy.length > 1 ? `M${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}` : null;
  }, [route, projection]);

  return (
    <div ref={box} className={cx("relative overflow-hidden rounded-md bg-track", aspect)} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
        {paths && (
          <>
            <path d={paths.land} fill="var(--line)" fillOpacity={0.5} />
            <path d={paths.borders} fill="none" stroke="var(--track)" strokeWidth={1} />
          </>
        )}
        {routeLine && (
          <path d={routeLine} fill="none" stroke="var(--acc-line)" strokeWidth={2.5} strokeDasharray="7 6" strokeLinejoin="round" />
        )}
      </svg>
      {placed.map((p) => (
        <div
          key={p.id}
          className={cx(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-pill transition-colors",
            { acc: "bg-acc-line", mute: "bg-mute", line: "bg-line" }[p.tone],
            p.ring && "shadow-[0_0_0_4px_var(--acc-soft)]",
          )}
          style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: p.size, height: p.size }}
          title={`${p.name} ${p.value}`}
        />
      ))}
      {placed.map((p, i) =>
        labels[i] ? (
          <div
            key={`${p.id}-label`}
            className="pointer-events-none absolute"
            style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
          >
            <span
              className={cx(
                "tabular absolute whitespace-nowrap font-mono text-label text-ink [text-shadow:0_0_3px_var(--track),0_0_3px_var(--track)]",
                labels[i] === "below" && "left-0 -translate-x-1/2",
                labels[i] === "above" && "left-0 -translate-x-1/2 -translate-y-full",
                labels[i] === "right" && "top-0 -translate-y-1/2",
              )}
              style={
                labels[i] === "below"
                  ? { top: p.size / 2 + 3 }
                  : labels[i] === "above"
                    ? { top: -(p.size / 2 + 3) }
                    : { left: p.size / 2 + 4 }
              }
            >
              {p.name} {p.value}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}
