import "server-only";

import { SHOWCASE } from "@/lib/examples";
import { summarise, type PlanSummary } from "@/lib/plan-summary";

import { loadRecording } from "./replay";

export type { PlanSummary };

/** The preloaded runs that exist in this deployment, in SHOWCASE order. Missing ones are skipped. */
export async function loadShowcase(names: readonly string[] = SHOWCASE): Promise<PlanSummary[]> {
  const recordings = await Promise.all(names.map((n) => loadRecording(n)));
  return recordings.flatMap((r) => {
    const s = r ? summarise(r.plan, r.recordedAt) : null;
    return s ? [s] : [];
  });
}
