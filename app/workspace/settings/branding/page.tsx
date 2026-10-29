import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MonoLabel, Skeleton } from "@/components/ui";
import { BrandingSettings } from "@/components/workspace/branding";
import { brandingFrom } from "@/lib/export/branding";
import { can } from "@/lib/workspace/permissions";
import { featureAccess } from "@/lib/workspace/gate";
import { UpgradePrompt } from "@/components/workspace/upgrade";
import { currentWorkspace } from "@/lib/workspace/session";
import { SettingsTabs } from "@/components/workspace/shell";

export const metadata: Metadata = { title: "Branded decks · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/branding");
  const { ctx, repo, memberships } = found;
  const name = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "";
  const [row, access] = await Promise.all([repo.branding.get(), featureAccess(repo, "exports.branded")]);
  return (
    <>
      {access.upgrade && <UpgradePrompt upgrade={access.upgrade} />}
      <BrandingSettings initial={brandingFrom(row, name)} saved={Boolean(row)} canEdit={can(ctx.role, "branding.edit") && access.allowed} />
    </>
  );
}

export default function BrandingPage() {
  return (
    <>
      <SettingsTabs />
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Settings</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92]">Branded decks</h1>
        <p className="m-0 text-chip text-mute">Applied to every pitch deck and report this workspace exports.</p>
      </section>
      <Suspense fallback={<Skeleton className="h-[400px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
