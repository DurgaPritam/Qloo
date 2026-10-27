import Link from "next/link";

import type { PlanSummary } from "@/lib/plan-summary";

import { categoryLabel } from "./run/format";
import { MonoLabel, NoSourceBadge, OutlineChip, SourceBadge } from "./ui";

export const planHref = (query: string) => `/run?q=${encodeURIComponent(query)}`;

/** One finished plan: fanbase × partner, then city and venue. Opens the run (a cached replay). */
export function PlanCard({ plan }: { plan: PlanSummary }) {
  return (
    <Link
      href={planHref(plan.query)}
      className="flex min-w-0 flex-col gap-2 rounded-md bg-surf p-[18px] text-ink no-underline outline-offset-2 hover:bg-acc-soft"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <MonoLabel className="text-acc-text">{categoryLabel(plan.category)}</MonoLabel>
        <span className="text-mute">·</span>
        <MonoLabel>{plan.format}</MonoLabel>
      </div>
      <div className="t-display text-[22px] leading-[1.05] [overflow-wrap:anywhere]">
        {plan.fanbase} × {plan.partner}
      </div>
      <div className="text-chip text-mute">
        {categoryLabel(plan.partnerCategory)} partner · {plan.city}
        {plan.venue ? ` · ${plan.venue}` : ""}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        <SourceBadge>Qloo #1 city</SourceBadge>
        {plan.populationRank > 1 && <OutlineChip>#{plan.populationRank} by population</OutlineChip>}
      </div>
    </Link>
  );
}

export function PlanGrid({ plans }: { plans: readonly PlanSummary[] }) {
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
      {plans.map((p) => (
        <PlanCard key={p.query} plan={p} />
      ))}
    </div>
  );
}

/** The same question, with and without Qloo, from one stored run and its stored LLM-only answer. */
export function Comparison({ plan, llmText }: { plan: PlanSummary; llmText: string }) {
  const llm = llmText.length > 420 ? `${llmText.slice(0, 419).trimEnd()}…` : llmText;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-md bg-surf p-[18px]">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel className="text-acc-text">With Qloo</MonoLabel>
          <SourceBadge />
        </div>
        <div className="t-display text-[22px] leading-[1.05]">
          {plan.partner} · {plan.city}
        </div>
        <p className="m-0 text-chip text-mute [text-wrap:pretty]">
          {plan.partner} fans over-index on {plan.fanbase}, and {plan.city} is where both audiences are strongest
          {plan.populationRank > 1 ? `, though it is #${plan.populationRank} by population` : ""}. Venue: {plan.venue ?? "none tagged"}. Every
          number is sourced.
        </p>
        <Link href={planHref(plan.query)} className="text-chip">
          Open the plan →
        </Link>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-line p-[18px]">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel>Same model, no taste data</MonoLabel>
          <NoSourceBadge />
        </div>
        <p className="m-0 whitespace-pre-line text-chip text-mute [text-wrap:pretty]">{llm}</p>
      </div>
    </div>
  );
}
