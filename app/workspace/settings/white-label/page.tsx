import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Banner, Skeleton } from "@/components/ui";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";
import { WhiteLabelSettings } from "@/components/workspace/white-label";
import { entitlementsFor } from "@/lib/entitlements";
import { txtName, txtValue } from "@/lib/white-label/domain";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "White-label · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/white-label");
  const { ctx, repo } = found;
  const canEdit = can(ctx.role, "whitelabel.edit");
  const [ws, existing, branding, plans] = await Promise.all([repo.workspace.get(), repo.whiteLabel.get(), repo.branding.get(), repo.plans.list(50)]);
  const row = existing ?? (canEdit ? await repo.whiteLabel.ensure() : null);
  if (!row) {
    return (
      <>
        <SettingsTabs />
        <Banner tone="neutral">An admin sets up white-label for this workspace.</Banner>
      </>
    );
  }
  const shared = plans.find((p) => p.visibility === "public");
  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="White-label" sub="Your brand on shared plans and embeddable widgets, on your own domain." />
      <WhiteLabelSettings
        v={{
          allowed: entitlementsFor(ws?.tier).whiteLabel,
          canEdit,
          publicId: row.publicId,
          domain: row.domain,
          txt: row.domain && row.domainToken ? { name: txtName(row.domain), value: txtValue(row.domainToken) } : null,
          verified: Boolean(row.domainVerifiedAt),
          embedOrigins: row.embedOrigins,
          hasBranding: Boolean(branding),
          appUrl: process.env.APP_URL?.trim().replace(/\/$/, "") || "http://localhost:3000",
          samplePlanId: shared?.id ?? null,
        }}
      />
    </>
  );
}

export default function WhiteLabelPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
      <Content />
    </Suspense>
  );
}
