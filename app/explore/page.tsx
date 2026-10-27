import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { ExploreGrid } from "@/components/explore";
import { AppHeader, MonoLabel, Page, Skeleton } from "@/components/ui";
import { loadShowcase } from "@/lib/server/showcase";

export const metadata: Metadata = { title: "Explore · Takeover" };

async function Plans() {
  await connection();
  const plans = await loadShowcase();
  if (plans.length === 0) {
    return <p className="m-0 text-body text-mute">No example plans are loaded in this deployment yet.</p>;
  }
  return <ExploreGrid plans={plans} />;
}

export default function ExplorePage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Explore</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Takeovers planned with Qloo</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          Real plans for comedians, musicians, films, podcasts and teams. Open one to see every step, the Qloo calls behind
          it, the brief and the outreach. They open instantly.
        </p>
      </section>
      <Suspense fallback={<div className="grid gap-2 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] w-full rounded-md" />)}</div>}>
        <Plans />
      </Suspense>
    </Page>
  );
}
