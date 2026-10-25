import type { RunState } from "./state";

/**
 * Template prose, used when the model leaves a field empty and by the scripted planner.
 * Placeholders only; names are filled in by code.
 */
export const BRIEF_TEMPLATES = {
  headline: "A {format} that brings {fanbase} fans and {partner} fans together in {city}.",
  partnerReason: "{partner} fans over-index on {fanbase}, so the pairing reaches both audiences at once.",
  cityReason: "{city} is where both audiences are strong together, not just where the most people live.",
  venueReason: "{venue} draws the combined audience in {city}.",
  sponsorReason: "{sponsors} already resonate with this shared audience.",
} as const;

export const OUTREACH_TEMPLATES = {
  partnerSubject: "{fanbase} × {partner}: a {format} in {city}",
  partnerBody:
    "Hi {partner} team,\n\nTaste data shows a strong shared audience between {fanbase} and {partner}, " +
    "and {city} is where that overlap is strongest. We'd love to explore a joint {format} at {venue}. " +
    "Capacity, dates and terms are to confirm with the promoter.\n\nWould you be open to a short call?",
  venueSubject: "Hold enquiry: {fanbase} × {partner} {format}",
  venueBody:
    "Hello,\n\nWe're planning a {format} pairing {fanbase} with {partner} in {city}, and {venue} fits " +
    "the shared audience well. Capacity, dates and pricing are to confirm with the promoter.\n\n" +
    "Could you tell us who handles bookings?",
} as const;

export interface ScriptedCall {
  name: string;
  input: Record<string, unknown>;
}

/**
 * The next tool call(s) in the seven-step order, for the scripted planner and for finishing a
 * run by code. Widening is tried once where the last result asked for it.
 */
export function nextScriptedCalls(state: RunState): ScriptedCall[] {
  if (state.stopped) return [];
  const calls = nextCalls(state);
  // A step that already errored is not retried: the run finishes with what exists, labelled.
  return calls.some((c) => state.failed.has(c.name)) ? [] : calls;
}

function nextCalls(state: RunState): ScriptedCall[] {
  if (!state.match && !state.fanbase) return [{ name: "resolve_fanbase", input: {} }];
  if (!state.fanbase) return state.needsInput ? [{ name: "ask_user", input: {} }] : [];
  if (!state.format) return [{ name: "choose_format", input: {} }, { name: "find_partners", input: {} }];
  if (!state.partners) return [{ name: "find_partners", input: {} }];
  if (state.partners.fallback && !state.partnersWidened && !state.city) {
    return [{ name: "find_partners", input: { widen: true } }];
  }
  if (!state.partner) return [];
  if (!state.city) return [{ name: "pick_city", input: {} }];
  if (state.city.fallback && !state.cityWidened && !state.room) {
    return [{ name: "pick_city", input: { level: "region" } }];
  }
  if (!state.chosenCity) return [];
  if (!state.room) return [{ name: "plan_room", input: {} }];
  if (!state.brief) return [{ name: "write_brief", input: {} }];
  if (!state.outreach) return [{ name: "draft_outreach", input: {} }];
  return [];
}
