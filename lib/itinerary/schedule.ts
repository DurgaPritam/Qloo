import { distanceKm } from "@/lib/engine/geo";

import type { Itinerary, StopCity } from "./types";

/**
 * The draft schedule: plain date arithmetic from the user's own start date and pace, never from
 * the model and never a claim about availability. Each stop plays `shows` days in a row, then
 * `restAfter` rest days; a leg within one day's drive (kmPerTravelDay) is played the next day, a
 * longer one adds ceil(km ÷ pace) − 1 travel days. A date the user typed on a stop pins it, and
 * later drafted dates flow from it. A pinned date that leaves less time than the drive needs, or
 * that is not after the previous stop, is flagged, never moved.
 */

export type DayKind = "show" | "travel" | "rest" | "off";

export interface ScheduleDay {
  /** "YYYY-MM-DD", or null while nothing before it is dated. */
  date: string | null;
  /** 1-based day of the tour, counting from the first show. Null after an undatable gap. */
  dayNumber: number | null;
  kind: DayKind;
  /** The stop this day belongs to: the stop played (show), left behind (rest) or driven to (travel, off). */
  stopIndex: number;
  /** "user" for a pinned show date, "draft" for every computed one. */
  source: "user" | "draft";
  /** The show's number at the stop, from 1. */
  show?: number;
  /** Set on travel days: the leg driven. */
  from?: string;
  to?: string;
}

export interface StopSchedule {
  /** First and last show dates; null while undated. */
  first: string | null;
  last: string | null;
  source: "user" | "draft" | null;
  /** From the previous stop, km, straight-line between city centres, rounded. 0 for the first. */
  legKm: number;
  /** Extra travel days the leg needs at the user's pace. */
  travelDays: number;
}

export interface ScheduleWarning {
  stopIndex: number;
  kind: "tight" | "order" | "before_start";
  text: string;
}

export interface Schedule {
  stops: StopSchedule[];
  days: ScheduleDay[];
  warnings: ScheduleWarning[];
  totalKm: number;
  /** Days from the first show to the last, inclusive, when dated; else the count of listed days. */
  totalDays: number;
  showDays: number;
}

export const DRAFT_LABEL = "Draft · to confirm with the promoter";

export const legKm = (a: Pick<StopCity, "lat" | "lon">, b: Pick<StopCity, "lat" | "lon">) => Math.round(distanceKm(a.lat, a.lon, b.lat, b.lon));

/** Extra travel days a leg needs: none within one day's drive. */
export function travelDaysFor(km: number, pace: number): number {
  if (km <= pace || pace <= 0) return 0;
  return Math.ceil(km / pace) - 1;
}

const DAY = 86_400_000;
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function computeSchedule(it: Pick<Itinerary, "startDate" | "kmPerTravelDay" | "stops">): Schedule {
  const stops: StopSchedule[] = [];
  const days: ScheduleDay[] = [];
  const warnings: ScheduleWarning[] = [];
  let totalKm = 0;
  /** The previous stop's last show date (null while undated) and its day number. */
  let prevLast: string | null = null;
  let prevDay: number | null = null;

  it.stops.forEach((s, i) => {
    const prev = it.stops[i - 1];
    const km = prev ? legKm(prev.city, s.city) : 0;
    totalKm += km;
    const travel = prev ? travelDaysFor(km, it.kmPerTravelDay) : 0;
    const rest = prev ? prev.restAfter : 0;
    const gap = prev ? rest + travel : 0;
    /** Where the first show falls when nothing is pinned. */
    const earliest = i === 0 ? it.startDate || null : prevLast ? addDays(prevLast, gap + 1) : null;
    const pinned = s.date || null;
    const first = pinned ?? earliest;
    const source: StopSchedule["source"] = pinned ? "user" : first ? "draft" : null;

    if (pinned && i === 0 && it.startDate && pinned < it.startDate) {
      warnings.push({ stopIndex: i, kind: "before_start", text: `${s.city.name} is set for ${pinned}, before your start date ${it.startDate}.` });
    }
    // Days between the previous stop and this one: rest, then travel, then open days before a later pin.
    let available = gap;
    let firstDay: number | null = i === 0 ? 1 : prevDay === null ? null : prevDay + gap + 1;
    if (pinned && prevLast) {
      const between = daysBetween(prevLast, pinned) - 1;
      firstDay = prevDay === null ? null : prevDay + Math.max(0, between) + 1;
      if (between < 0) {
        warnings.push({ stopIndex: i, kind: "order", text: `${s.city.name} (${pinned}) is not after ${prev!.city.name} (${prevLast}). Dates are out of order.` });
        available = 0;
      } else {
        if (between < gap) {
          const need = [rest ? `${rest} rest day${rest === 1 ? "" : "s"}` : "", travel ? `${travel} travel day${travel === 1 ? "" : "s"} for ${km.toLocaleString("en-GB")} km` : ""].filter(Boolean).join(" and ");
          warnings.push({ stopIndex: i, kind: "tight", text: `${s.city.name} on ${pinned} leaves ${between} day${between === 1 ? "" : "s"} after ${prev!.city.name}; the plan needs ${need}.` });
        }
        available = between;
      }
    }
    if (prev) {
      const fill: DayKind[] = [...Array<DayKind>(rest).fill("rest"), ...Array<DayKind>(travel).fill("travel")].slice(0, available);
      while (fill.length < available) fill.push("off");
      fill.forEach((kind, k) => {
        days.push({
          date: prevLast ? addDays(prevLast, k + 1) : null,
          dayNumber: prevDay === null ? null : prevDay + k + 1,
          kind,
          // Rest days belong to the stop just played; travel and open days to the one ahead.
          stopIndex: kind === "rest" ? i - 1 : i,
          source: "draft",
          ...(kind === "travel" ? { from: prev.city.name, to: s.city.name } : {}),
        });
      });
    }
    for (let n = 0; n < s.shows; n++) {
      days.push({ date: first ? addDays(first, n) : null, dayNumber: firstDay === null ? null : firstDay + n, kind: "show", stopIndex: i, source: n === 0 && pinned ? "user" : "draft", show: n + 1 });
    }
    const last = first ? addDays(first, s.shows - 1) : null;
    stops.push({ first, last, source, legKm: km, travelDays: travel });
    prevLast = last;
    prevDay = firstDay === null ? null : firstDay + s.shows - 1;
  });

  const dated = days.filter((d) => d.date).map((d) => d.date!);
  const totalDays = dated.length === days.length && dated.length ? daysBetween(dated.reduce((a, b) => (a < b ? a : b)), dated.reduce((a, b) => (a > b ? a : b))) + 1 : days.length;
  return { stops, days, warnings, totalKm, totalDays, showDays: days.filter((d) => d.kind === "show").length };
}
