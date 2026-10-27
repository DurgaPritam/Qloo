import type { PlanSummary } from "./plan-summary";

/** Plans this browser made, newest first. Kept in localStorage: no account, nothing on our server. */
export interface SavedPlan extends PlanSummary {
  savedAt: string;
  /** The visitor's own name for it; defaults to "fanbase × partner". */
  title?: string;
  mock: boolean;
}

const KEY = "takeover:plans:v1";
const MAX = 50;

export function loadSaved(): SavedPlan[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as SavedPlan[]) : [];
  } catch {
    return [];
  }
}

function write(plans: SavedPlan[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(plans.slice(0, MAX)));
  } catch {
    // Storage full or blocked (private mode): the list is just not kept.
  }
}

/** Adds or refreshes a plan; one entry per fanbase × partner × city, so replays do not pile up. */
export function savePlanLocally(plan: SavedPlan): SavedPlan[] {
  const same = (p: SavedPlan) => p.runId === plan.runId || (p.fanbase === plan.fanbase && p.partner === plan.partner && p.city === plan.city);
  const existing = loadSaved();
  const kept = existing.find(same);
  const next = [{ ...plan, title: kept?.title }, ...existing.filter((p) => !same(p))];
  write(next);
  return next;
}

export function removeSaved(runId: string): SavedPlan[] {
  const next = loadSaved().filter((p) => p.runId !== runId);
  write(next);
  return next;
}

export function renameSaved(runId: string, title: string): SavedPlan[] {
  const next = loadSaved().map((p) => (p.runId === runId ? { ...p, title: title.trim() || undefined } : p));
  write(next);
  return next;
}
