import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MonoLabel, Skeleton } from "@/components/ui";
import { CreateRoster } from "@/components/workspace/roster";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";
import { PageTitle } from "@/components/workspace/shell";

export const metadata: Metadata = { title: "Rosters · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/rosters");
  const { ctx, repo } = found;
  const rosters = await repo.rosters.list();
  const canEdit = can(ctx.role, "roster.edit");

  return (
    <>
      <PageTitle label="Workspace" title="Rosters" />
      {rosters.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-12 sm:px-12">
          <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">No rosters yet</h2>
          <p className="m-0 max-w-[400px] text-body text-mute">Group the talent you represent so you can plan for several at once.</p>
          {canEdit ? <CreateRoster /> : <p className="m-0 text-chip text-mute">Members can create rosters; your role can view them.</p>}
        </section>
      ) : (
        <section className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <MonoLabel>
              {rosters.length} roster{rosters.length === 1 ? "" : "s"}
            </MonoLabel>
            {canEdit && <CreateRoster compact />}
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
            {rosters.map((r) => (
              <Link
                key={r.id}
                href={`/workspace/rosters/${r.id}`}
                className="flex min-w-0 flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card text-ink no-underline hover:bg-acc-soft"
              >
                <MonoLabel className="text-acc-text">Roster</MonoLabel>
                <div className="t-display text-[22px] leading-[1.05] [overflow-wrap:anywhere]">{r.name}</div>
                <div className="text-chip text-mute">
                  {r.acts} act{r.acts === 1 ? "" : "s"} · {r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function RostersPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
