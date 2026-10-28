import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { LineupOptimizer } from "@/components/workspace/lineup";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Lineup optimizer · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/lineup");
  const plans = (await found.repo.plans.list(50)).flatMap((p) => {
    const plan = p.result;
    return plan.fanbase ? [{ id: p.id, label: `${plan.fanbase.name}${plan.room?.cityName ? ` · ${plan.room.cityName}` : ""}` }] : [];
  });
  return <LineupOptimizer plans={plans} canEdit={can(found.ctx.role, "plan.create")} />;
}

export default function LineupPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[360px] w-full rounded-lg" />}>
      <Content />
    </Suspense>
  );
}
