import "server-only";

import { summariseAudience, type AudienceSummary } from "@/lib/engine/audience";
import type { Demographics } from "@/lib/engine/types";
import type { QlooSource } from "@/lib/qloo/source";

import { describeFailure, view, type CallView } from "./shared";

export interface AudienceProfile {
  entityId: string;
  raw: Demographics;
  summary: AudienceSummary;
}

/** One demographics call per entity (a combined signal would blend them). Missing ones are skipped. */
export async function audienceProfiles(
  entityIds: readonly string[],
  source: QlooSource,
  opts: { runId: string },
  calls: CallView[],
): Promise<AudienceProfile[]> {
  const out = await Promise.all(
    entityIds.map(async (id) => {
      try {
        const res = await source.demographics([id], opts);
        calls.push(view(res.meta));
        const d = res.data.find((x) => x.entityId === id) ?? res.data[0];
        return d ? { entityId: id, raw: d, summary: summariseAudience(d) } : null;
      } catch (err) {
        console.warn("[tools/audience] failed:", describeFailure(err));
        return null;
      }
    }),
  );
  return out.filter((p): p is AudienceProfile => p !== null);
}
