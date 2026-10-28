import { ENGINE_CONFIG } from "./config";
import type { Category } from "./types";

/**
 * Market watch diffs. A snapshot holds ranked top lists (a fanbase's cities and partners, or a
 * city's top entities per category), exactly as Qloo and the engine ranked them that week.
 */
export interface SnapshotEntry {
  id: string;
  name: string;
  /** 1-based. */
  rank: number;
  /** 0–1: Qloo affinity, or city heat scaled to the hottest city. */
  value: number;
  category?: Category;
}

export interface Snapshot {
  /** List key ("cities", "partners", "category:podcast") → entries, best first. */
  lists: Record<string, SnapshotEntry[]>;
}

export type ChangeKind = "new" | "rank_up" | "rank_down" | "value_up" | "value_down";

export interface WatchChange {
  list: string;
  entityId: string;
  name: string;
  category?: Category;
  kind: ChangeKind;
  /** The previous snapshot's values; null for a new entry. */
  before: { rank: number; value: number } | null;
  after: { rank: number; value: number };
}

type WatchConfig = typeof ENGINE_CONFIG.watch;

/**
 * Changes between two snapshots of the same item, by the thresholds in config: an entry new to a
 * top list, a move of `rankMove` places or more, or a value change of `valueChange` or more. One
 * change per entry (a rank move first, it is the headline), each with both snapshots' values. A
 * list the previous snapshot did not have is not compared, so nothing is claimed from one reading.
 */
export function diffSnapshots(prev: Snapshot, curr: Snapshot, cfg: WatchConfig = ENGINE_CONFIG.watch): WatchChange[] {
  const changes: WatchChange[] = [];
  for (const [list, entries] of Object.entries(curr.lists)) {
    const before = prev.lists[list];
    if (!before) continue;
    const old = new Map(before.filter((e) => e.rank <= cfg.topN).map((e) => [e.id, e]));
    for (const e of entries) {
      if (e.rank > cfg.topN) continue;
      const after = { rank: e.rank, value: e.value };
      const was = old.get(e.id);
      const base = { list, entityId: e.id, name: e.name, ...(e.category ? { category: e.category } : {}), after };
      if (!was) {
        changes.push({ ...base, kind: "new", before: null });
        continue;
      }
      const moved = was.rank - e.rank;
      const delta = e.value - was.value;
      const kind: ChangeKind | null =
        Math.abs(moved) >= cfg.rankMove ? (moved > 0 ? "rank_up" : "rank_down") : Math.abs(delta) >= cfg.valueChange - 1e-9 ? (delta > 0 ? "value_up" : "value_down") : null;
      if (kind) changes.push({ ...base, kind, before: { rank: was.rank, value: was.value } });
    }
  }
  const weight = (c: WatchChange) => (c.kind === "new" ? 1000 - c.after.rank : Math.abs((c.before?.rank ?? 0) - c.after.rank) * 10 + Math.abs(c.after.value - (c.before?.value ?? 0)) * 100);
  return changes.sort((a, b) => weight(b) - weight(a) || a.list.localeCompare(b.list) || a.entityId.localeCompare(b.entityId));
}
