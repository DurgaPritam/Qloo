import type { Plan } from "@/lib/agent/types";
import type { Category } from "@/lib/engine/types";

/** What a card needs from a finished plan; every value comes from the stored run. */
export interface PlanSummary {
  query: string;
  runId: string;
  fanbase: string;
  category: Category;
  format: string;
  partner: string;
  partnerCategory: Category;
  city: string;
  country: string;
  /** Qloo rank 1; this is the city's rank by population among the candidates. */
  populationRank: number;
  venue: string | null;
  sponsors: string[];
  headline: string | null;
  recordedAt: string;
}

export function summarise(plan: Plan, recordedAt: string): PlanSummary | null {
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
  const city = plan.city?.chosen?.pick;
  if (plan.status !== "complete" || !plan.fanbase || !partner || !city || !plan.format) return null;
  return {
    query: plan.query,
    runId: plan.runId,
    fanbase: plan.fanbase.name,
    category: plan.fanbase.category,
    format: plan.format.label,
    partner: partner.name,
    partnerCategory: partner.category,
    city: plan.room?.cityName ?? city.city.name,
    country: city.city.country,
    populationRank: city.populationRank,
    venue: plan.room?.venue?.pick.place.name ?? null,
    sponsors: plan.room?.sponsors.map((s) => s.pick.brand.name) ?? [],
    headline: plan.brief?.headline ?? null,
    recordedAt,
  };
}
