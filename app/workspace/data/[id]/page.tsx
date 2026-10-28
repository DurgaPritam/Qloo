import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AppHeader, MonoLabel, Page, Skeleton } from "@/components/ui";
import { DatasetScreen } from "@/components/workspace/your-data";
import { datasetView, fanbaseCityScores } from "@/lib/data/service";
import { getQlooSource } from "@/lib/qloo/source";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Your data · Takeover", robots: { index: false } };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await currentWorkspace();
  if (!found) redirect(`/signin?next=/workspace/data/${encodeURIComponent(id)}`);
  const { repo, ctx } = found;
  const view = /^[0-9a-f-]{36}$/.test(id)
    ? await datasetView(repo, id, async (entity) => (await fanbaseCityScores(repo, entity, getQlooSource(), { kind: "workspace", workspaceId: ctx.workspaceId })).scores)
    : null;
  if (!view) notFound();
  return <DatasetScreen initial={view} />;
}

export default function DatasetPage({ params }: PageProps<"/workspace/data/[id]">) {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Link href="/workspace/data" className="pt-4 text-chip text-mute">
        ← Your data
      </Link>
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Data</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Your data</h1>
        <p className="m-0 text-chip text-mute">Upload your own sales or CRM export. Takeover keeps it separate from Qloo signal and shows both.</p>
      </section>
      <Suspense fallback={<Skeleton className="h-[400px] w-full rounded-lg" />}>
        <Content params={params} />
      </Suspense>
    </Page>
  );
}
