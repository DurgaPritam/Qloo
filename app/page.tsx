import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";

import { Landing } from "@/components/landing";
import { Comparison, PlanGrid } from "@/components/showcase";
import { MonoLabel, Skeleton } from "@/components/ui";
import { cachedLlmOnly } from "@/lib/server/llm-only";
import { loadRecent } from "@/lib/server/plan-store";
import { loadShowcase } from "@/lib/server/showcase";

/** The run shown in the "with Qloo vs without" strip. */
const COMPARE = "Phoebe Bridgers";

async function Showcase() {
  await connection();
  const [plans, recent] = await Promise.all([loadShowcase(), loadRecent(3)]);
  if (plans.length === 0) return null;
  const compare = plans.find((p) => p.query === COMPARE);
  const llm = compare ? await cachedLlmOnly(compare.fanbase) : null;
  return (
    <>
      <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>Takeovers planned with Qloo</MonoLabel>
          <Link href="/explore" className="text-chip">
            See all {plans.length} →
          </Link>
        </div>
        <PlanGrid plans={plans.slice(0, 6)} />
      </section>
      {recent.length > 0 && (
        <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
          <MonoLabel>Planned recently by visitors</MonoLabel>
          <PlanGrid plans={recent} shared />
        </section>
      )}
      {compare && llm && !llm.mock && (
        <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
          <div className="flex flex-col gap-1.5">
            <MonoLabel>Why taste data</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(24px,3.5vw,32px)] leading-[0.95]">
              Ask a chatbot and you get the obvious answer
            </h2>
            <p className="m-0 text-body text-mute [text-wrap:pretty]">
              The same question about {compare.fanbase}, asked with and without Qloo.
            </p>
          </div>
          <Comparison plan={compare} llmText={llm.text} />
        </section>
      )}
    </>
  );
}

export default function Home() {
  return (
    <Landing
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
