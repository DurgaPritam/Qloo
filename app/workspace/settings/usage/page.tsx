import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { UsagePanel } from "@/components/workspace/billing";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";
import { usageRows } from "@/lib/billing/view";
import { PLACEHOLDER_NOTE, TIERS } from "@/lib/entitlements";
import { planOf } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Usage · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/usage");
  const [rows, plan] = await Promise.all([usageRows(found.repo), planOf(found.repo)]);
  const label = TIERS[plan.tier as keyof typeof TIERS]?.label ?? "Free";
  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="Usage" sub={`This month on ${label}. Months are counted in UTC.`} />
      <UsagePanel rows={rows} title="This month" />
      <p className="m-0 text-chip text-mute">
        Counts come from this workspace&apos;s saved data and Takeover&apos;s Qloo call counters. {PLACEHOLDER_NOTE}{" "}
        <Link href="/workspace/settings/billing">Plans & billing →</Link>
      </p>
    </>
  );
}

export default function UsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
      <Content />
    </Suspense>
  );
}
