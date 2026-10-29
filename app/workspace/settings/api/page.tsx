import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Banner, Skeleton } from "@/components/ui";
import { ApiKeys } from "@/components/workspace/api-keys";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";
import { PLACEHOLDER_NOTE, TIERS } from "@/lib/entitlements";
import { featureAccess } from "@/lib/workspace/gate";
import { UpgradePrompt } from "@/components/workspace/upgrade";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "API · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/api");
  const { ctx, repo } = found;
  if (!can(ctx.role, "api.read")) {
    return (
      <>
        <SettingsTabs />
        <Banner tone="neutral">Members and above can see the API keys and usage.</Banner>
      </>
    );
  }
  const month = new Date().toISOString().slice(0, 7);
  const [keys, usage, access] = await Promise.all([repo.api.keys(), repo.api.usage(month), featureAccess(repo, "api")]);
  const e = { label: TIERS[access.plan.tier as keyof typeof TIERS]?.label ?? "Free", api: access.plan.limits.api };
  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="API" sub="Keys for the public API, and what each used this month." />
      {access.upgrade && <UpgradePrompt upgrade={access.upgrade} />}
      <ApiKeys
        canManage={can(ctx.role, "api.manage") && access.allowed}
        tier={e.label}
        limits={e.api}
        note={PLACEHOLDER_NOTE}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          used: usage.find((u) => u.keyId === k.id && u.endpoint === "*")?.count ?? 0,
          byEndpoint: usage.filter((u) => u.keyId === k.id && u.endpoint !== "*").map((u) => ({ endpoint: u.endpoint, count: u.count })),
        }))}
      />
    </>
  );
}

export default function ApiPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
      <Content />
    </Suspense>
  );
}
