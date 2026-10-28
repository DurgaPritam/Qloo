import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { categoryLabel } from "@/components/run/format";
import { AppHeader, Banner, MonoLabel, OutlineChip, Page, Skeleton, SourceBadge } from "@/components/ui";
import { ImportOffer } from "@/components/workspace/import-offer";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { summarise } from "@/lib/plan-summary";
import { can, ROLE_LABEL } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Workspace · Takeover", robots: { index: false } };

async function Plans({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace");
  const { ctx, repo, memberships } = found;
  const welcome = (await searchParams).welcome === "1";
  const current = memberships.find((m) => m.workspaceId === ctx.workspaceId)!;
  const rows = await repo.plans.list();

  return (
    <>
      <WorkspaceTabs name={current.name} role={ROLE_LABEL[ctx.role]} />
      {welcome && (
        <Banner tone="info">
          You&apos;re signed in. Plans you make while signed in are saved here, private to this workspace&apos;s members. Invite your team
          from Members.
        </Banner>
      )}
      {can(ctx.role, "plan.create") && <ImportOffer workspaceId={ctx.workspaceId} workspaceName={current.name} />}
      {rows.length === 0 ? (
        <Banner tone="neutral" action={<Link href="/">Plan a takeover →</Link>}>
          No plans here yet. {can(ctx.role, "plan.create") ? "Plan one while signed in and it lands here." : "Members' plans will appear here."}
        </Banner>
      ) : (
        <section className="flex flex-col gap-[18px]">
          <MonoLabel>
            {rows.length} plan{rows.length === 1 ? "" : "s"}
          </MonoLabel>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
            {rows.map((row) => {
              const s = summarise(row.result, row.createdAt.toISOString());
              return (
                <Link
                  key={row.id}
                  href={`/plan/${row.id}`}
                  className="flex min-w-0 flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card text-ink no-underline hover:bg-acc-soft"
                >
                  <MonoLabel className="text-acc-text">{s ? `${categoryLabel(s.category)} · ${s.format}` : "Partial plan"}</MonoLabel>
                  <div className="t-display text-[22px] leading-[1.05] [overflow-wrap:anywhere]">{s ? `${s.fanbase} × ${s.partner}` : row.input}</div>
                  {s && (
                    <div className="text-chip text-mute">
                      {s.city}
                      {s.venue ? ` · ${s.venue}` : ""}
                    </div>
                  )}
                  <div className="text-chip text-mute">
                    {row.author ?? row.authorEmail ?? "Former member"} · {row.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {s && <SourceBadge>Qloo #1 city</SourceBadge>}
                    <OutlineChip>{row.visibility === "public" ? "Anyone with the link" : "Workspace only"}</OutlineChip>
                    {row.result.mock && <OutlineChip>Sample data</OutlineChip>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

export default function WorkspacePage({ searchParams }: PageProps<"/workspace">) {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Plans searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
