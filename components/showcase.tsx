import Link from "next/link";

import type { PlanSummary } from "@/lib/plan-summary";

import { categoryLabel } from "./run/format";
import { MonoLabel, NoSourceBadge, OutlineChip, SourceBadge } from "./ui";

export const planHref = (query: string) => `/run?q=${encodeURIComponent(query)}`;

/** One finished plan: fanbase × partner, then city and venue. Opens the run (a cached replay). */
export function PlanCard({ plan, href }: { plan: PlanSummary; href?: string }) {
  return (
    <Link
      href={href ?? planHref(plan.query)}
      className="flex min-w-0 flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card text-ink no-underline outline-offset-2 hover:bg-acc-soft"
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

/** `shared` links each card to its stored plan (/plan/<runId>) instead of replaying the query. */
export function PlanGrid({ plans, shared }: { plans: readonly PlanSummary[]; shared?: boolean }) {
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
      {plans.map((p) => (
        <PlanCard key={shared ? p.runId : p.query} plan={p} href={shared ? `/plan/${p.runId}` : undefined} />
      ))}
    </div>
  );
}

/** The same question, with and without Qloo, from one stored run and its stored LLM-only answer. */
export function Comparison({ plan, llmText }: { plan: PlanSummary; llmText: string }) {
  const llm = llmText.length > 260 ? `${llmText.slice(0, 259).trimEnd()}…` : llmText;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel className="text-acc-text">With Qloo</MonoLabel>
          <SourceBadge />
        </div>
        <div className="t-display text-[clamp(26px,3vw,36px)] leading-[1.02]">
          {plan.partner} · {plan.city}
        </div>
        <p className="m-0 text-[15px] text-mute [text-wrap:pretty]">
          {plan.partner} fans over-index on {plan.fanbase}, and {plan.city} is where both audiences are strongest
          {plan.populationRank > 1 ? `, though it is #${plan.populationRank} by population` : ""}. Venue: {plan.venue ?? "none tagged"}. Every number is sourced.
        </p>
        <Link href={planHref(plan.query)} className="text-[15px]">
          Open the plan →
        </Link>
      </div>
      <div className="flex flex-col gap-2 rounded-md border-th border-line p-[18px]">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel>Same model, no taste data</MonoLabel>
          <NoSourceBadge />
        </div>
        <p className="m-0 whitespace-pre-line text-[15px] text-mute [text-wrap:pretty]">{llm}</p>
      </div>
    </div>
  );
}
