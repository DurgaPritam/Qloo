import { TO_CONFIRM } from "./types";

export const TO_CONFIRM_SENTENCE = `Capacity, dates and prices are ${TO_CONFIRM}.`;

const words = (list: string[]) => new RegExp(`\\b(${list.join("|")})\\b`, "i");

// Anything Qloo does not know. A sentence mentioning one is replaced, not edited.
const UNKNOWN_FACTS = words([
  "capacity",
  "capacities",
  "seats?",
  "seating",
  "attendance",
  "dates?",
  "dated",
  "schedul\\w*",
  "prices?",
  "pricing",
  "priced",
  "costs?",
  "fees?",
  "budget",
  "tickets?",
  "availab\\w*",
  "sold[- ]out",
]);
// Capacity stated without the word: "holds 20,000", "5k fans".
const HEADCOUNT = /\d[\d,.]*\s*(k|people|fans|attendees|guests|spectators)\b|\b(holds|fits|accommodates)\b.*\d/i;
const MONEY = /[$£€¥₹]/;
const NUMBERISH = /[\d$£€¥₹%]/;
// "May" and "March" are left out: too common as ordinary words.
const CALENDAR = words([
  "january",
  "february",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tonight",
  "tomorrow",
]);

const MAX_FIELD_CHARS = 900;

/**
 * Makes model prose safe to show: any sentence with a number, a calendar word, or a mention of
 * capacity, dates, prices or availability becomes the fixed "to confirm" sentence.
 * Run this before filling names in, so digits in real names are not affected.
 */
export function sanitizeProse(text: unknown): { text: string; replaced: number } {
  if (typeof text !== "string") return { text: "", replaced: 0 };
  const sentences = text
    .slice(0, MAX_FIELD_CHARS)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  let replaced = 0;
  const out: string[] = [];
  for (const sentence of sentences) {
    const unsafe = NUMBERISH.test(sentence) || CALENDAR.test(sentence) || UNKNOWN_FACTS.test(sentence);
    if (!unsafe) {
      out.push(sentence);
      continue;
    }
    replaced++;
    if (out.at(-1) !== TO_CONFIRM_SENTENCE) out.push(TO_CONFIRM_SENTENCE);
  }
  return { text: out.join(" "), replaced };
}

/**
 * Lighter pass for the LLM-only comparison: keeps the chatbot's own wording and most numbers,
 * but still replaces sentences about capacity, dates, prices or availability.
 */
export function stripUnknownFacts(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const unsafe = [UNKNOWN_FACTS, HEADCOUNT, MONEY, CALENDAR].some((re) => re.test(sentence));
        if (!unsafe) out.push(sentence);
        else if (out.at(-1) !== TO_CONFIRM_SENTENCE) out.push(TO_CONFIRM_SENTENCE);
      }
      return out.join(" ");
    })
    .join("\n")
    .trim();
}

export type Slots = Record<string, string>;

/** Replaces {slot} placeholders with names from engine data. Unknown slots are removed. */
export function fillSlots(text: string, slots: Slots): string {
  return text
    .replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** sanitizeProse then fillSlots, with a fallback when the model left the field empty. */
export function safeProse(text: unknown, slots: Slots, fallback: string): { text: string; replaced: number } {
  const clean = sanitizeProse(text);
  const body = clean.text || fallback;
  return { text: fillSlots(body, slots), replaced: clean.replaced };
}
