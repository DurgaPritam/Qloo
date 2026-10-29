import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { RosterScreen } from "@/components/workspace/roster";
import { rosterView } from "@/lib/roster/service";
import { featureAccess } from "@/lib/workspace/gate";
import { UpgradePrompt } from "@/components/workspace/upgrade";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Roster · Takeover", robots: { index: false } };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await currentWorkspace();
  if (!found) redirect(`/signin?next=/workspace/rosters/${encodeURIComponent(id)}`);
  const view = /^[0-9a-f-]{36}$/.test(id) ? await rosterView(found.repo, id) : null;
  if (!view) notFound();
  const access = await featureAccess(found.repo, "rosters");
  return (
    <>
      {access.upgrade && <UpgradePrompt upgrade={access.upgrade} compact />}
      <RosterScreen initial={view} />
    </>
  );
}

export default function RosterPage({ params }: PageProps<"/workspace/rosters/[id]">) {
  return (
    <>
      <Link href="/workspace/rosters" className="pt-4 text-chip text-mute">
        ← All rosters
      </Link>
      <Suspense fallback={<Skeleton className="h-[400px] w-full rounded-lg" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}
