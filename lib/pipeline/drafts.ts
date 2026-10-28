import "server-only";

import { createHash } from "node:crypto";

import type { Plan } from "@/lib/agent/types";
import type { PitchInput } from "@/lib/export/sponsor";

import type { OutreachKind } from "./stages";

/**
 * Pipeline cards from what Takeover already wrote: a plan's two emails, or a shortlisted sponsor
 * match. No model call and no figures; anything commercial stays "to confirm".
 */
export interface NewCard {
  sourceKey: string;
  kind: OutreachKind;
  context: string;
  recipient: string;
  subject: string;
  body: string;
}

export function planContext(plan: Plan): string {
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity.name;
  const pair = [plan.fanbase?.name ?? plan.query, partner].filter(Boolean).join(" × ");
  return plan.room?.cityName ? `${pair} · ${plan.room.cityName}` : pair;
}

export function cardsFromPlan(planId: string, plan: Plan): NewCard[] {
  const context = planContext(plan);
  return (plan.outreach ?? []).map((m) => ({ sourceKey: `plan:${planId}:${m.to}`, kind: m.to, context, recipient: m.recipient, subject: m.subject, body: m.body }));
}

export function cardFromMatch(matchId: string, pitch: PitchInput): NewCard {
  const sector = pitch.sector ? ` in ${pitch.sector.toLowerCase()}` : "";
  return {
    sourceKey: `sponsor:${matchId}`,
    kind: "sponsor",
    context: `${pitch.holder} × ${pitch.brand}`,
    recipient: `${pitch.brand} partnerships`,
    subject: `${pitch.holder} × ${pitch.brand}: a partnership idea`,
    body: [
      `Hi ${pitch.brand} team,`,
      `I work with ${pitch.holder}. Qloo's taste data shows that ${pitch.holder}'s fans have a strong affinity for ${pitch.brand}${sector}, and we think there is a natural partnership here.`,
      `We would love to talk about what it could look like. Formats, dates and terms are all to confirm together, and I can share the audience evidence behind the match.`,
      `Would you have time for a short call in the next few weeks?`,
      `Best,`,
    ].join("\n\n"),
  };
}

/** The hash of exactly what the user sees: a move to "sent" is refused if the draft changed since. */
export function contentHash(c: { recipient: string; recipientEmail: string | null; subject: string; body: string }): string {
  return createHash("sha256").update(JSON.stringify([c.recipient, c.recipientEmail ?? "", c.subject, c.body])).digest("hex");
}
