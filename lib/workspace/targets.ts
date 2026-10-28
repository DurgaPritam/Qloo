import type { Plan } from "@/lib/agent/types";
import type { CommentTarget } from "@/lib/db/schema";

export interface DecisionTarget {
  type: CommentTarget;
  id: string;
  label: string;
}

/**
 * The decisions in a plan that can carry comments: the plan itself, its chosen partner, city and
 * venue, and each sponsor. Ids are the plan's own (Qloo entity, city and place ids).
 */
export function planTargets(plan: Plan): DecisionTarget[] {
  const out: DecisionTarget[] = [{ type: "plan", id: plan.runId, label: "The whole plan" }];
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
  if (partner) out.push({ type: "partner", id: partner.id, label: `Partner: ${partner.name}` });
  const city = plan.city?.chosen?.pick.city;
  if (city) out.push({ type: "city", id: city.id, label: `City: ${plan.room?.cityName ?? city.name}` });
  const venue = plan.room?.venue?.pick.place;
  if (venue) out.push({ type: "venue", id: venue.id, label: `Venue: ${venue.name}` });
  for (const s of plan.room?.sponsors ?? []) out.push({ type: "sponsor", id: s.pick.brand.id, label: `Sponsor: ${s.pick.brand.name}` });
  return out;
}

export function isPlanTarget(plan: Plan, type: CommentTarget, id: string): boolean {
  return planTargets(plan).some((t) => t.type === type && t.id === id);
}
