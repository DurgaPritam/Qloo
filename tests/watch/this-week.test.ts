import { describe, expect, it } from "vitest";

import { thisWeekLines, type WatchContext } from "@/lib/sponsorship/this-week";

const now = new Date("2026-11-02T09:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

const ctx: WatchContext = {
  alerts: [
    { title: "Liquid Death up 4 places in the top brands for Chicago", entityId: "brand-ld", itemTarget: "geo-chi", createdAt: days(2) },
    { title: "Fred again.. fans warming to Boiler Room", entityId: "boiler", itemTarget: "act-fred", createdAt: days(1) },
    { title: "Old news about Liquid Death", entityId: "brand-ld", itemTarget: "geo-nyc", createdAt: days(20) },
    { title: "Someone else entirely", entityId: "x", itemTarget: "y", createdAt: days(1) },
  ],
  cities: [
    { name: "Chicago", takenAt: days(2), lists: { "category:brand": [{ id: "brand-ld", name: "Liquid Death", rank: 3, value: 0.8 }] } },
    { name: "Austin", takenAt: days(30), lists: { "category:brand": [{ id: "brand-ld", name: "Liquid Death", rank: 1, value: 0.9 }] } },
  ],
};

describe("this week's evidence from Market watch", () => {
  it("lists recent alerts about the holder or the brand, newest first, then the brand's rank in watched cities", () => {
    const lines = thisWeekLines(ctx, { ids: ["act-fred"] }, { id: "brand-ld", name: "Liquid Death" }, now);
    expect(lines.map((l) => l.text)).toEqual([
      "Fred again.. fans warming to Boiler Room",
      "Liquid Death up 4 places in the top brands for Chicago",
      "Liquid Death is #3 in the top brands in Chicago (Market watch, latest reading).",
    ]);
    expect(lines.map((l) => l.kind)).toEqual(["alert", "alert", "reading"]);
  });

  it("says nothing without a recent watch reading: no trend from stale or single data", () => {
    expect(thisWeekLines({ alerts: [], cities: [] }, { ids: ["a"] }, { id: "b", name: "B" }, now)).toEqual([]);
    expect(thisWeekLines(ctx, { ids: ["nobody"] }, { id: "brand-zz", name: "Zz" }, now)).toEqual([]);
  });
});
