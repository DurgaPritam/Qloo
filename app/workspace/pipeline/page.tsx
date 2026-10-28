import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { PipelineBoard } from "@/components/workspace/pipeline";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Pipeline · Takeover", robots: { index: false } };

async function Content({ searchParams }: { searchParams: Promise<{ card?: string | string[] }> }) {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/pipeline");
  const { ctx, repo } = found;
  const [cards, { card }] = await Promise.all([repo.pipeline.list(), searchParams]);
  return (
    <PipelineBoard
      canEdit={can(ctx.role, "pipeline.edit")}
      openId={typeof card === "string" ? card : undefined}
      initial={cards.map((c) => ({
        id: c.id,
        kind: c.kind,
        context: c.context,
        recipient: c.recipient,
        recipientEmail: c.recipientEmail,
        subject: c.subject,
        body: c.body,
        stage: c.stage,
        owner: c.owner,
        planId: c.planId,
        movedAt: c.movedAt.toISOString(),
        hash: c.hash,
      }))}
    />
  );
}

export default function PipelinePage({ searchParams }: PageProps<"/workspace/pipeline">) {
  return (
    <Suspense fallback={<Skeleton className="h-[360px] w-full rounded-lg" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
