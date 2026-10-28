"use client";

import Link from "next/link";

import type { Plan } from "@/lib/agent/types";

import { AppHeader, Banner, Page } from "../ui";
import { BriefSection, CitySection, CrossoverSection, OutreachSection, RoomSection } from "./sections";
import { viewFromPlan } from "./use-plan-stream";
import { AudiencePanel } from "../audience";
import { TeamVote } from "../team-vote";
import { audiencePeople } from "./run-screen";
import { PlanComments } from "../workspace/plan-comments";
import { PlanSharing, type MemberView } from "../workspace/plan-sharing";
import { AddToPipeline } from "../workspace/pipeline-add";
import { PlanYourData } from "../workspace/your-data";

/**
 * A finished plan opened from its link. Workspace members also get the sharing control and the
 * team's comment threads; everyone else sees the read-only plan.
 */
export function SharedPlan({ plan, member }: { plan: Plan; member?: MemberView }) {
  const view = viewFromPlan(plan);
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity.name;
  return (
    <Page max="max-w-[1040px]">
      <AppHeader context={`${plan.fanbase?.name ?? plan.query}${partner ? ` × ${partner}` : ""} · ${member ? member.workspaceName : "Shared plan"}`} />
      {member && <PlanSharing planId={plan.runId} member={member} />}
      {member && plan.status === "complete" && (
        <Banner tone="neutral" action={<Link href={`/workspace/outcomes/${plan.runId}`}>Log results →</Link>}>
          Event done? Log what happened and compare it with this plan&apos;s predictions.
        </Banner>
      )}
      {plan.status !== "complete" && <Banner tone="warn">This plan is partial: some steps could not finish.</Banner>}
      {plan.notes.length > 0 && <Banner tone="neutral">{plan.notes.join(" ")}</Banner>}
      {plan.status === "complete" && <TeamVote plan={plan} />}
      <CrossoverSection view={view} />
      {plan.status === "complete" && !plan.mock && <AudiencePanel people={audiencePeople(view)} />}
      <CitySection view={view} extra={member ? <PlanYourData planId={plan.runId} chosenCityId={plan.city?.chosen?.pick.city.id} /> : undefined} />
      <RoomSection view={view} />
      <BriefSection view={view} shareUrl={typeof window !== "undefined" ? window.location.href : undefined} />
      <OutreachSection view={view} action={member && plan.outreach?.length ? <AddToPipeline planId={plan.runId} /> : undefined} />
      {member && <PlanComments planId={plan.runId} />}
    </Page>
  );
}
