import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { categoryLabel, pct } from "@/components/run/format";
import { AppHeader, DataTable, MonoLabel, Page, Skeleton } from "@/components/ui";
import type { Plan } from "@/lib/agent/types";
import { visiblePlan } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Compare plans · Takeover" };

const ID = /^[0-9a-f-]{36}$/;

/** One row per decision; every value comes from the stored plan. */
function rows(plan: Plan): string[] {
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick;
  const city = plan.city?.chosen?.pick;
  const room = plan.room;
  return [
    `${plan.fanbase?.name ?? plan.query}${plan.fanbase ? ` (${categoryLabel(plan.fanbase.category)})` : ""}`,
    plan.format?.label ?? "—",
    partner ? `${partner.entity.name} (${categoryLabel(partner.entity.category)}) · ${pct(partner.score)} / 100` : "—",
    city ? `${city.city.name}, ${city.city.country} · combined ${pct(city.combined)} / 100` : "—",
    city ? `#${city.populationRank}` : "—",
    room?.venue?.pick.place.name ?? "—",
    room?.opener?.pick.entity.name ?? "—",
    room?.sponsors.map((s) => s.pick.brand.name).join(", ") || "—",
    "To confirm with the promoter",
  ];
}

const LABELS = ["Fanbase", "Format", "Partner", "City", "City by population", "Venue", "Opener or host", "Sponsors", "Capacity, dates, prices"];

async function Comparison({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ids = [sp.a, sp.b].map((v) => (typeof v === "string" && ID.test(v) ? v : null));
  const plans = await Promise.all(ids.map((id) => (id ? visiblePlan(id) : null)));
  const [pa, pb] = plans;
  if (!pa || !pb) {
    return (
      <p className="m-0 text-body text-mute">
        One of these plans is no longer stored (shared plans are kept for 30 days). <Link href="/plans">Back to My plans</Link>
      </p>
    );
  }
  const [a, b] = [rows(pa), rows(pb)];
  return (
    <>
      <DataTable
        columns={["", pa.fanbase?.name ?? "Plan A", pb.fanbase?.name ?? "Plan B"]}
        template="minmax(110px,0.8fr) minmax(0,1.5fr) minmax(0,1.5fr)"
        rows={LABELS.map((label, i) => [
          <MonoLabel key="l">{label}</MonoLabel>,
          <span key="a">{a[i]}</span>,
          <span key="b" className="block text-right">
            {b[i]}
          </span>,
        ])}
      />
      <div className="flex flex-wrap gap-3 text-chip">
        {[pa, pb].map((p) => (
          <Link key={p.runId} href={`/plan/${p.runId}`}>
            Open {p.fanbase?.name ?? p.query} →
          </Link>
        ))}
      </div>
    </>
  );
}

export default function ComparePage({ searchParams }: PageProps<"/compare">) {
  return (
    <Page max="max-w-[1040px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Compare</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Two takeovers side by side</h1>
      </section>
      <Suspense fallback={<Skeleton className="h-[84px] w-full rounded-md" />}>
        <Comparison searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
