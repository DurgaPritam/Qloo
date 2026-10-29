import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { BrandedPlan } from "@/components/white-label/branded-plan";
import { applied } from "@/lib/white-label/brand";
import { isPrimaryHost } from "@/lib/white-label/hosts";
import { brandVars } from "@/lib/white-label/theme";
import { brandByDomain, brandForWorkspace, publicPlanOnly } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Shared plan", robots: { index: false } };

/**
 * A publicly shared plan, white-labelled. On a workspace's verified custom domain only that
 * workspace's public plans exist; on Takeover's own host, a plan wears its workspace's brand when
 * the workspace has white-label. Private plans are never shown here, whoever is signed in.
 */
async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = (await headers()).get("host") ?? "";
  const access = await publicPlanOnly(id);
  if (!access) notFound();
  const workspaceId = access.kind === "public" ? access.workspaceId : null;
  let owner = null;
  if (!isPrimaryHost(host)) {
    owner = await brandByDomain(host.replace(/:\d+$/, ""));
    if (!owner || owner.workspaceId !== workspaceId) notFound();
  } else if (workspaceId) {
    owner = await brandForWorkspace(workspaceId);
  }
  const look = applied(owner).brand;
  return <BrandedPlan plan={access.plan} brand={look ? { name: look.name, logo: look.logo, vars: brandVars(look.colours) } : null} />;
}

export default function BrandedPlanPage({ params }: PageProps<"/p/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <Loader params={params} />
    </Suspense>
  );
}
