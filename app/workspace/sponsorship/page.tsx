import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppHeader, Page, Skeleton } from "@/components/ui";
import { SponsorshipScreen } from "@/components/workspace/sponsorship";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { can, ROLE_LABEL } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Sponsorship · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/sponsorship");
  const { ctx, repo, memberships } = found;
  const current = memberships.find((m) => m.workspaceId === ctx.workspaceId)!;
  const [plans, rosters, shortlist] = await Promise.all([repo.plans.list(50), repo.rosters.list(), repo.sponsorship.shortlist()]);
  const events = plans.flatMap((p) => {
    const plan = p.result;
    const partner = plan.partners?.picks.find((x) => x.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
    return plan.fanbase && partner ? [{ id: p.id, label: `${plan.fanbase.name} × ${partner.name}${plan.room?.cityName ? `, ${plan.room.cityName}` : ""}` }] : [];
  });
  return (
    <>
      <WorkspaceTabs name={current.name} role={ROLE_LABEL[ctx.role]} />
      <SponsorshipScreen
        canEdit={can(ctx.role, "sponsor.edit")}
        plans={events}
        rosters={rosters.map((r) => ({ id: r.id, name: r.name, acts: r.acts }))}
        initialShortlist={shortlist.map((s) => ({ id: s.id, view: s.view, pitch: s.pitch, createdAt: s.createdAt.toISOString() }))}
      />
    </>
  );
}

export default function SponsorshipPage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </Page>
  );
}
