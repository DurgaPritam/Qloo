import { connection } from "next/server";
import { Suspense, cache } from "react";

import { Landing } from "@/components/landing";
import { WhatCanIDo } from "@/components/onboarding/role-picker";
import { HeroRun } from "@/components/hero-run";
import { PlanTabs, PlayRow } from "@/components/landing-live";
import { Comparison } from "@/components/showcase";
import { TrendingStrip } from "@/components/trending";
import { Skeleton } from "@/components/ui";
import { roleCards } from "@/lib/features";
import { resolvedExamples } from "@/lib/onboarding/examples";
import { dailyPuzzle, today } from "@/lib/server/daily";
import { cachedLlmOnly } from "@/lib/server/llm-only";
import { loadRecent } from "@/lib/server/plan-store";
import { loadShowcase } from "@/lib/server/showcase";
import { PAIR_SEP, topTrends } from "@/lib/server/trending";

/** The run shown in the "with Qloo vs without" strip. */
const COMPARE = "Phoebe Bridgers";

/** Shared by the hero ticker and the sections below, so the plans load once per request. */
const plansOnce = cache(() => loadShowcase());

/** The hero's live-run card, replaying the preloaded real plans (none in sample mode: steps only). */
async function Hero() {
  await connection();
  return <HeroRun plans={await plansOnce()} />;
}

/** "What can I do?": examples only where a cached real run exists. */
async function Roles() {
  await connection();
  return <WhatCanIDo cards={roleCards(await resolvedExamples())} />;
}

async function Showcase() {
  await connection();
  const { date, number } = today();
  const [plans, recent, pairs, cities, fanbases, daily] = await Promise.all([
    plansOnce(),
    loadRecent(6),
    topTrends("pair"),
    topTrends("city"),
    topTrends("fanbase"),
    dailyPuzzle(date, number),
  ]);
  const compare = plans.find((p) => p.query === COMPARE);
  const llm = compare ? await cachedLlmOnly(compare.fanbase) : null;
  return (
    <>
      {compare && llm && !llm.mock && (
        <section className="reveal flex flex-col gap-5 border-t border-line pt-8">
          <div className="flex flex-col gap-2">
            <h2 className="t-display m-0 text-[clamp(30px,4vw,48px)] leading-[0.92]">A chatbot gives the obvious answer</h2>
            <p className="m-0 text-[16px] text-mute [text-wrap:pretty]">The same question about {compare.fanbase}, with and without Qloo.</p>
          </div>
          <Comparison plan={compare} llmText={llm.text} />
        </section>
      )}
      <PlayRow daily={daily?.puzzle ?? null} />
      {plans.length > 0 && <PlanTabs featured={plans.slice(0, 8)} recent={recent} total={plans.length} />}
      <TrendingStrip pairs={pairs} cities={cities} fanbases={fanbases} sep={PAIR_SEP} />
    </>
  );
}

export default function Home() {
  return (
    <Landing
      roles={
        <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-md" />}>
          <Roles />
        </Suspense>
      }
      hero={
        <Suspense fallback={<HeroRun plans={[]} />}>
          <Hero />
        </Suspense>
      }
      showcase={
        <Suspense
          fallback={
            <section className="flex flex-col gap-2 border-t border-line pt-[18px]">
              <Skeleton className="h-[104px] w-full rounded-md" />
              <Skeleton className="h-[104px] w-full rounded-md" />
            </section>
          }
        >
          <Showcase />
        </Suspense>
      }
    />
  );
}
