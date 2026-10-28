import type { Plan } from "@/lib/agent/types";
import type { Prediction } from "@/lib/engine/outcomes";

/**
 * A plan's predictions, read from the plan exactly as the engine produced it: the chosen city with
 * its rank and combined score, the chosen partner with its rank and score, the venue and the
 * sponsors. Stored once when the plan is saved, so a later change to the engine never rewrites them.
 */
export function predictionsFromPlan(plan: Plan): Prediction {
  const chosenCity = plan.city?.chosen?.pick ?? null;
  const partnerPick = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick ?? null;
  const venue = plan.room?.venue?.pick ?? null;
  return {
    city: chosenCity
      ? {
          id: chosenCity.city.id,
          name: chosenCity.city.name,
          rank: chosenCity.rank,
          of: plan.city?.table.length ?? 0,
          combined: chosenCity.combined,
          confidence: chosenCity.confidence,
        }
      : null,
    partner: partnerPick
      ? { id: partnerPick.entity.id, name: partnerPick.entity.name, category: partnerPick.entity.category, rank: partnerPick.rank, score: partnerPick.score, confidence: partnerPick.confidence }
      : null,
    venue: venue ? { name: venue.place.name, confidence: venue.confidence } : null,
    sponsors: (plan.room?.sponsors ?? []).map((s) => ({ name: s.pick.brand.name, rank: s.pick.rank, score: s.pick.score })),
    market: plan.city?.market.code ?? null,
  };
}
