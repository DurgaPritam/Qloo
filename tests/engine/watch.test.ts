import { describe, expect, it } from "vitest";

import { ENGINE_CONFIG } from "@/lib/engine/config";
import { diffSnapshots, type Snapshot, type SnapshotEntry } from "@/lib/engine/watch";

const cfg = ENGINE_CONFIG.watch;
const e = (id: string, rank: number, value: number): SnapshotEntry => ({ id, name: id.toUpperCase(), rank, value });
const snap = (lists: Snapshot["lists"]): Snapshot => ({ lists });

describe("diffSnapshots", () => {
  it("uses the thresholds in config", () => {
    expect(cfg).toEqual({ topN: 10, rankMove: 3, valueChange: 0.05 });
  });

  it("flags a new entry in a top list, with no before value", () => {
    const changes = diffSnapshots(snap({ partners: [e("a", 1, 0.9)] }), snap({ partners: [e("a", 1, 0.9), e("b", 2, 0.88)] }));
    expect(changes).toEqual([{ list: "partners", entityId: "b", name: "B", kind: "new", before: null, after: { rank: 2, value: 0.88 } }]);
  });

  it("flags rank moves of N places or more, not N − 1, carrying both snapshots' values", () => {
    const prev = snap({ cities: [e("a", 1, 0.9), e("b", 5, 0.7), e("c", 6, 0.6)] });
    const curr = snap({ cities: [e("b", 2, 0.71), e("c", 4, 0.6), e("a", 1, 0.9)] });
    const changes = diffSnapshots(prev, curr);
    expect(changes).toEqual([{ list: "cities", entityId: "b", name: "B", kind: "rank_up", before: { rank: 5, value: 0.7 }, after: { rank: 2, value: 0.71 } }]);
    const down = diffSnapshots(snap({ cities: [e("a", 1, 0.9)] }), snap({ cities: [e("a", 4, 0.9)] }));
    expect(down[0]).toMatchObject({ kind: "rank_down", before: { rank: 1 }, after: { rank: 4 } });
  });

  it("flags value changes of X or more, either way, and nothing below", () => {
    const prev = snap({ partners: [e("a", 1, 0.9), e("b", 2, 0.8), e("c", 3, 0.7)] });
    const curr = snap({ partners: [e("a", 1, 0.95), e("b", 2, 0.751), e("c", 3, 0.649)] });
    const changes = diffSnapshots(prev, curr);
    expect(changes.map((c) => [c.entityId, c.kind])).toEqual([
      ["c", "value_down"],
      ["a", "value_up"],
    ]);
    expect(changes.find((c) => c.entityId === "a")).toMatchObject({ before: { value: 0.9 }, after: { value: 0.95 } });
  });

  it("reports a rank move rather than a value change when both happen to one entry", () => {
    const [c] = diffSnapshots(snap({ cities: [e("a", 8, 0.5)] }), snap({ cities: [e("a", 2, 0.8)] }));
    expect(c.kind).toBe("rank_up");
    expect(c.before).toEqual({ rank: 8, value: 0.5 });
  });

  it("compares only lists both snapshots have, and only their top N", () => {
    expect(diffSnapshots(snap({}), snap({ partners: [e("a", 1, 0.9)] }))).toEqual([]);
    const prev = snap({ partners: Array.from({ length: 12 }, (_, i) => e(`p${i}`, i + 1, 0.9)) });
    const curr = snap({ partners: [...prev.lists.partners.slice(0, 10), e("late", 11, 0.95)] });
    expect(diffSnapshots(prev, curr)).toEqual([]);
  });

  it("finds nothing when the two snapshots are the same", () => {
    const s = snap({ cities: [e("a", 1, 0.9), e("b", 2, 0.8)], partners: [e("x", 1, 0.95)] });
    expect(diffSnapshots(s, structuredClone(s))).toEqual([]);
  });
});
