import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SharedPlan } from "@/components/run/shared-plan";
import { Page, Skeleton } from "@/components/ui";
import { summarise } from "@/lib/plan-summary";
import { loadPlan } from "@/lib/server/plan-store";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace, planForRequest, visiblePlan } from "@/lib/workspace/session";

export async function generateMetadata({ params }: PageProps<"/plan/[runId]">): Promise<Metadata> {
  const { runId } = await params;
  // Private plans get a generic title: link previews are fetched by people outside the workspace.
  const plan = await visiblePlan(runId);
  const s = plan ? summarise(plan, "") : null;
  if (!s) return { title: "Shared plan · Takeover" };
  const title = `${s.fanbase} × ${s.partner} in ${s.city} · Takeover`;
  const description = `${s.format}: ${s.partner} (${s.partnerCategory.replace("_", " ")}) in ${s.city}${s.venue ? ` at ${s.venue}` : ""}. Every pick from Qloo taste data.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

async function PlanLoader({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const access = /^[0-9a-f-]{36}$/.test(runId) ? await planForRequest(runId, loadPlan) : null;
  // 404 rather than 403, so a private plan's existence is not revealed.
  if (!access) notFound();
  if (access.kind !== "member") return <SharedPlan plan={access.plan} />;
  const found = await currentWorkspace();
  const user = found?.user.id;
  const workspaceName = found?.memberships.find((m) => m.workspaceId === access.workspaceId)?.name ?? "your workspace";
  const canShare = can(access.role, "plan.share.any") || (can(access.role, "plan.share.own") && access.createdBy === user);
  return <SharedPlan plan={access.plan} member={{ workspaceName, visibility: access.visibility, canShare }} />;
}

export default function SharedPlanPage({ params }: PageProps<"/plan/[runId]">) {
  return (
    <Suspense
      fallback={
        <Page max="max-w-[1040px]">
          <Skeleton className="h-[26px] w-[45%] rounded-btn" />
          <Skeleton className="h-[84px] w-full rounded-md" />
        </Page>
      }
    >
      <PlanLoader params={params} />
    </Suspense>
  );
}
