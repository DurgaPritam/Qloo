import Link from "next/link";

import type { FanResult } from "@/lib/tools/fan";
import { overlapHref } from "@/lib/site";

import { AudienceCard } from "./audience";
import { categoryLabel, pct } from "./run/format";
import { planHref } from "./showcase";
import { Banner, MonoLabel, OutlineChip, Panel, SourceBadge } from "./ui";
import { CallsUsed } from "./tools/tool-kit";

/** The persona card: who the fans are, what else they love. Every fact is from Qloo. */
export function FanView({ result: r }: { result: Extract<FanResult, { status: "done" }> }) {
  const top = r.tastes.flatMap((t) => (t.picks[0] ? [t.picks[0].entity.name] : []));
  return (
    <>
      {r.mock && <Banner tone="warn">SAMPLE DATA — not Qloo results</Banner>}
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Meet the fan</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,52px)] leading-[0.92] [overflow-wrap:anywhere]">The {r.fanbase.name} fan</h1>
        <div className="flex flex-wrap gap-1.5">
          <OutlineChip>{categoryLabel(r.fanbase.category)}</OutlineChip>
          {r.fanbase.description && <OutlineChip>{r.fanbase.description.slice(0, 80)}</OutlineChip>}
        </div>
        <p className="m-0 max-w-[62ch] text-[20px] leading-[1.35] [text-wrap:pretty]">{r.intro}</p>
      </section>

      <div className="grid items-start gap-[18px] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {r.audience ? (
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonoLabel className="text-acc-text">Who they are</MonoLabel>
              <SourceBadge>urn:demographics</SourceBadge>
            </div>
            <AudienceCard name={r.fanbase.name} profile={r.audience} />
          </Panel>
        ) : (
          <Banner tone="neutral">Qloo has no age or gender skew for this fanbase.</Banner>
        )}
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonoLabel className="text-acc-text">What else they love</MonoLabel>
            <SourceBadge>urn:entity · affinity</SourceBadge>
          </div>
          <div className="grid gap-[18px] sm:grid-cols-2">
            {r.tastes.map((t) => (
              <div key={t.category} className="flex flex-col gap-1">
                <MonoLabel>{t.label.charAt(0).toUpperCase() + t.label.slice(1)}s</MonoLabel>
                {t.picks.map((p) => (
                  <Link key={p.entity.id} href={planHref(p.entity.name)} className="flex items-baseline justify-between gap-2 text-body no-underline">
                    <span className="min-w-0 text-ink [overflow-wrap:anywhere] hover:underline">{p.entity.name}</span>
                    <span className="tabular flex-none font-mono text-chip text-mute">{pct(p.score)}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <p className="m-0 text-chip text-mute">Score 0–100: affinity relative to its category with a gentle discount for the mainstream, as for takeover partners.</p>
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={planHref(r.fanbase.name)} className="rounded-btn border-card border-ink bg-acc px-3.5 py-2 text-chip font-medium text-on-acc no-underline">
          Plan a takeover for {r.fanbase.name} →
        </Link>
        {top[0] && (
          <Link href={overlapHref(r.fanbase.name, top[0])} className="rounded-btn border-th border-line px-3.5 py-2 text-chip text-ink no-underline hover:bg-acc-soft">
            Check the overlap with {top[0]} →
          </Link>
        )}
      </div>
      <CallsUsed calls={r.calls} />
    </>
  );
}
