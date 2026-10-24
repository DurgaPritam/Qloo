import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SharedPlan } from "@/components/run/shared-plan";
import { Page, Skeleton } from "@/components/ui";
import { loadPlan } from "@/lib/server/plan-store";

export const metadata: Metadata = { title: "Shared plan · Takeover" };

async function PlanLoader({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const plan = /^[0-9a-f-]{36}$/.test(runId) ? await loadPlan(runId) : null;
  if (!plan) notFound();
  return <SharedPlan plan={plan} />;
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
