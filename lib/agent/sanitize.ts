import { TO_CONFIRM } from "./types";

export const TO_CONFIRM_SENTENCE = `Capacity, dates and prices are ${TO_CONFIRM}.`;

// Anything Qloo does not know. A sentence mentioning one is replaced, not edited.
const UNKNOWN_FACTS =
  /\b(capacit(y|ies)|seats?|seating|attendance|dates?|dated|schedul\w*|prices?|pricing|priced|costs?|fees?|budget|tickets?|availab\w*|sold[- ]out)\b/i;
const NUMBERISH = /[\d$£€¥₹%]/;
// "May" and "March" are left out: too common as ordinary words.
const CALENDAR =
  /\b(january|february|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow)\b/i;

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
