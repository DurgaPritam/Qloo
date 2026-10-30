import { foldPlace } from "@/lib/engine/city-match";

import { addDays } from "./schedule";
import { DEFAULT_PACE_KM, emptyStop, isIsoDate, ITINERARY_LIMITS, newId, type Contact, type Itinerary, type ItineraryStop, type StopCity } from "./types";

/**
 * Edits to an itinerary, from the editor or from the AI edit box. The model only proposes raw ops
 * (RawOp, by city name); validateOps checks every one against the itinerary and the user's own
 * words, resolves city names to real cities, and returns resolved ops (by stop id) that
 * applyEdits applies. Code then recomputes legs and the draft schedule.
 *
 * The number rule: every date, day count, show count, pace or position in an op must come from the
 * instruction (digits, number words or month names). Anything else is rejected and reported, so a
 * number the model made up never reaches the plan. A year the user did not type is chosen by code:
 * the next such date on or after the tour's start (or today).
 */

export type TextField = "venue" | "support" | "sponsor" | "notes";
type Where = { after?: string; position?: number | "start" | "end" };

/** What the model may return (by city name). */
export type RawOp =
  | ({ op: "add_stop"; city: string } & Where)
  | { op: "remove_stop"; city: string }
  | ({ op: "move_stop"; city: string } & Where)
  | { op: "replace_city"; city: string; with: string }
  | { op: "set_start_date"; date: string }
  | { op: "set_date"; city: string; date: string }
  | { op: "clear_date"; city: string }
  | { op: "shift_dates"; days: number }
  | { op: "set_shows"; city: string; shows: number }
  | { op: "set_rest_after"; city: string; days: number }
  | { op: "add_rest_days"; city: string; days: number }
  | { op: "set_pace"; kmPerDay: number }
  | { op: "set_field"; city: string; field: TextField; value: string }
  | { op: "add_contact"; city: string; role: string; name: string; email?: string; phone?: string }
  | { op: "remove_contact"; city: string; name: string }
  | { op: "rename"; name: string };

type At = { afterId?: string | null; position?: number | "start" | "end" };

/** A checked op, by stop id; `label` says what it did, for the change list. */
export type EditOp = { label: string } & (
  | ({ op: "add_stop"; stopId: string; city: StopCity } & At)
  | { op: "remove_stop"; stopId: string }
  | ({ op: "move_stop"; stopId: string } & At)
  | { op: "replace_city"; stopId: string; city: StopCity }
  | { op: "set_start_date"; date: string }
  | { op: "set_date"; stopId: string; date: string }
  | { op: "clear_date"; stopId: string }
  | { op: "shift_dates"; days: number }
  | { op: "set_shows"; stopId: string; shows: number }
  | { op: "set_rest_after"; stopId: string; days: number }
  | { op: "set_pace"; kmPerDay: number }
  | { op: "set_field"; stopId: string; field: TextField; value: string }
  | { op: "add_contact"; stopId: string; contact: Contact }
  | { op: "remove_contact"; stopId: string; contactId: string }
  | { op: "rename"; name: string }
);

export const OP_NAMES = ["add_stop", "remove_stop", "move_stop", "replace_city", "set_start_date", "set_date", "clear_date", "shift_dates", "set_shows", "set_rest_after", "add_rest_days", "set_pace", "set_field", "add_contact", "remove_contact", "rename"] as const;

/* ---------- Applying ---------- */

function place<T extends { id: string }>(list: T[], item: T, at: At): T[] {
  const out = [...list];
  if (at.afterId) {
    const i = out.findIndex((s) => s.id === at.afterId);
    if (i >= 0) {
      out.splice(i + 1, 0, item);
      return out;
    }
  }
  if (at.position === "start") out.unshift(item);
  else if (typeof at.position === "number") out.splice(Math.max(0, Math.min(out.length, at.position - 1)), 0, item);
  else out.push(item);
  return out;
}

const shift = (d: string, n: number) => (d ? addDays(d, n) : d);

/** Applies checked ops in order. Pure: returns a new itinerary; ops naming a stop that is gone are skipped. */
export function applyEdits(it: Itinerary, ops: readonly EditOp[]): Itinerary {
  let next: Itinerary = { ...it, stops: [...it.stops] };
  const edit = (id: string, fn: (s: ItineraryStop) => ItineraryStop) => {
    next = { ...next, stops: next.stops.map((s) => (s.id === id ? fn(s) : s)) };
  };
  for (const op of ops) {
    switch (op.op) {
      case "add_stop":
        if (next.stops.length < ITINERARY_LIMITS.stops && !next.stops.some((s) => s.id === op.stopId)) next = { ...next, stops: place(next.stops, emptyStop(op.city, op.stopId), op) };
        break;
      case "remove_stop":
        next = { ...next, stops: next.stops.filter((s) => s.id !== op.stopId) };
        break;
      case "move_stop": {
        const s = next.stops.find((x) => x.id === op.stopId);
        if (s && op.afterId !== op.stopId) next = { ...next, stops: place(next.stops.filter((x) => x.id !== op.stopId), s, op) };
        break;
      }
      case "replace_city":
        // A different city: its Qloo heat, venue, support act and sponsor were for the old one.
        edit(op.stopId, (s) => ({ ...s, city: op.city, heat: null, role: "added", venue: null, support: null, sponsor: null }));
        break;
      case "set_start_date":
        next = { ...next, startDate: op.date };
        break;
      case "set_date":
        edit(op.stopId, (s) => ({ ...s, date: op.date }));
        break;
      case "clear_date":
        edit(op.stopId, (s) => ({ ...s, date: "" }));
        break;
      case "shift_dates":
        next = { ...next, startDate: shift(next.startDate, op.days), stops: next.stops.map((s) => ({ ...s, date: shift(s.date, op.days) })) };
        break;
      case "set_shows":
        edit(op.stopId, (s) => ({ ...s, shows: op.shows }));
        break;
      case "set_rest_after":
        edit(op.stopId, (s) => ({ ...s, restAfter: op.days }));
        break;
      case "set_pace":
        next = { ...next, kmPerTravelDay: op.kmPerDay };
        break;
      case "set_field":
        edit(op.stopId, (s) => (op.field === "notes" ? { ...s, notes: op.value } : { ...s, [op.field]: op.value ? { name: op.value, source: "user" } : null }));
        break;
      case "add_contact":
        edit(op.stopId, (s) => (s.contacts.length < ITINERARY_LIMITS.contacts ? { ...s, contacts: [...s.contacts, op.contact] } : s));
        break;
      case "remove_contact":
        edit(op.stopId, (s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== op.contactId) }));
        break;
      case "rename":
        next = { ...next, name: op.name };
        break;
    }
  }
  return next;
}

/* ---------- The number rule ---------- */

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  double: 2, couple: 2, a: 1, an: 1, another: 1, single: 1, extra: 1,
};

export const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Every number the instruction states: digits ("1,000", "14th"), number words, and weeks as days. */
export function numbersIn(instruction: string): Set<number> {
  const text = instruction.toLowerCase();
  const out = new Set<number>();
  for (const m of text.matchAll(/\d[\d,]*/g)) out.add(Number(m[0].replace(/,/g, "")));
  for (const w of text.split(/[^a-z]+/)) if (w in WORDS) out.add(WORDS[w]);
  // "twenty-one" style compounds.
  for (const m of text.matchAll(/\b(twenty|thirty)[-\s](one|two|three|four|five|six|seven|eight|nine|first|second|third)\b/g)) out.add(WORDS[m[1]] + WORDS[m[2]]);
  // "a week", "two weeks", "fortnight": days.
  for (const m of text.matchAll(/\b(\d+|[a-z]+)\s+weeks?\b/g)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
    if (n !== undefined) out.add(n * 7);
  }
  if (/\bweek\b/.test(text)) out.add(7);
  if (/\bfortnight\b/.test(text)) out.add(14);
  return out;
}

const monthsIn = (instruction: string) => {
  const text = instruction.toLowerCase();
  return new Set(MONTHS.flatMap((m, i) => (new RegExp(`\\b${m.slice(0, 3)}(${m.slice(3)}|\\.)?\\b`).test(text) || (m === "september" && /\bsept\b/.test(text)) ? [i + 1] : [])));
};

/**
 * A date from an op, held to the instruction: its day of the month must be stated, and its month
 * by name or as digits in a written date ("14/3", "2027-03-14"). Its year is the stated one, else
 * the first year that puts it on or after `from`. Null when the instruction does not state it.
 */
export function dateFromInstruction(date: string, instruction: string, from: string): string | null {
  if (!isIsoDate(date)) return null;
  const [, m, d] = date.split("-").map(Number);
  const nums = numbersIn(instruction);
  const numericDate = /\d{1,4}[/.-]\d{1,2}/.test(instruction);
  if (!nums.has(d)) return null;
  if (!monthsIn(instruction).has(m) && !(numericDate && nums.has(m))) return null;
  const years = [...instruction.matchAll(/\b(20\d\d)\b/g)].map((x) => Number(x[1]));
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  if (years.length) {
    const y = Number(date.slice(0, 4));
    const candidate = `${years.includes(y) ? y : years[0]}-${mm}-${dd}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  for (let y = Number(from.slice(0, 4)); y <= Number(from.slice(0, 4)) + 4; y++) {
    const candidate = `${y}-${mm}-${dd}`;
    if (isIsoDate(candidate) && candidate >= from) return candidate;
  }
  return null;
}

/* ---------- Validation ---------- */

export type CityResolution = { status: "matched"; city: StopCity } | { status: "ambiguous"; options: string[] } | { status: "unmatched" };

export interface Rejected {
  op: string;
  reason: string;
}

const str = (x: unknown, max: number = ITINERARY_LIMITS.text) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** The stop a name refers to: exact folded name first, then a stop whose name starts with it. */
function findStop(stops: readonly ItineraryStop[], name: string): ItineraryStop | null {
  const want = foldPlace(name.split(",")[0] ?? "");
  if (!want) return null;
  return stops.find((s) => foldPlace(s.city.name) === want) ?? stops.find((s) => foldPlace(s.city.name).startsWith(want)) ?? null;
}

const describe = (op: Record<string, unknown>) =>
  [op.op, op.city, op.with, op.date, op.days, op.shows, op.field, op.name].filter((x) => x !== undefined && x !== "").map(String).join(" · ").slice(0, 160);

/**
 * Checks raw ops one by one against a working copy of the itinerary (so a stop added by one op can
 * be named by the next), and returns the ops to apply plus each rejected op with its reason.
 * `resolveCity` turns a typed city into a real one (the server's city list); `today` anchors a
 * date whose year the user did not type when the tour has no start date yet.
 */
export function validateOps(
  it: Itinerary,
  raw: readonly unknown[],
  instruction: string,
  resolveCity: (name: string) => CityResolution,
  today: string,
): { ops: EditOp[]; rejected: Rejected[] } {
  const ops: EditOp[] = [];
  const rejected: Rejected[] = [];
  const nums = numbersIn(instruction);
  let work = it;
  const anchor = () => work.startDate || work.stops.find((s) => s.date)?.date || today;

  for (const x of raw.slice(0, 20)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const reject = (reason: string) => rejected.push({ op: describe(o), reason });
    const stopNamed = (key = "city") => {
      const s = findStop(work.stops, str(o[key]));
      if (!s) reject(`${str(o[key]) || "That city"} is not on the tour.`);
      return s;
    };
    const stated = (n: unknown, what: string, min: number, max: number) => {
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return reject(`${what} must be a whole number from ${min} to ${max}.`), null;
      if (!nums.has(Math.abs(n))) return reject(`${what} ${n} isn't in your instruction, so it wasn't applied. Type the number.`), null;
      return n;
    };
    const realCity = (name: string) => {
      const r = resolveCity(name);
      if (r.status === "matched") return r.city;
      reject(r.status === "ambiguous" ? `“${name}” could be ${r.options.join(" or ")}. Add the region, e.g. “${name}, ${r.options[0].split(", ")[1] ?? "state"}”.` : `No city called “${name}” in our city list.`);
      return null;
    };
    const where = (): At | null => {
      if (o.after !== undefined && o.after !== null && o.after !== "") {
        const s = findStop(work.stops, str(o.after));
        if (!s) return reject(`${str(o.after)} is not on the tour.`), null;
        return { afterId: s.id };
      }
      if (o.position === "start" || o.position === "end") return { position: o.position };
      if (o.position !== undefined && o.position !== null) {
        const p = stated(o.position, "Position", 1, ITINERARY_LIMITS.stops);
        return p === null ? null : { position: p };
      }
      return { position: "end" };
    };
    const push = (op: EditOp) => {
      ops.push(op);
      work = applyEdits(work, [op]);
    };
    const whereLabel = (at: At) => (at.afterId ? `after ${work.stops.find((s) => s.id === at.afterId)?.city.name}` : at.position === "start" ? "at the start" : at.position === "end" ? "at the end" : `as stop ${at.position}`);

    switch (o.op) {
      case "add_stop": {
        if (work.stops.length >= ITINERARY_LIMITS.stops) {
          reject(`A tour holds at most ${ITINERARY_LIMITS.stops} stops.`);
          break;
        }
        const city = realCity(str(o.city));
        const at = city && where();
        if (!city || !at) break;
        if (work.stops.some((s) => s.city.id === city.id)) {
          reject(`${city.name} is already on the tour.`);
          break;
        }
        push({ op: "add_stop", stopId: newId(), city, ...at, label: `Added ${city.name} ${whereLabel(at)}` });
        break;
      }
      case "remove_stop": {
        const s = stopNamed();
        if (s) push({ op: "remove_stop", stopId: s.id, label: `Removed ${s.city.name}` });
        break;
      }
      case "move_stop": {
        const s = stopNamed();
        const at = s && where();
        if (s && at) push({ op: "move_stop", stopId: s.id, ...at, label: `Moved ${s.city.name} ${whereLabel(at)}` });
        break;
      }
      case "replace_city": {
        const s = stopNamed();
        const city = s && realCity(str(o.with));
        if (!s || !city) break;
        if (work.stops.some((x) => x.city.id === city.id && x.id !== s.id)) {
          reject(`${city.name} is already on the tour.`);
          break;
        }
        push({ op: "replace_city", stopId: s.id, city, label: `Swapped ${s.city.name} for ${city.name}` });
        break;
      }
      case "set_start_date": {
        const d = dateFromInstruction(str(o.date, 10), instruction, anchor());
        if (!d) reject("That date isn't written in your instruction (day and month), so it wasn't applied.");
        else push({ op: "set_start_date", date: d, label: `Start date set to ${d}` });
        break;
      }
      case "set_date": {
        const s = stopNamed();
        if (!s) break;
        const d = dateFromInstruction(str(o.date, 10), instruction, anchor());
        if (!d) reject("That date isn't written in your instruction (day and month), so it wasn't applied.");
        else push({ op: "set_date", stopId: s.id, date: d, label: `${s.city.name} set to ${d}` });
        break;
      }
      case "clear_date": {
        const s = stopNamed();
        if (s) push({ op: "clear_date", stopId: s.id, label: `${s.city.name} back to a draft date` });
        break;
      }
      case "shift_dates": {
        const n = stated(o.days, "Days", -366, 366);
        if (n === null) break;
        if (!work.startDate && !work.stops.some((s) => s.date)) reject("There are no dates to move yet. Set a start date first.");
        else if (n !== 0) push({ op: "shift_dates", days: n, label: `Moved every date you set ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "later" : "earlier"}` });
        break;
      }
      case "set_shows": {
        const s = stopNamed();
        const n = s && stated(o.shows, "Shows", 1, ITINERARY_LIMITS.shows);
        if (s && n) push({ op: "set_shows", stopId: s.id, shows: n, label: `${s.city.name}: ${n} show${n === 1 ? "" : "s"}` });
        break;
      }
      case "set_rest_after":
      case "add_rest_days": {
        const s = stopNamed();
        const n = s && stated(o.days, "Rest days", o.op === "add_rest_days" ? 1 : 0, ITINERARY_LIMITS.restAfter);
        if (!s || n === null || n === undefined) break;
        // "Add a rest day" counts from what is there, in code.
        const days = Math.min(ITINERARY_LIMITS.restAfter, o.op === "add_rest_days" ? s.restAfter + n : n);
        push({ op: "set_rest_after", stopId: s.id, days, label: `${s.city.name}: ${days} rest day${days === 1 ? "" : "s"} after` });
        break;
      }
      case "set_pace": {
        const n = stated(o.kmPerDay, "Pace", ITINERARY_LIMITS.pace.min, ITINERARY_LIMITS.pace.max);
        if (n) push({ op: "set_pace", kmPerDay: n, label: `Pace set to ${n.toLocaleString("en-GB")} km a travel day` });
        break;
      }
      case "set_field": {
        const s = stopNamed();
        const field = o.field as TextField;
        if (!s) break;
        if (!["venue", "support", "sponsor", "notes"].includes(field)) {
          reject("Only the venue, support act, sponsor or notes can be set that way.");
          break;
        }
        const value = str(o.value, field === "notes" ? ITINERARY_LIMITS.notes : ITINERARY_LIMITS.text);
        const what = { venue: "venue", support: "support act", sponsor: "sponsor", notes: "notes" }[field];
        push({ op: "set_field", stopId: s.id, field, value, label: value ? `${s.city.name}: ${what} set to “${value.slice(0, 60)}”` : `${s.city.name}: ${what} cleared` });
        break;
      }
      case "add_contact": {
        const s = stopNamed();
        const name = str(o.name, 120);
        if (!s) break;
        if (!name) {
          reject("A contact needs a name.");
          break;
        }
        // Contact details must be ones the user typed.
        const email = str(o.email, 160);
        const phone = str(o.phone, 60);
        const typed = (v: string) => !v || instruction.toLowerCase().includes(v.toLowerCase());
        if (!typed(email) || !typed(phone)) {
          reject(`The email or phone for ${name} isn't in your instruction, so it wasn't added.`);
          break;
        }
        const role = str(o.role, 60);
        push({ op: "add_contact", stopId: s.id, contact: { id: newId(), role, name, email, phone }, label: `${s.city.name}: added ${name}${role ? ` (${role})` : ""}` });
        break;
      }
      case "remove_contact": {
        const s = stopNamed();
        const want = str(o.name, 120).toLowerCase();
        const c = s?.contacts.find((x) => x.name.toLowerCase() === want) ?? s?.contacts.find((x) => want && x.name.toLowerCase().includes(want));
        if (s && !c) reject(`No contact called ${str(o.name, 120)} in ${s.city.name}.`);
        if (s && c) push({ op: "remove_contact", stopId: s.id, contactId: c.id, label: `${s.city.name}: removed ${c.name}` });
        break;
      }
      case "rename": {
        const name = str(o.name, 120);
        if (name) push({ op: "rename", name, label: `Renamed to “${name}”` });
        break;
      }
      default:
        reject("Not an edit the planner knows.");
    }
  }
  return { ops, rejected };
}

/** Pace from user input, clamped; the default when it is not a number. */
export const clampPace = (n: number) => (Number.isFinite(n) ? Math.round(Math.min(ITINERARY_LIMITS.pace.max, Math.max(ITINERARY_LIMITS.pace.min, n))) : DEFAULT_PACE_KM);
