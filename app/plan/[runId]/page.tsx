import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SharedPlan } from "@/components/run/shared-plan";
import { Page, Skeleton } from "@/components/ui";
import { summarise } from "@/lib/plan-summary";
import { loadPlan } from "@/lib/server/plan-store";

export async function generateMetadata({ params }: PageProps<"/plan/[runId]">): Promise<Metadata> {
  const { runId } = await params;
  const plan = /^[0-9a-f-]{36}$/.test(runId) ? await loadPlan(runId) : null;
  const s = plan ? summarise(plan, "") : null;
  if (!s) return { title: "Shared plan · Takeover" };
  const title = `${s.fanbase} × ${s.partner} in ${s.city} · Takeover`;
  const description = `${s.format}: ${s.partner} (${s.partnerCategory.replace("_", " ")}) in ${s.city}${s.venue ? ` at ${s.venue}` : ""}. Every pick from Qloo taste data.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

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
