import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { BriefView } from "@/components/workspace/campaign";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Campaign brief · Takeover", robots: { index: false } };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await currentWorkspace();
  if (!found) redirect(`/signin?next=/workspace/campaign/${id}`);
  const row = /^[0-9a-f-]{36}$/.test(id) ? await found.repo.briefs.get(id) : null;
  if (!row) notFound();
  const workspace = found.memberships.find((m) => m.workspaceId === found.ctx.workspaceId)?.name ?? "Your workspace";
  return <BriefView id={row.id} brief={row.data} workspace={workspace} canDelete={can(found.ctx.role, "plan.create")} />;
}

export default function BriefPage({ params }: PageProps<"/workspace/campaign/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
      <Content params={params} />
    </Suspense>
  );
}
