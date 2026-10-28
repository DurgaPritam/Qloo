import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppHeader, MonoLabel, Page, Skeleton } from "@/components/ui";
import { OutcomesReport } from "@/components/workspace/outcomes";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { reportView } from "@/lib/outcomes/service";
import { can, ROLE_LABEL } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Outcomes · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/outcomes");
  const { ctx, repo, memberships } = found;
  const current = memberships.find((m) => m.workspaceId === ctx.workspaceId)!;
  const [view, plans, logged, predictions] = await Promise.all([reportView(repo, current.name), repo.plans.list(100), repo.outcomes.logged(), repo.outcomes.predictions()]);
  const done = new Set(logged.map((l) => l.planId));
  const frozen = new Map(predictions.map((p) => [p.planId, p.predicted]));
  // Labels from the frozen predictions (what the plan chose when it was made), not the stored plan.
  const list = plans
    .filter((p) => p.result.status === "complete")
    .map((p) => {
      const f = frozen.get(p.id);
      return { id: p.id, label: `${p.input}${f?.partner ? ` × ${f.partner.name}` : ""}${f?.city ? `, ${f.city.name}` : ""}`, logged: done.has(p.id) };
    });
  return (
    <>
      <WorkspaceTabs name={current.name} role={ROLE_LABEL[ctx.role]} />
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Outcomes</MonoLabel>
        <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Predicted vs actual</h2>
        <p className="m-0 text-chip text-mute">How your events went against what each plan predicted, by your own median.</p>
      </section>
      <OutcomesReport view={view} plans={list} canLog={can(ctx.role, "outcome.log")} />
    </>
  );
}

export default function OutcomesPage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </Page>
  );
}
