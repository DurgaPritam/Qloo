/**
 * The run screen's guided tour, as plain state so it can be tested without a browser: it starts
 * once per browser (a localStorage flag, read and written in try/catch), can be skipped at any
 * step, and restarts on request.
 */
type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

// When storage is blocked (private mode), remember for this page's lifetime instead.
let seenInMemory = false;

export function tourSeen(storage: Store, key: string): boolean {
  try {
    if (storage?.getItem(key)) return true;
  } catch {
    // fall through to memory
  }
  return seenInMemory;
}

export function markTourSeen(storage: Store, key: string): void {
  seenInMemory = true;
  try {
    storage?.setItem(key, "1");
  } catch {
    // memory only
  }
}

/** Test hook: forget the in-memory flag. */
export const resetTourMemory = () => void (seenInMemory = false);

export type TourAction = "start" | "next" | "back" | "skip";

/** The step after an action, or null when the tour is closed; `finished` says to remember it as seen. */
export function tourStep(step: number | null, action: TourAction, total: number): { step: number | null; finished: boolean } {
  switch (action) {
    case "start":
      return { step: 0, finished: false };
    case "skip":
      return { step: null, finished: step !== null };
    case "back":
      return { step: step === null ? null : Math.max(0, step - 1), finished: false };
    case "next":
      if (step === null) return { step: null, finished: false };
      return step < total - 1 ? { step: step + 1, finished: false } : { step: null, finished: true };
  }
}

/** Whether the tour should open by itself when a run finishes: first visit, or asked for (?tour=1). */
export const tourAutoStarts = (storage: Store, key: string, asked: boolean) => asked || !tourSeen(storage, key);
