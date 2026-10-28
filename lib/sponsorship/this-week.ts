import type { SnapshotEntry } from "@/lib/engine/watch";
import { listLabel } from "@/lib/watch/wording";

/**
 * "This week" evidence for a sponsor match, from the workspace's Market watch: alerts from the
 * last week about the rights holder or the brand, and where the brand ranks in a watched city's
 * latest snapshot. Every line is a stored alert title or a snapshot reading; no Qloo call, and no
 * trend is claimed from one snapshot (a rank from one reading is stated as a rank, not a move).
 */
export interface WatchLine {
  text: string;
  /** When the snapshot behind it was taken (ISO). */
  at: string;
  kind: "alert" | "reading";
}

export interface WatchContext {
  alerts: { title: string; entityId: string; itemTarget: string; createdAt: Date }[];
  /** Each watched city's latest snapshot. */
  cities: { name: string; takenAt: Date; lists: Record<string, SnapshotEntry[]> }[];
}

export const THIS_WEEK_DAYS = 8;
const MAX_LINES = 3;

export function thisWeekLines(ctx: WatchContext, holder: { ids: readonly string[] }, brand: { id: string; name: string }, now: Date): WatchLine[] {
  const since = now.getTime() - THIS_WEEK_DAYS * 86_400_000;
  const about = new Set([...holder.ids, brand.id]);
  const alertLines: WatchLine[] = ctx.alerts
    .filter((a) => a.createdAt.getTime() >= since && (about.has(a.entityId) || about.has(a.itemTarget)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => ({ text: a.title, at: a.createdAt.toISOString(), kind: "alert" }));
  const readings: WatchLine[] = ctx.cities
    .filter((c) => c.takenAt.getTime() >= since)
    .flatMap((c) =>
      Object.entries(c.lists).flatMap(([list, entries]) => {
        const e = entries.find((x) => x.id === brand.id);
        return e ? [{ text: `${brand.name} is #${e.rank} in the ${listLabel(list)} in ${c.name} (Market watch, latest reading).`, at: c.takenAt.toISOString(), kind: "reading" as const }] : [];
      }),
    );
  const seen = new Set<string>();
  return [...alertLines, ...readings].filter((l) => !seen.has(l.text) && seen.add(l.text)).slice(0, MAX_LINES);
}
