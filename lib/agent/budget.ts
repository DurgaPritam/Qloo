import "server-only";

import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource, SourceResult } from "@/lib/qloo/source";

export interface BudgetedSource extends QlooSource {
  /** Uncached calls made so far. */
  used(): number;
}

/**
 * Counts uncached calls per run and refuses the next one once `limit` is reached. The real
 * client enforces the same cap; this also covers the mock source and keeps one count for the UI.
 */
export function withBudget(source: QlooSource, runId: string, limit = QLOO_RUN_BUDGET): BudgetedSource {
  let used = 0;

  async function guard<T>(endpoint: string, call: () => Promise<SourceResult<T>>) {
    if (used >= limit) throw new BudgetExceededError({ endpoint, params: {}, runId, limit });
    const res = await call();
    if (!res.meta.cached) used++;
    return res;
  }

  return {
    mock: source.mock,
    used: () => used,
    searchEntities: (...a) => guard("/search", () => source.searchEntities(...a)),
    candidates: (...a) => guard("/v2/insights", () => source.candidates(...a)),
    heatmap: (...a) => guard("/v2/insights", () => source.heatmap(...a)),
    places: (...a) => guard("/v2/insights", () => source.places(...a)),
    brands: (...a) => guard("/v2/insights", () => source.brands(...a)),
  };
}
