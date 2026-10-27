import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CopyLinkButton } from "@/components/copy-link";
import { categoryLabel } from "@/components/run/format";
import { planHref } from "@/components/showcase";
import { AppHeader, Banner, MonoLabel, Page, Panel, Skeleton, SourceBadge } from "@/components/ui";
import { loadLineup } from "@/lib/tools/lineup";

export async function generateMetadata({ params }: PageProps<"/lineup/[id]">): Promise<Metadata> {
  await connection();
  const l = await loadLineup((await params).id);
  if (!l) return { title: "Lineup · Takeover" };
  const title = `${l.title}: ${l.headliner.name}${l.acts.length ? ` with ${l.acts.map((a) => a.name).join(", ")}` : ""} · Takeover`;
  const description = `A lineup built from Qloo taste data${l.city ? ` for ${l.city.name}` : ""}. Crowd fit ${l.crowdFit}.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

async function LineupLoader({ params }: PageProps<"/lineup/[id]">) {
  await connection();
  const { id } = await params;
  const l = await loadLineup(id);
  if (!l) notFound();
  return (
    <>
      {l.mock && <Banner tone="warn">SAMPLE DATA — not Qloo results</Banner>}
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Lineup</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92] [overflow-wrap:anywhere]">{l.title}</h1>
      </section>
      <div className="grid items-start gap-[18px] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG, not a static asset */}
        <img src={`/lineup/${l.id}/poster`} alt={`Poster: ${l.headliner.name} with ${l.acts.map((a) => a.name).join(", ")}`} className="w-full rounded-md border-card border-ink shadow-card" />
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonoLabel className="text-acc-text">Crowd fit {l.crowdFit}</MonoLabel>
            <SourceBadge>Qloo affinity</SourceBadge>
          </div>
          <p className="m-0 text-chip text-mute">The average Qloo affinity of the lineup among {l.headliner.name} fans, 0–100.</p>
          <div className="flex flex-col">
            {[...l.acts, ...(l.host ? [l.host] : [])].map((a) => (
              <div key={a.id} className="flex items-baseline justify-between gap-2 border-b border-line py-2">
                <Link href={planHref(a.name)}>{a.name}</Link>
                <span className="text-chip text-mute">
                  {a.id === l.host?.id ? "Host" : categoryLabel(a.category)} · affinity {a.affinity.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          {l.city && (
            <p className="m-0 text-chip text-mute">
              {l.venue ? `${l.venue}, ` : ""}
              {l.city.name}: Qloo&apos;s strongest city for {l.headliner.name}. Dates, capacity and fees are to confirm with the promoter.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`/lineup/${l.id}/poster`} download className="rounded-btn border-card border-ink bg-acc px-3.5 py-2 text-chip font-medium text-on-acc no-underline">
              Download poster
            </a>
            <CopyLinkButton />
            <Link href={planHref(l.headliner.name)} className="rounded-btn border-th border-line px-3.5 py-2 text-chip text-ink no-underline hover:bg-acc-soft">
              Plan the takeover →
            </Link>
            <Link href={`/lineup?h=${encodeURIComponent(l.headliner.name)}`} className="rounded-btn border-th border-line px-3.5 py-2 text-chip text-ink no-underline hover:bg-acc-soft">
              Build another
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

export default function SavedLineupPage(props: PageProps<"/lineup/[id]">) {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-md" />}>
        <LineupLoader {...props} />
      </Suspense>
    </Page>
  );
}
