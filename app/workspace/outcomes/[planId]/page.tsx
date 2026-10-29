import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { OutcomeScreen } from "@/components/workspace/outcomes";
import { planOutcome } from "@/lib/outcomes/service";
import { can } from "@/lib/workspace/permissions";
import { featureAccess } from "@/lib/workspace/gate";
import { UpgradePrompt } from "@/components/workspace/upgrade";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Outcomes · Takeover", robots: { index: false } };

async function Content({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const found = await currentWorkspace();
  if (!found) redirect(`/signin?next=/workspace/outcomes/${encodeURIComponent(planId)}`);
  const data = /^[0-9a-f-]{36}$/.test(planId) ? await planOutcome(found.repo, planId) : null;
  if (!data) notFound();
  const access = await featureAccess(found.repo, "outcomes");
  return (
    <>
      {access.upgrade && <UpgradePrompt upgrade={access.upgrade} compact />}
      <OutcomeScreen key={data.outcome?.loggedAt ?? "new"} initial={data} canLog={can(found.ctx.role, "outcome.log") && access.allowed} />
    </>
  );
}

export default function PlanOutcomePage({ params }: PageProps<"/workspace/outcomes/[planId]">) {
  return (
    <>
      <Link href="/workspace/outcomes" className="pt-4 text-chip text-mute">
        ← Outcomes
      </Link>
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}
