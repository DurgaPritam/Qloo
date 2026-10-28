import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppHeader, MonoLabel, Page, Skeleton } from "@/components/ui";
import { BrandingSettings } from "@/components/workspace/branding";
import { brandingFrom } from "@/lib/export/branding";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Branded decks · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/branding");
  const { ctx, repo, memberships } = found;
  const name = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "";
  const row = await repo.branding.get();
  return <BrandingSettings initial={brandingFrom(row, name)} saved={Boolean(row)} canEdit={can(ctx.role, "branding.edit")} />;
}

export default function BrandingPage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Link href="/workspace/settings" className="pt-4 text-chip text-mute">
        ← Settings
      </Link>
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Settings</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92]">Branded decks</h1>
        <p className="m-0 text-chip text-mute">Applied to every pitch deck and report this workspace exports.</p>
      </section>
      <Suspense fallback={<Skeleton className="h-[400px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </Page>
  );
}
