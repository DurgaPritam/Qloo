import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Banner, MonoLabel, OutlineChip, Skeleton, YourDataBadge } from "@/components/ui";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Your data · Takeover", robots: { index: false } };

const BUTTON = "inline-flex min-h-[44px] items-center rounded-btn px-4 text-chip no-underline";

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/data");
  const { ctx, repo } = found;
  const list = await repo.datasets.list();
  const canEdit = can(ctx.role, "data.edit");
  const deleted = (await searchParams).deleted === "1";

  return (
    <>
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Data</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92]">Your data</h1>
        <p className="m-0 text-chip text-mute">Upload your own sales or CRM export. Takeover keeps it separate from Qloo signal and shows both.</p>
      </section>
      {deleted && <Banner tone="info">Deleted: the rows and the file are gone from this workspace.</Banner>}
      {list.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-12 sm:px-12">
          <h3 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">No data sources added</h3>
          <p className="m-0 max-w-[400px] text-body text-mute">Qloo is connected for every workspace. Add a ticketing or CRM export to compare it with Qloo picks.</p>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Link href="/workspace/data/new" className={`${BUTTON} bg-acc font-medium text-on-acc border-card border-ink`}>
                Upload CSV
              </Link>
            )}
            <Link href="/method#your-data" className={`${BUTTON} border-th border-line text-ink hover:bg-acc-soft`}>
              Read about Qloo data
            </Link>
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <MonoLabel>
              {list.length} dataset{list.length === 1 ? "" : "s"}
            </MonoLabel>
            {canEdit && (
              <Link href="/workspace/data/new" className={`${BUTTON} border-th border-line text-ink hover:bg-acc-soft`}>
                Upload data
              </Link>
            )}
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
            {list.map((d) => (
              <Link
                key={d.id}
                href={`/workspace/data/${d.id}`}
                className="flex min-w-0 flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card text-ink no-underline hover:bg-acc-soft"
              >
                <YourDataBadge />
                <div className="font-semibold [overflow-wrap:anywhere]">{d.name}</div>
                <div className="text-chip text-mute">{d.metrics.map((m) => m.label).join(", ")}</div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <OutlineChip>{d.entityName ? `For ${d.entityName}` : "Not attached"}</OutlineChip>
                  <OutlineChip>{d.uploadedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</OutlineChip>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function DataPage({ searchParams }: PageProps<"/workspace/data">) {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
