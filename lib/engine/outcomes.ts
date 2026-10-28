import { ENGINE_CONFIG } from "./config";
import type { Confidence } from "./types";

/**
 * Outcomes: what a workspace logged after its events (its own data, rule 2) next to what the plan
 * predicted when it was made. Nothing here changes a Qloo score.
 */

/** Tickets sold ÷ capacity, only when both were entered and capacity is positive. */
export function sellThrough(sold: number | null | undefined, capacity: number | null | undefined): number | null {
  if (typeof sold !== "number" || typeof capacity !== "number" || !Number.isFinite(sold) || !Number.isFinite(capacity)) return null;
  if (capacity <= 0 || sold < 0) return null;
  return sold / capacity;
}

export function median(values: readonly number[]): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** A plan's predictions as they were when it was made (lib/outcomes/predict.ts freezes them). */
export interface Prediction {
  city: { id: string; name: string; rank: number; of: number; combined: number; confidence: Confidence } | null;
  partner: { id: string; name: string; category: string; rank: number; score: number; confidence: Confidence } | null;
  venue: { name: string; confidence: Confidence } | null;
  sponsors: { name: string; rank: number; score: number }[];
  market: string | null;
}

export interface LoggedEvent {
  planId: string;
  prediction: Prediction;
  sellThrough: number | null;
}

export interface GroupResult {
  /** The city or partner. */
  id: string;
  name: string;
  /** Logged events with a sell-through for this city or partner. */
  events: number;
  /** Of those, how many sold through above the workspace's median. */
  above: number;
  /** False below the minimum sample: the report then says "too few events to judge". */
  judged: boolean;
}

export interface OutcomeReport {
  /** Logged plans with both tickets sold and capacity. */
  sample: number;
  /** The workspace's own median sell-through over those plans. */
  median: number | null;
  minSample: number;
  /** Enough events overall to compare anything with the median. */
  judged: boolean;
  /** How often plans performed above the median, by the chosen city and by the chosen partner. */
  cities: GroupResult[];
  partners: GroupResult[];
  /** Plans above the median, of the sample. */
  aboveMedian: number;
}

function groupBy(events: readonly LoggedEvent[], key: (e: LoggedEvent) => { id: string; name: string } | null, med: number, minSample: number): GroupResult[] {
  const groups = new Map<string, GroupResult>();
  for (const e of events) {
    const k = key(e);
    if (!k || e.sellThrough === null) continue;
    const g = groups.get(k.id) ?? { id: k.id, name: k.name, events: 0, above: 0, judged: false };
    g.events++;
    if (e.sellThrough > med) g.above++;
    groups.set(k.id, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, judged: g.events >= minSample }))
    .sort((a, b) => b.events - a.events || b.above - a.above || a.name.localeCompare(b.name));
}

/**
 * Across a workspace's logged plans: the median sell-through, and for each chosen city and
 * partner how many of its events sold through above that median. "Above" is strict, so an event at
 * the median is not counted as above. Below `minSample` events nothing is judged.
 */
export function outcomeReport(events: readonly LoggedEvent[], minSample: number = ENGINE_CONFIG.outcomes.minSample): OutcomeReport {
  const withSell = events.filter((e) => e.sellThrough !== null);
  const med = median(withSell.map((e) => e.sellThrough!));
  const judged = med !== null && withSell.length >= minSample;
  return {
    sample: withSell.length,
    median: med,
    minSample,
    judged,
    cities: med === null ? [] : groupBy(withSell, (e) => e.prediction.city, med, minSample),
    partners: med === null ? [] : groupBy(withSell, (e) => e.prediction.partner, med, minSample),
    aboveMedian: med === null ? 0 : withSell.filter((e) => e.sellThrough! > med).length,
  };
}
