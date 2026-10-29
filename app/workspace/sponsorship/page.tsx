import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { SponsorshipScreen } from "@/components/workspace/sponsorship";
import { can } from "@/lib/workspace/permissions";
import { featureAccess } from "@/lib/workspace/gate";
import { UpgradePrompt } from "@/components/workspace/upgrade";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Sponsorship · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/sponsorship");
  const { ctx, repo } = found;
  const [plans, rosterRows, shortlist, access] = await Promise.all([repo.plans.list(50), repo.rosters.list(), repo.sponsorship.shortlist(), featureAccess(repo, "sponsorship")]);
  const rosters = await Promise.all(rosterRows.map(async (r) => ({ id: r.id, name: r.name, acts: (await repo.rosters.acts(r.id)).map((a) => ({ id: a.id, name: a.name })) })));
  const events = plans.flatMap((p) => {
    const plan = p.result;
    const partner = plan.partners?.picks.find((x) => x.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
    return plan.fanbase && partner ? [{ id: p.id, label: `${plan.fanbase.name} × ${partner.name}${plan.room?.cityName ? `, ${plan.room.cityName}` : ""}` }] : [];
  });
  return (
    <>
      {access.upgrade && <UpgradePrompt upgrade={access.upgrade} />}
      <SponsorshipScreen
        canEdit={can(ctx.role, "sponsor.edit") && access.allowed}
        plans={events}
        rosters={rosters}
        initialShortlist={shortlist.map((s) => ({ id: s.id, view: s.view, pitch: s.pitch, createdAt: s.createdAt.toISOString() }))}
      />
    </>
  );
}

export default function SponsorshipPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
