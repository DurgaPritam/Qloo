import { computeSchedule, DRAFT_LABEL, type Schedule, type ScheduleDay } from "@/lib/itinerary/schedule";
import type { Itinerary, Picked } from "@/lib/itinerary/types";

/**
 * Tour planner exports: a CSV with one row per day and a calendar (.ics) with each show and
 * travel day. Every value says where it came from: a draft date (code, from your start date),
 * your data, or a Qloo pick. The PDF is the page itself, printed (components/tools/itinerary-planner.tsx).
 */

/** As lib/export/outline.ts csvCell; kept here so the planner's bundle does not pull in the agent's plan types. */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A spreadsheet must not run a cell as a formula; user-entered text could start with one. */
const safe = (value: unknown) => {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const sourceOf = (p: Picked | null) => (!p ? "" : p.source === "qloo" ? `Qloo signal${p.score !== undefined ? ` ${Math.round(p.score * 100)}/100` : ""}` : "Your data");
const dateSource = (d: ScheduleDay) => (!d.date ? "" : d.source === "user" ? "Your data" : DRAFT_LABEL);
const KIND = { show: "show", travel: "travel", rest: "rest", off: "open day" } as const;

export function itineraryCsv(it: Itinerary, schedule: Schedule = computeSchedule(it)): string {
  const header = ["day", "date", "date_source", "day_type", "city", "venue", "venue_source", "support", "support_source", "sponsor", "sponsor_source", "leg_km", "qloo_heat", "contacts", "notes"];
  const rows = schedule.days.map((d) => {
    const s = it.stops[d.stopIndex];
    const show = d.kind === "show";
    const arrival = show && d.show === 1;
    const city = d.kind === "travel" ? `${d.from} → ${d.to}` : s.city.name;
    return [
      d.dayNumber ?? "",
      d.date ?? "",
      dateSource(d),
      KIND[d.kind],
      city,
      show ? (s.venue?.name ?? "") : "",
      show ? sourceOf(s.venue) : "",
      show ? (s.support?.name ?? "") : "",
      show ? sourceOf(s.support) : "",
      show ? (s.sponsor?.name ?? "") : "",
      show ? sourceOf(s.sponsor) : "",
      arrival && d.stopIndex > 0 ? schedule.stops[d.stopIndex].legKm : "",
      arrival && s.heat ? `${Math.round(s.heat.score * 100)}/100 (Qloo signal)` : "",
      arrival ? s.contacts.map((c) => [c.role, c.name, c.email, c.phone].filter(Boolean).join(" · ")).join("; ") : "",
      arrival ? s.notes : "",
    ];
  });
  return [header, ...rows].map((r) => r.map((v) => csvCell(safe(v))).join(",")).join("\r\n") + "\r\n";
}

/* ---------- Calendar (RFC 5545) ---------- */

/** TEXT values: backslash, semicolon and comma escaped, newlines as \n. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Lines longer than 75 octets folded with CRLF and one space, never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Each dated show day and travel day as an all-day event. Undated days are left out (there is
 * nothing to put on a calendar until a start date or a stop date is set).
 */
export function itineraryIcs(it: Itinerary, { now = new Date(), schedule = computeSchedule(it) }: { now?: Date; schedule?: Schedule } = {}): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Takeover//Tour planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(it.name)}`];
  for (const d of schedule.days) {
    if (!d.date || (d.kind !== "show" && d.kind !== "travel")) continue;
    const s = it.stops[d.stopIndex];
    const summary = d.kind === "show" ? `${it.fanbase.name} · ${s.city.name}${s.shows > 1 ? ` (show ${d.show})` : ""}` : `Travel · ${d.from} → ${d.to}`;
    const detail = [
      d.source === "user" ? "Date: yours." : `Date: ${DRAFT_LABEL}.`,
      ...(d.kind === "show"
        ? [s.venue && `Venue: ${s.venue.name} (${sourceOf(s.venue)})`, s.support && `Support: ${s.support.name} (${sourceOf(s.support)})`, s.sponsor && `Sponsor: ${s.sponsor.name} (${sourceOf(s.sponsor)})`, ...s.contacts.map((c) => `${c.role || "Contact"}: ${[c.name, c.email, c.phone].filter(Boolean).join(", ")}`), s.notes && `Notes: ${s.notes}`]
        : []),
      it.mock ? "Sample data, not Qloo results." : "",
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}-${d.kind}-${compact(d.date)}@takeover`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(d.date))}`,
      `SUMMARY:${icsText(summary)}`,
      ...(d.kind === "show" ? [`LOCATION:${icsText([s.venue?.name, s.city.name, s.city.admin1, s.city.country].filter(Boolean).join(", "))}`] : []),
      `DESCRIPTION:${icsText(detail.join("\n"))}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function itineraryFileName(it: Pick<Itinerary, "name" | "mock">, ext: string): string {
  const base = it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return `${base || "tour"}${it.mock ? "-sample" : ""}.${ext}`;
}
