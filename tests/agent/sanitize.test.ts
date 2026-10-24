import { describe, expect, it } from "vitest";

import { fillSlots, safeProse, sanitizeProse, TO_CONFIRM_SENTENCE } from "@/lib/agent/sanitize";

describe("sanitizeProse", () => {
  it("keeps plain prose", () => {
    expect(sanitizeProse("Both audiences love live comedy. They travel for it.")).toEqual({
      text: "Both audiences love live comedy. They travel for it.",
      replaced: 0,
    });
  });

  it.each([
    "The room holds 2,500 people.",
    "Tickets start at $45.",
    "We could do it on 14 March.",
    "Pencil it in for Friday.",
    "Capacity is generous.",
    "Prices will be competitive.",
    "The hall is available next spring.",
    "It sold out last time.",
  ])("replaces %j", (sentence) => {
    expect(sanitizeProse(`Great fit. ${sentence}`)).toEqual({
      text: `Great fit. ${TO_CONFIRM_SENTENCE}`,
      replaced: 1,
    });
  });

  it("collapses consecutive replacements and ignores non-strings", () => {
    expect(sanitizeProse("Capacity is big. Dates are open. Fans are keen.").text).toBe(
      `${TO_CONFIRM_SENTENCE} Fans are keen.`,
    );
    expect(sanitizeProse(undefined)).toEqual({ text: "", replaced: 0 });
  });
});

describe("fillSlots / safeProse", () => {
  it("fills names after sanitising, so digits in names survive", () => {
    expect(safeProse("Pair {fanbase} with {partner}.", { fanbase: "Blink-182", partner: "Sum 41" }, "")).toEqual({
      text: "Pair Blink-182 with Sum 41.",
      replaced: 0,
    });
  });

  it("drops unknown slots and uses the fallback for empty prose", () => {
    expect(fillSlots("Hi {nobody} there.", {})).toBe("Hi there.");
    expect(safeProse("", { city: "Leeds" }, "Welcome to {city}.").text).toBe("Welcome to Leeds.");
  });
});

describe("paragraphs", () => {
  it("keeps paragraph breaks through sanitising and slot filling", () => {
    const body = "Hi {partner} team,\n\nOur fans overlap.  A lot.\n\nTickets are $40.\n\nTalk soon?";
    expect(safeProse(body, { partner: "Velvet" }, "").text).toBe(
      `Hi Velvet team,\n\nOur fans overlap. A lot.\n\n${TO_CONFIRM_SENTENCE}\n\nTalk soon?`,
    );
  });
});
