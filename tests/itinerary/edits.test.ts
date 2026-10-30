import { describe, expect, it } from "vitest";

import { applyEdits, dateFromInstruction, numbersIn, validateOps, type CityResolution } from "@/lib/itinerary/edits";
import { parseItinerary } from "@/lib/itinerary/types";

import { CITY, stop, tour } from "./fixture";

const resolve = (name: string): CityResolution => {
  const key = name.toLowerCase().split(",")[0].trim() as keyof typeof CITY;
  if (name.toLowerCase() === "portland") return { status: "ambiguous", options: ["Portland, Oregon", "Portland, Maine"] };
  return CITY[key] ? { status: "matched", city: CITY[key] } : { status: "unmatched" };
};
const base = () => tour([stop("chicago"), stop("denver"), stop("austin")], { startDate: "2027-03-01" });
const run = (instruction: string, ops: unknown[], it = base()) => {
  const v = validateOps(it, ops, instruction, resolve, "2026-10-30");
  return { ...v, next: applyEdits(it, v.ops) };
};

describe("numbers in an instruction", () => {
  it("reads digits, number words, ordinals and weeks", () => {
    const n = numbersIn("push everything back two weeks, set pace to 1,000 km and add a third show");
    expect([...n]).toEqual(expect.arrayContaining([1000, 2, 14, 3, 1]));
    expect(numbersIn("push everything back a week").has(7)).toBe(true);
    expect(numbersIn("start on 14 March").has(14)).toBe(true);
  });
});

describe("dates from an instruction", () => {
  it("needs the day and month typed; the year is the user's or the next one on or after the tour's start", () => {
    expect(dateFromInstruction("2027-03-14", "start on 14 March", "2026-10-30")).toBe("2027-03-14");
    // The model guessed a year; code picks the next 14 March on or after the anchor.
    expect(dateFromInstruction("2031-03-14", "start on 14 March", "2026-10-30")).toBe("2027-03-14");
    expect(dateFromInstruction("2028-03-14", "start on 14 March 2028", "2026-10-30")).toBe("2028-03-14");
    expect(dateFromInstruction("2027-03-14", "start on 14/3", "2026-10-30")).toBe("2027-03-14");
    expect(dateFromInstruction("2027-03-15", "start on 14 March", "2026-10-30")).toBeNull();
    expect(dateFromInstruction("2027-04-14", "start on 14 March", "2026-10-30")).toBeNull();
    expect(dateFromInstruction("2027-03-14", "start next Friday", "2026-10-30")).toBeNull();
  });
});

describe("validateOps and applyEdits", () => {
  it("swaps a city: new coordinates, Qloo heat and picks cleared", () => {
    const it0 = base();
    it0.stops[1].venue = { name: "Red Rocks", source: "qloo", score: 0.7 };
    const { ops, rejected, next } = run("swap Denver for Boulder", [{ op: "replace_city", city: "Denver", with: "Boulder" }], it0);
    expect(rejected).toEqual([]);
    expect(ops[0].label).toBe("Swapped Denver for Boulder");
    expect(next.stops[1]).toMatchObject({ id: "s-denver", city: CITY.boulder, heat: null, venue: null, role: "added" });
  });

  it("adds rest days counted in code, moves and removes stops", () => {
    const it0 = base();
    it0.stops[0].restAfter = 1;
    const { next, rejected } = run("add a rest day after Chicago, move Chicago to the end, remove Austin", [
      { op: "add_rest_days", city: "Chicago", days: 1 },
      { op: "move_stop", city: "Chicago", position: "end" },
      { op: "remove_stop", city: "Austin" },
    ], it0);
    expect(rejected).toEqual([]);
    expect(next.stops.map((s) => s.city.name)).toEqual(["Denver", "Chicago"]);
    expect(next.stops[1].restAfter).toBe(2);
  });

  it("adds a stop after another, and a later op can name it", () => {
    const { next, rejected } = run("add Milwaukee after Chicago with The Rave as venue", [
      { op: "add_stop", city: "Milwaukee", after: "Chicago" },
      { op: "set_field", city: "Milwaukee", field: "venue", value: "The Rave" },
    ]);
    expect(rejected).toEqual([]);
    expect(next.stops.map((s) => s.city.name)).toEqual(["Chicago", "Milwaukee", "Denver", "Austin"]);
    expect(next.stops[1].venue).toEqual({ name: "The Rave", source: "user" });
  });

  it("sets and shifts dates only from what the user typed", () => {
    expect(run("start on 14 March", [{ op: "set_start_date", date: "2027-03-14" }]).next.startDate).toBe("2027-03-14");
    const shifted = run("push everything back a week", [{ op: "shift_dates", days: 7 }], tour([stop("chicago", { date: "2027-03-05" })], { startDate: "2027-03-01" })).next;
    expect(shifted.startDate).toBe("2027-03-08");
    expect(shifted.stops[0].date).toBe("2027-03-12");
  });

  it("rejects invented dates and day counts, and leaves the tour as it was", () => {
    const { ops, rejected, next } = run("start the tour in spring and give Denver some rest", [
      { op: "set_start_date", date: "2027-03-21" },
      { op: "set_rest_after", city: "Denver", days: 3 },
      { op: "shift_dates", days: 10 },
    ]);
    expect(ops).toEqual([]);
    expect(rejected).toHaveLength(3);
    expect(rejected[1].reason).toMatch(/isn't in your instruction/);
    expect(next).toEqual(base());
  });

  it("reports unknown and ambiguous cities and stops not on the tour instead of applying them", () => {
    const { ops, rejected } = run("add Atlantis and Portland, remove Paris", [
      { op: "add_stop", city: "Atlantis" },
      { op: "add_stop", city: "Portland" },
      { op: "remove_stop", city: "Paris" },
      { op: "teleport", city: "Denver" },
    ]);
    expect(ops).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "No city called “Atlantis” in our city list.",
      expect.stringMatching(/could be Portland, Oregon or Portland, Maine/),
      "Paris is not on the tour.",
      "Not an edit the planner knows.",
    ]);
  });

  it("adds a contact only with details the user typed", () => {
    const ok = run("add Jane Doe as promoter in Austin, jane@x.com", [{ op: "add_contact", city: "Austin", role: "promoter", name: "Jane Doe", email: "jane@x.com" }]);
    expect(ok.next.stops[2].contacts).toMatchObject([{ role: "promoter", name: "Jane Doe", email: "jane@x.com", phone: "" }]);
    const made = run("add Jane Doe as promoter in Austin", [{ op: "add_contact", city: "Austin", role: "promoter", name: "Jane Doe", email: "jane@doe.com" }]);
    expect(made.ops).toEqual([]);
    expect(made.rejected[0].reason).toMatch(/isn't in your instruction/);
  });

  it("is pure: the original itinerary is unchanged and the result still parses", () => {
    const it0 = base();
    const copy = structuredClone(it0);
    const { next } = run("set 2 shows in Austin and pace 650", [
      { op: "set_shows", city: "Austin", shows: 2 },
      { op: "set_pace", kmPerDay: 650 },
      { op: "rename", name: "Spring run" },
    ], it0);
    expect(it0).toEqual(copy);
    expect(next).toMatchObject({ name: "Spring run", kmPerTravelDay: 650 });
    expect(next.stops[2].shows).toBe(2);
    expect(parseItinerary(next)).toEqual(next);
  });
});

describe("parseItinerary", () => {
  it("rejects what is not a tour, and caps size", () => {
    expect(parseItinerary(null)).toBeNull();
    expect(parseItinerary({ fanbase: { id: "x", name: "y" }, stops: "no" })).toBeNull();
    const big = base();
    big.stops[0].notes = "x".repeat(200_000);
    expect(parseItinerary(big)).toBeNull();
    const bad = base() as unknown as { stops: { heat: unknown; venue: unknown }[] };
    bad.stops[0].heat = { score: 7, cells: 1 };
    bad.stops[0].venue = { name: "Typed", source: "qloo", score: 99 };
    const parsed = parseItinerary(bad)!;
    expect(parsed.stops[0].heat).toBeNull();
    expect(parsed.stops[0].venue).toEqual({ name: "Typed", source: "qloo" });
  });
});
