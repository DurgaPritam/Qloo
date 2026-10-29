import { beforeEach, describe, expect, it } from "vitest";

import { RUN_TOUR, TOUR_STORAGE_KEY } from "@/lib/features";
import { markTourSeen, resetTourMemory, tourAutoStarts, tourSeen, tourStep } from "@/lib/onboarding/tour";

const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};
const total = RUN_TOUR.length;

beforeEach(() => resetTourMemory());

describe("the run tour", () => {
  it("shows once per browser: it starts by itself until it has been finished or skipped", () => {
    const s = memoryStorage();
    expect(tourAutoStarts(s, TOUR_STORAGE_KEY, false)).toBe(true);
    let step: number | null = tourStep(null, "start", total).step;
    for (let i = 1; i < total; i++) step = tourStep(step, "next", total).step;
    expect(step).toBe(total - 1);
    const done = tourStep(step, "next", total);
    expect(done).toEqual({ step: null, finished: true });
    markTourSeen(s, TOUR_STORAGE_KEY);
    expect(tourAutoStarts(s, TOUR_STORAGE_KEY, false)).toBe(false);
  });

  it("can be skipped at any step, which also counts as seen", () => {
    for (let at = 0; at < total; at++) expect(tourStep(at, "skip", total)).toEqual({ step: null, finished: true });
    expect(tourStep(null, "skip", total)).toEqual({ step: null, finished: false });
  });

  it("restarts on request, even after it was seen (help panel, ?tour=1)", () => {
    const s = memoryStorage();
    markTourSeen(s, TOUR_STORAGE_KEY);
    expect(tourAutoStarts(s, TOUR_STORAGE_KEY, true)).toBe(true);
    expect(tourStep(null, "start", total).step).toBe(0);
    expect(tourStep(3, "start", total).step).toBe(0);
  });

  it("Back stops at the first tip; Next past the last closes it", () => {
    expect(tourStep(0, "back", total).step).toBe(0);
    expect(tourStep(2, "back", total).step).toBe(1);
    expect(tourStep(null, "next", total)).toEqual({ step: null, finished: false });
  });

  it("survives blocked storage: shown once for the page instead of failing", () => {
    expect(tourSeen(blocked, TOUR_STORAGE_KEY)).toBe(false);
    expect(() => markTourSeen(blocked, TOUR_STORAGE_KEY)).not.toThrow();
    expect(tourSeen(blocked, TOUR_STORAGE_KEY)).toBe(true);
    expect(tourSeen(null, TOUR_STORAGE_KEY)).toBe(true);
  });
});
