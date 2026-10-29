import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { GuideList } from "@/components/onboarding/guide";
import { AppHeader, MonoLabel, Page, Skeleton } from "@/components/ui";
import { guideRows } from "@/lib/onboarding/guide";
import { resolvedExamples } from "@/lib/onboarding/examples";
import { planOf } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = {
  title: "Guide · Takeover",
  description: "Every Takeover feature, grouped by who uses it: what it does, where its numbers come from, an example and the plan it comes with.",
};

async function Rows() {
  await connection();
  const found = await currentWorkspace();
  const [examples, plan] = await Promise.all([resolvedExamples(), found ? planOf(found.repo) : null]);
  return <GuideList rows={guideRows(examples, plan)} signedIn={Boolean(found)} />;
}

export default function GuidePage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <section className="flex flex-col gap-2.5 pt-[clamp(18px,6vw,48px)]">
        <MonoLabel>Guide</MonoLabel>
        <h1 className="t-display m-0 max-w-[16ch] text-[clamp(34px,7vw,52px)] leading-[0.92] [text-wrap:balance]">Every feature, grouped by who uses it</h1>
        <p className="m-0 max-w-[60ch] text-mute [text-wrap:pretty]">
          What each tool does, which of its numbers come from Qloo and which from your own data, an example you can open, and the plan it comes with.
        </p>
      </section>
      <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-lg" />}>
        <Rows />
      </Suspense>
    </Page>
  );
}
