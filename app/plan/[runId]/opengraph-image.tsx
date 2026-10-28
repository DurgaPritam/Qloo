import { connection } from "next/server";

import { categoryLabel } from "@/components/run/format";
import { ogCard, OG_SIZE } from "@/lib/og";
import { summarise } from "@/lib/plan-summary";
import { visiblePlan } from "@/lib/workspace/session";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A Takeover plan";

/** The card shown when a plan link is posted: fanbase × partner, city, venue. All from the plan. */
export default async function Image({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { runId } = await params;
  // Private workspace plans get the generic card: crawlers are never members.
  const plan = await visiblePlan(runId);
  const s = plan ? summarise(plan, "") : null;
  if (!s) return ogCard({ kicker: "Event plans backed by taste data", title: "Takeover", lines: ["Pick a talent. Find the city. Get the plan."] });
  return ogCard({
    kicker: s.format,
    title: `${s.fanbase} × ${s.partner}`,
    lines: [
      `${categoryLabel(s.partnerCategory)} partner · ${s.city}${s.venue ? ` · ${s.venue}` : ""}`,
      s.populationRank > 1 ? `Qloo's #1 city for both audiences · #${s.populationRank} by population` : "Qloo's #1 city for both audiences",
    ],
    badge: "◆ Every pick from Qloo taste data",
  });
}
