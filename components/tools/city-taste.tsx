"use client";

import Link from "next/link";

import type { PlanSummary } from "@/lib/plan-summary";
import type { BookingList, BookingResult } from "@/lib/tools/venue";

import { categoryLabel } from "../run/format";
import { PlanGrid } from "../showcase";
import { Button, MonoLabel, OutlineChip, Panel, SourceBadge } from "../ui";
import { RankRow, SampleBanner } from "./tool-kit";

/** The Venue booker's lists, also used by the city pages. */
export function BookingLists({ lists, onRetry }: { lists: BookingList[]; onRetry?: () => void }) {
  const retry = onRetry ?? (() => window.location.reload());
  return (
          <div className="grid items-start gap-[18px] md:grid-cols-2">
            {lists.map((list) => (
              <Panel key={list.kind} className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MonoLabel className="text-acc-text">{list.label}</MonoLabel>
                  <SourceBadge>signal.location</SourceBadge>
                </div>
                <p className="m-0 text-chip text-mute">{list.note}</p>
                {list.error && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-chip text-err">{list.error}</p>
                    <Button onClick={retry}>Try again</Button>
                  </div>
                )}
                {!list.error && list.picks.length === 0 && (
                  <p className="m-0 text-chip text-mute">Qloo has no {list.label.toLowerCase()} for this city within the popularity band.</p>
                )}
                <div className="flex flex-col">
                  {list.picks.map((p) => (
                    <RankRow
                      key={p.entity.id}
                      rank={p.rank}
                      name={p.entity.name}
                      meta={`${categoryLabel(p.entity.category)} · popularity ${p.entity.popularity.toFixed(2)}`}
                    />
                  ))}
                </div>
                {list.dropped > 0 && (
                  <p className="m-0 text-chip text-mute">
                    {list.dropped} left out: mega-stars every city likes, acts too obscure to sell tickets, or repeats.
                  </p>
                )}
              </Panel>
            ))}
          </div>
  );
}

/** A city's taste page: who it over-indexes on, and takeovers that landed there. */
export function CityTasteView({ result: r, landed }: { result: BookingResult; landed: PlanSummary[] }) {
  return (
    <>
      <SampleBanner mock={r.mock} />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>City taste</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,52px)] leading-[0.92]">{r.city.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.city.admin1 && r.city.admin1 !== r.city.name && <OutlineChip>{r.city.admin1}</OutlineChip>}
          <OutlineChip>{r.city.country}</OutlineChip>
          <OutlineChip>Population {r.city.population.toLocaleString("en-GB")}</OutlineChip>
        </div>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          What people in {r.city.name} over-index on, from Qloo: the acts to book, the podcasts to bring for a live show and the
          brands to ask for sponsorship. Tap any name to plan a takeover with it.
        </p>
      </section>
      <BookingLists lists={r.lists} />
      {landed.length > 0 && (
        <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
          <MonoLabel>Takeovers that landed in {r.city.name}</MonoLabel>
          <PlanGrid plans={landed} />
        </section>
      )}
      <p className="m-0 text-chip text-mute [text-wrap:pretty]">
        Ranked in Qloo&apos;s order for {r.city.name}. Availability and fees are to confirm with each act&apos;s agent.{" "}
        <Link href={`/venue?city=${encodeURIComponent(r.city.name)}`}>Open in the Venue booker</Link>
      </p>
    </>
  );
}
