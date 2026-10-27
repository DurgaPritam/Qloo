"use client";

import type { Plan } from "@/lib/agent/types";

import { AppHeader, Banner, Page } from "../ui";
import { BriefSection, CitySection, CrossoverSection, OutreachSection, RoomSection } from "./sections";
import { viewFromPlan } from "./use-plan-stream";
import { AudiencePanel } from "../audience";
import { TeamVote } from "../team-vote";
import { audiencePeople } from "./run-screen";

/** Read-only view of a finished plan, opened from a "Copy link" share URL. */
export function SharedPlan({ plan }: { plan: Plan }) {
  const view = viewFromPlan(plan);
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity.name;
  return (
    <Page max="max-w-[1040px]">
      <AppHeader context={`${plan.fanbase?.name ?? plan.query}${partner ? ` × ${partner}` : ""} · Shared plan`} />
      {plan.status !== "complete" && <Banner tone="warn">This plan is partial: some steps could not finish.</Banner>}
      {plan.notes.length > 0 && <Banner tone="neutral">{plan.notes.join(" ")}</Banner>}
      {plan.status === "complete" && <TeamVote plan={plan} />}
      <CrossoverSection view={view} />
      {plan.status === "complete" && !plan.mock && <AudiencePanel people={audiencePeople(view)} />}
      <CitySection view={view} />
      <RoomSection view={view} />
      <BriefSection view={view} shareUrl={typeof window !== "undefined" ? window.location.href : undefined} />
      <OutreachSection view={view} />
    </Page>
  );
}
