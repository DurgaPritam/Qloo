import "server-only";

import { cityIndex, foldPlace, matchCity, type CityIndex } from "@/lib/engine/city-match";
import { CITIES } from "@/lib/engine/data";
import { findCity } from "@/lib/engine/local";
import { countryCode } from "@/lib/engine/markets";
import type { City } from "@/lib/engine/types";
import { MAX_OUTPUT_TOKENS } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";
import { metroPool } from "@/lib/tools/shared";

import { validateOps, type CityResolution, type EditOp, type Rejected } from "./edits";
import { computeSchedule } from "./schedule";
import type { Itinerary, StopCity } from "./types";

/**
 * The AI edit box: the model turns the user's instruction into edit ops from a fixed schema; code
 * checks every op (lib/itinerary/edits.ts validateOps), resolves cities against the city list and
 * applies nothing itself. The summary shown is built from the checked ops, not the model's words,
 * and no number in an op is taken unless the user typed it.
 */

export type AiEditResult =
  | { status: "ok"; ops: EditOp[]; rejected: Rejected[]; summary: string; model: string }
  | { status: "fallback"; reason: string };

export const AI_FALLBACK = "The AI edit didn't run, so nothing changed. You can edit every field directly.";

let index: CityIndex | undefined;
const cities = () => (index ??= cityIndex(CITIES, metroPool()));
const asStop = (c: City): StopCity => ({ id: c.id, name: c.name, admin1: c.admin1, country: c.country, lat: c.lat, lon: c.lon });

/**
 * A typed city to a real city: exact (with region or country), else typo-tolerant. A tour stop is
 * the town the user named, so a town the metro list folds into a bigger one (Boulder into Denver)
 * stays itself; Qloo suggestions for it are asked by its own name and region.
 */
export function resolveCityName(name: string): CityResolution {
  const m = matchCity(name, cities(), { countryCode: (n) => countryCode(n) });
  if (m.status === "matched") {
    const named = m.note ? findCity(name, CITIES) : null;
    return { status: "matched", city: asStop(named && foldPlace(named.name) === foldPlace(name.split(",")[0]) ? named : m.city) };
  }
  if (m.status === "ambiguous") return { status: "ambiguous", options: m.options.slice(0, 3).map((c) => [c.name, c.admin1 || c.country].filter(Boolean).join(", ")) };
  const near = findCity(name, metroPool());
  return near ? { status: "matched", city: asStop(cities().metroOf(near)) } : { status: "unmatched" };
}

const SCHEMA = `Each op is one JSON object. Allowed ops (city = a city name as the user wrote it):
{"op":"add_stop","city":string,"after"?:city on the tour,"position"?:number|"start"|"end"}
{"op":"remove_stop","city":string}
{"op":"move_stop","city":string,"after"?:city,"position"?:number|"start"|"end"}
{"op":"replace_city","city":string,"with":string}
{"op":"set_start_date","date":"YYYY-MM-DD"}
{"op":"set_date","city":string,"date":"YYYY-MM-DD"}
{"op":"clear_date","city":string}
{"op":"shift_dates","days":number}   (positive = later; a week is 7)
{"op":"set_shows","city":string,"shows":number}
{"op":"set_rest_after","city":string,"days":number}
{"op":"add_rest_days","city":string,"days":number}   (for "add a rest day after X")
{"op":"set_pace","kmPerDay":number}
{"op":"set_field","city":string,"field":"venue"|"support"|"sponsor"|"notes","value":string}
{"op":"add_contact","city":string,"role":string,"name":string,"email"?:string,"phone"?:string}
{"op":"remove_contact","city":string,"name":string}
{"op":"rename","name":string}`;

export function editPrompt(it: Itinerary, instruction: string, today: string): string {
  const s = computeSchedule(it);
  const stops = it.stops
    .map((x, i) => {
      const when = x.date ? `date ${x.date} (set by user)` : s.stops[i].first ? `draft date ${s.stops[i].first}` : "no date";
      const fields = [x.venue && `venue ${x.venue.name}`, x.support && `support ${x.support.name}`, x.sponsor && `sponsor ${x.sponsor.name}`, x.contacts.length && `contacts ${x.contacts.map((c) => c.name).join(", ")}`].filter(Boolean).join("; ");
      return `${i + 1}. ${x.city.name}${x.city.admin1 ? `, ${x.city.admin1}` : ""} · ${when} · ${x.shows} show(s) · ${x.restAfter} rest day(s) after${fields ? ` · ${fields}` : ""}`;
    })
    .join("\n");
  return [
    "You turn a tour planner's instruction into edit operations on their tour. Return ONLY a JSON object:",
    '{"ops":[...]} with no Markdown and no other text. Use only these ops:',
    SCHEMA,
    "Rules: use only cities, names, emails, phone numbers, dates and numbers that appear in the instruction or the tour below.",
    "Never invent a date, a number, a venue or a contact. Return one op for each part of the instruction you can express; leave out only the parts these ops cannot do or that are unclear (return {\"ops\":[]} if none).",
    "Dates are YYYY-MM-DD with the day and month the user wrote. Numbers are the ones the user wrote (a week is 7 days).",
    `Today is ${today}. Tour start date: ${it.startDate || "not set"}. Pace: ${it.kmPerTravelDay} km per travel day.`,
    `Tour "${it.name}" for ${it.fanbase.name}, in order:`,
    stops || "(no stops)",
    `Instruction: ${JSON.stringify(instruction)}`,
  ].join("\n");
}

/** The ops array from the model's text (bare JSON, fenced JSON or JSON inside prose); null when unparseable. */
export function parseModelOps(text: string): unknown[] | null {
  const body = text.replace(/```(?:json)?/gi, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  // A bare array first; otherwise the outermost object, then any array inside prose.
  let parsed = body.startsWith("[") ? tryParse(body) : undefined;
  if (parsed === undefined && start >= 0 && end > start) parsed = tryParse(body.slice(start, end + 1));
  if (parsed === undefined) {
    const a = body.indexOf("[");
    const b = body.lastIndexOf("]");
    parsed = a >= 0 && b > a ? tryParse(body.slice(a, b + 1)) : undefined;
  }
  if (Array.isArray(parsed)) return parsed;
  const ops = (parsed as { ops?: unknown } | undefined)?.ops;
  // Unknown ops are kept here and rejected, with a reason, by validateOps.
  return Array.isArray(ops) ? ops : null;
}

/**
 * Sample mode without a model: a deterministic reading of a few phrasings, so the box can be
 * tried. "remove X", "push everything back N days|weeks", "pull everything forward N days".
 */
export function sampleOps(instruction: string): unknown[] {
  const t = instruction.trim();
  const remove = t.match(/^(?:remove|drop|cut)\s+(.+)$/i);
  if (remove) return [{ op: "remove_stop", city: remove[1].trim() }];
  const shift = t.match(/\b(?:push|move|shift)\s+everything\s+(back|later|forward|earlier)\s+(?:by\s+)?(\d+|a|one|two|three)\s+(days?|weeks?)\b/i);
  if (shift) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[shift[2].toLowerCase() as "a"] ?? Number(shift[2]);
    const days = n * (shift[3].toLowerCase().startsWith("week") ? 7 : 1);
    return [{ op: "shift_dates", days: /back|later/i.test(shift[1]) ? days : -days }];
  }
  return [];
}

const summarise = (ops: EditOp[], rejected: Rejected[]) =>
  [ops.length ? `${ops.length} change${ops.length === 1 ? "" : "s"}: ${ops.map((o) => o.label).join("; ")}.` : "No changes.", rejected.length ? `${rejected.length} not applied.` : ""].filter(Boolean).join(" ");

/**
 * Throws TokenBudgetExceededError when today's model budget is spent (the route labels it);
 * every other failure is a labelled fallback.
 */
export async function aiEdit(it: Itinerary, instruction: string, { provider, mock, today }: { provider: LLMProvider | null; mock: boolean; today: string }): Promise<AiEditResult> {
  let raw: unknown[] | null;
  let model = "sample";
  if (!provider) {
    if (!mock) return { status: "fallback", reason: `No AI model is configured. ${AI_FALLBACK}` };
    raw = sampleOps(instruction);
  } else {
    const res = await provider.complete(editPrompt(it, instruction, today), { maxOutputTokens: MAX_OUTPUT_TOKENS.completion });
    model = res.model ?? provider.model;
    if (res.refused) return { status: "fallback", reason: `The model declined. ${AI_FALLBACK}` };
    raw = parseModelOps(res.text);
    if (!raw) return { status: "fallback", reason: `The model's answer couldn't be read. ${AI_FALLBACK}` };
  }
  const { ops, rejected } = validateOps(it, raw, instruction, resolveCityName, today);
  if (!ops.length && !rejected.length) return { status: "ok", ops, rejected, summary: "The planner couldn't turn that into a change. Try naming a city on the tour, or edit the fields directly.", model };
  return { status: "ok", ops, rejected, summary: summarise(ops, rejected), model };
}
