import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DataTable, MonoLabel, Skeleton } from "@/components/ui";
import { NewBrief } from "@/components/workspace/campaign";
import { PageTitle } from "@/components/workspace/shell";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Campaign brief · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/campaign");
  const { ctx, repo } = found;
  const [briefs, plans] = await Promise.all([repo.briefs.list(), repo.plans.list(50)]);
  const ready = plans.flatMap((p) => {
    const plan = p.result;
    const partner = plan.partners?.picks.find((x) => x.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
    return plan.status === "complete" && plan.fanbase ? [{ id: p.id, label: `${plan.fanbase.name}${partner ? ` × ${partner.name}` : ""}${plan.room?.cityName ? ` · ${plan.room.cityName}` : ""}` }] : [];
  });
  const canMake = can(ctx.role, "plan.create");

  if (!briefs.length && !ready.length) {
    return (
      <>
        <MonoLabel>Campaign brief</MonoLabel>
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-12 sm:px-12">
          <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">No campaign briefs yet</h2>
          <p className="m-0 max-w-[400px] text-body text-mute">Turn a plan into a one-page brief with audience, interests, cities and creative angles.</p>
          <Link href="/workspace" className="rounded-btn bg-acc px-4 py-2.5 font-semibold text-on-acc no-underline hover:text-on-acc">
            Go to plans
          </Link>
        </section>
      </>
    );
  }
  return (
    <>
      <PageTitle label="Tools" title="Campaign brief" sub="A one-page brief from a saved plan: audience, interests, cities and creative angles, every figure from Qloo." />
      {canMake && ready.length > 0 && <NewBrief plans={ready} />}
      {briefs.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Briefs">
          <MonoLabel>Briefs · {briefs.length}</MonoLabel>
          <DataTable
            columns={["Brief", "By", "Made"]}
            template="minmax(0,2fr) minmax(0,1fr) minmax(96px,auto)"
            rows={briefs.map((b) => [
              <Link key="n" href={`/workspace/campaign/${b.id}`} className="[overflow-wrap:anywhere]">
                {b.data.title}
              </Link>,
              <span key="a" className="text-chip [overflow-wrap:anywhere]">
                {b.author ?? b.authorEmail ?? "Someone"}
              </span>,
              <span key="d" className="tabular font-mono text-chip text-mute">
                {b.createdAt.toISOString().slice(0, 10)}
              </span>,
            ])}
          />
        </section>
      )}
    </>
  );
}

export default function CampaignPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
      <Content />
    </Suspense>
  );
}
