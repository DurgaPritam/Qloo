import { connection } from "next/server";
import { Suspense, cache } from "react";

import { Landing } from "@/components/landing";
import { WhatCanIDo } from "@/components/onboarding/role-picker";
import { PlanTabs, PlanTicker, PlayRow } from "@/components/landing-live";
import { Comparison } from "@/components/showcase";
import { TrendingStrip } from "@/components/trending";
import { MonoLabel, Skeleton } from "@/components/ui";
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

async function Ticker() {
  await connection();
  const plans = await plansOnce();
  return plans.length ? <PlanTicker plans={plans} /> : null;
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
        <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
          <div className="flex flex-col gap-1.5">
            <MonoLabel>Why taste data</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(24px,3.5vw,32px)] leading-[0.95]">Ask a chatbot and you get the obvious answer</h2>
            <p className="m-0 text-body text-mute [text-wrap:pretty]">The same question about {compare.fanbase}, asked with and without Qloo.</p>
          </div>
          <Comparison plan={compare} llmText={llm.text} />
        </section>
      )}
      <PlayRow daily={daily?.puzzle ?? null} />
      {plans.length > 0 && <PlanTabs featured={plans.slice(0, 6)} recent={recent} total={plans.length} />}
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
      ticker={
        <Suspense fallback={<Skeleton className="h-[46px] w-full rounded-md" />}>
          <Ticker />
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
