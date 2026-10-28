import { describe, expect, it } from "vitest";

import { csvRows, MAX_IMPORT_ROWS, parseRosterCsv } from "@/lib/roster/csv";
import { BATCH_CALLS, othersKey, planRefresh, PROFILE_CALLS, refreshBlock, ROSTER_TTL_MS, type PlanAct } from "@/lib/roster/plan";

const NOW = new Date("2026-11-03T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function acts(n: number, overrides: Partial<PlanAct> = {}): PlanAct[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    entityId: `e${i}`,
    category: i % 2 ? "artist" : "person",
    profileAt: null,
    affinitiesFor: null,
    affinitiesAt: null,
    ...overrides,
  }));
}

describe("planRefresh", () => {
  it("estimates a profile per stale act and one pairing call per other category", () => {
    const { estimate, batches } = planRefresh(acts(5), { now: NOW });
    // 5 profiles × 4 calls; each act's others span both categories: 2 calls each.
    expect(estimate).toEqual({ calls: 5 * PROFILE_CALLS + 5 * 2, acts: 5, profiles: 5, pairings: 10, batches: 2 });
    for (const b of batches) expect(b.reduce((s, u) => s + u.calls, 0)).toBeLessThanOrEqual(BATCH_CALLS);
  });

  it("reuses fresh profiles and pairings for a week, unless forced", () => {
    const list = acts(3).map((a, _, all) => ({ ...a, profileAt: ago(1000), affinitiesAt: ago(1000), affinitiesFor: othersKey(all, a.entityId) }));
    expect(planRefresh(list, { now: NOW }).estimate.calls).toBe(0);
    expect(planRefresh(list, { now: NOW, force: true }).estimate.calls).toBeGreaterThan(0);
    const old = list.map((a) => ({ ...a, profileAt: ago(ROSTER_TTL_MS + 1) }));
    expect(planRefresh(old, { now: NOW }).estimate).toMatchObject({ profiles: 3, pairings: 0 });
  });

  it("re-pairs every act when the roster changes", () => {
    const list = acts(3).map((a, _, all) => ({ ...a, profileAt: ago(1000), affinitiesAt: ago(1000), affinitiesFor: othersKey(all, a.entityId) }));
    const grown = [...list, ...acts(4).slice(3)];
    const { estimate } = planRefresh(grown, { now: NOW });
    expect(estimate.profiles).toBe(1);
    expect(estimate.acts).toBe(4);
  });

  it("asks for no pairings with one act", () => {
    expect(planRefresh(acts(1), { now: NOW }).estimate).toMatchObject({ calls: PROFILE_CALLS, pairings: 0, batches: 1 });
  });
});

describe("refresh budget block", () => {
  const usage = { remaining: 20, allowance: 500, dailyRemaining: null };

  it("blocks a refresh whose estimate exceeds the workspace's remaining allowance", () => {
    const block = refreshBlock({ calls: 21, batches: 1 }, usage);
    expect(block?.reason).toBe("workspace");
    expect(block?.message).toMatch(/up to 21 Qloo calls.*20 of 500 left/);
    expect(refreshBlock({ calls: 20, batches: 1 }, usage)).toBeNull();
  });

  it("blocks on the daily cap, and staggered jobs leave the reserve alone", () => {
    expect(refreshBlock({ calls: 10, batches: 1 }, { ...usage, dailyRemaining: 9 })?.reason).toBe("daily");
    expect(refreshBlock({ calls: 10, batches: 2 }, { ...usage, dailyRemaining: 12, jobDailyRemaining: 8 })?.reason).toBe("daily");
    expect(refreshBlock({ calls: 10, batches: 1 }, { ...usage, dailyRemaining: 12, jobDailyRemaining: 8 })).toBeNull();
    expect(refreshBlock({ calls: 0, batches: 0 }, { ...usage, remaining: 0 })).toBeNull();
  });
});

describe("roster CSV", () => {
  it("reads quoted fields, escaped quotes, CRLF and a BOM", () => {
    expect(csvRows('﻿act_name,home_city\r\n"Wong, Ali","LA ""West"""\r\n')).toEqual([
      ["act_name", "home_city"],
      ["Wong, Ali", 'LA "West"'],
    ]);
  });

  it("maps the design's columns in any order and drops blanks and repeats", () => {
    const parsed = parseRosterCsv("home_city,act_name,qloo_id\nLos Angeles,Ali Wong,E1\n,,\nNYC,Hasan Minhaj,\n,ali wong,\n");
    expect(parsed.error).toBeNull();
    expect(parsed.duplicates).toBe(1);
    expect(parsed.acts).toEqual([
      { row: 2, name: "Ali Wong", qlooId: "E1", homeCity: "Los Angeles" },
      { row: 4, name: "Hasan Minhaj", homeCity: "NYC" },
    ]);
  });

  it("takes one name per line without a header, and refuses a header with no act_name", () => {
    expect(parseRosterCsv("Ali Wong\nHasan Minhaj").acts.map((a) => a.name)).toEqual(["Ali Wong", "Hasan Minhaj"]);
    expect(parseRosterCsv("qloo_id,home_city\nE1,LA").error).toMatch(/act_name/);
    expect(parseRosterCsv("").error).toMatch(/empty/);
  });

  it("caps an import at the row limit and reports the rest", () => {
    const text = ["act_name", ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `Act ${i}`)].join("\n");
    const parsed = parseRosterCsv(text);
    expect(parsed.acts).toHaveLength(MAX_IMPORT_ROWS);
    expect(parsed.overLimit).toBe(5);
  });
});
