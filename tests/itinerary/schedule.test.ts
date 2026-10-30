import { describe, expect, it } from "vitest";

import { addDays, computeSchedule, legKm, travelDaysFor } from "@/lib/itinerary/schedule";

import { CITY, stop, tour } from "./fixture";

describe("travel days", () => {
  it("adds none within one day's drive, then ceil(km ÷ pace) − 1", () => {
    expect(travelDaysFor(0, 500)).toBe(0);
    expect(travelDaysFor(500, 500)).toBe(0);
    expect(travelDaysFor(501, 500)).toBe(1);
    expect(travelDaysFor(1000, 500)).toBe(1);
    expect(travelDaysFor(1001, 500)).toBe(2);
  });

  it("measures legs from coordinates", () => {
    expect(legKm(CITY.chicago, CITY.milwaukee)).toBeGreaterThan(100);
    expect(legKm(CITY.chicago, CITY.milwaukee)).toBeLessThan(500);
    expect(legKm(CITY.denver, CITY.chicago)).toBeGreaterThan(1000);
  });
});

describe("the draft schedule", () => {
  it("is undated without a start date, but still counts the days", () => {
    const s = computeSchedule(tour([stop("chicago"), stop("milwaukee")]));
    expect(s.stops.map((x) => x.first)).toEqual([null, null]);
    expect(s.days.map((d) => [d.kind, d.dayNumber])).toEqual([["show", 1], ["show", 2]]);
    expect(s.days.every((d) => d.date === null)).toBe(true);
  });

  it("drafts from the start date: next day within a day's drive, travel days for longer legs, shows and rest days", () => {
    const km = legKm(CITY.denver, CITY.chicago);
    const travel = Math.ceil(km / 500) - 1;
    const s = computeSchedule(tour([stop("chicago", { shows: 2, restAfter: 1 }), stop("milwaukee"), stop("denver")], { startDate: "2027-03-01" }));
    expect(s.stops[0]).toMatchObject({ first: "2027-03-01", last: "2027-03-02", source: "draft", legKm: 0 });
    // One rest day after Chicago, then Milwaukee (a short drive) the day after.
    expect(s.stops[1]).toMatchObject({ first: "2027-03-04", source: "draft", travelDays: 0 });
    expect(s.stops[2]).toMatchObject({ first: addDays("2027-03-04", travel + 1), travelDays: travel, legKm: legKm(CITY.milwaukee, CITY.denver) });
    expect(s.days.map((d) => d.kind)).toEqual(["show", "show", "rest", "show", ...Array(travel).fill("travel"), "show"]);
    expect(s.days.find((d) => d.kind === "travel")).toMatchObject({ from: "Milwaukee", to: "Denver", source: "draft" });
    expect(s.warnings).toEqual([]);
    expect(s.totalDays).toBe(s.days.length);
    expect(s.showDays).toBe(4);
  });

  it("pins a date the user set, and later drafts flow from it", () => {
    const s = computeSchedule(tour([stop("chicago"), stop("milwaukee", { date: "2027-03-10" }), stop("austin")], { startDate: "2027-03-01" }));
    expect(s.stops[1]).toMatchObject({ first: "2027-03-10", source: "user" });
    // Eight open days between the 1st and the 10th.
    expect(s.days.filter((d) => d.kind === "off")).toHaveLength(8);
    const travel = travelDaysFor(legKm(CITY.milwaukee, CITY.austin), 500);
    expect(s.stops[2].first).toBe(addDays("2027-03-10", travel + 1));
    expect(s.days.find((d) => d.stopIndex === 1 && d.kind === "show")?.source).toBe("user");
  });

  it("dates from a pin even with no start date; stops before it stay undated", () => {
    const s = computeSchedule(tour([stop("chicago"), stop("milwaukee", { date: "2027-05-01" }), stop("austin")]));
    expect(s.stops[0].first).toBeNull();
    expect(s.stops[1].first).toBe("2027-05-01");
    expect(s.stops[2].first).not.toBeNull();
  });

  it("flags, never moves, a pinned date that leaves less time than the drive needs", () => {
    const s = computeSchedule(tour([stop("chicago"), stop("denver", { date: "2027-03-02" })], { startDate: "2027-03-01" }));
    expect(s.stops[1].first).toBe("2027-03-02");
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toMatchObject({ stopIndex: 1, kind: "tight" });
    expect(s.warnings[0].text).toMatch(/Denver on 2027-03-02 leaves 0 days after Chicago; the plan needs \d travel days? for/);
  });

  it("flags dates out of order and a first stop before the start date", () => {
    const s = computeSchedule(tour([stop("chicago", { date: "2027-02-20" }), stop("milwaukee", { date: "2027-02-19" })], { startDate: "2027-03-01" }));
    expect(s.warnings.map((w) => w.kind)).toEqual(["before_start", "order"]);
  });

  it("follows the pace", () => {
    const slow = computeSchedule(tour([stop("chicago"), stop("denver")], { startDate: "2027-03-01", kmPerTravelDay: 300 }));
    const fast = computeSchedule(tour([stop("chicago"), stop("denver")], { startDate: "2027-03-01", kmPerTravelDay: 2000 }));
    expect(slow.stops[1].travelDays).toBeGreaterThan(fast.stops[1].travelDays);
    expect(fast.stops[1].first).toBe("2027-03-02");
  });
});
