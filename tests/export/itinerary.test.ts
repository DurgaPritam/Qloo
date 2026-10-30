import { describe, expect, it } from "vitest";

import { foldLine, icsText, itineraryCsv, itineraryFileName, itineraryIcs } from "@/lib/export/itinerary";
import { computeSchedule } from "@/lib/itinerary/schedule";

import { stop, tour } from "../itinerary/fixture";

const sample = () =>
  tour(
    [
      stop("chicago", { venue: { name: "Thalia Hall", source: "qloo", score: 0.82, evidence: "Qloo affinity 0.91" }, sponsor: { name: "=HYPERLINK(1)", source: "user" }, contacts: [{ id: "c1", role: "promoter", name: "Jane Doe", email: "jane@x.com", phone: "" }], notes: "Load-in 2pm, side door" }),
      stop("denver", { date: "2027-03-09" }),
    ],
    { startDate: "2027-03-01" },
  );

describe("itineraryCsv", () => {
  it("has one row per day, with where each value came from", () => {
    const it0 = sample();
    const s = computeSchedule(it0);
    const lines = itineraryCsv(it0, s).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(s.days.length + 1);
    expect(lines[0]).toBe("day,date,date_source,day_type,city,venue,venue_source,support,support_source,sponsor,sponsor_source,leg_km,qloo_heat,contacts,notes");
    expect(lines[1]).toContain("2027-03-01,Draft · to confirm with the promoter,show,Chicago,Thalia Hall,Qloo signal 82/100");
    // A typed value that looks like a formula is defused.
    expect(lines[1]).toContain("'=HYPERLINK(1),Your data");
    expect(lines[1]).toContain("promoter · Jane Doe · jane@x.com");
    expect(lines[1]).toContain('"Load-in 2pm, side door"');
    const denver = lines.find((l) => l.includes(",show,Denver,"))!;
    expect(denver).toContain("2027-03-09,Your data,show");
    expect(lines.some((l) => l.includes(",open day,"))).toBe(true);
  });
});

describe("itineraryIcs", () => {
  it("is RFC 5545: CRLF, all-day events with UID and DTSTAMP, escaped and folded text", () => {
    const ics = itineraryIcs(sample(), { now: new Date("2026-10-30T12:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const events = ics.split("BEGIN:VEVENT").length - 1;
    const s = computeSchedule(sample());
    expect(events).toBe(s.days.filter((d) => d.date && (d.kind === "show" || d.kind === "travel")).length);
    expect(ics).toContain("UID:s-chicago-show-20270301@takeover");
    expect(ics).toContain("DTSTAMP:20261030T120000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270301\r\nDTEND;VALUE=DATE:20270302");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Date: Draft · to confirm with the promoter.");
    expect(unfolded).toContain("Notes: Load-in 2pm\\, side door");
    expect(unfolded).toContain("Date: yours.");
  });

  it("leaves undated days out", () => {
    const ics = itineraryIcs(tour([stop("chicago")]));
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("escapes and folds per the RFC", () => {
    expect(icsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const folded = foldLine("X".repeat(80) + "é".repeat(40));
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("X".repeat(80) + "é".repeat(40));
  });

  it("names files from the tour, marking sample data", () => {
    expect(itineraryFileName({ name: "Spring Run · 6 stops", mock: true }, "ics")).toBe("spring-run-6-stops-sample.ics");
  });
});
