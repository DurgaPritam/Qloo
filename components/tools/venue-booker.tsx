"use client";

import type { BookingResult } from "@/lib/tools/venue";

import { categoryLabel } from "../run/format";
import { Button, MonoLabel, OutlineChip, Panel, Sk, SourceBadge } from "../ui";
import { CallsUsed, RankRow, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [{ label: "Austin" }, { label: "Nashville" }, { label: "Atlanta" }, { label: "Seattle" }, { label: "Manchester, UK" }];

export function VenueBooker() {
  const { value, state, submit, retry } = useToolQuery<BookingResult>("/api/tools/venue", "city", (city) => ({ city }));
  const r = state.data;
  return (
    <>
      <ToolIntro
        label="Venue booker"
        title="Who should you book in your city?"
        body="For venues, promoters and festivals. Type a city and see the artists, stand-up comedians and podcasts people there over-index on, from Qloo. Then plan a takeover with any of them."
      />
      <ToolForm initial={value} placeholder="Your city, e.g. Austin" button="Find who to book" examples={EXAMPLES} onSubmit={submit} busy={state.loading} />

      {state.error && <ToolError message={state.error} onRetry={retry} />}
      {state.loading && (
        <div className="grid gap-2 md:grid-cols-3">
          <Sk.block />
          <Sk.block />
          <Sk.block />
        </div>
      )}
      {r && (
        <>
          <SampleBanner mock={r.mock} />
          <section className="flex flex-col gap-2">
            <MonoLabel>Local favourites</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{r.city.name}</h2>
            <div className="flex flex-wrap gap-1.5">
              {r.city.admin1 && <OutlineChip>{r.city.admin1}</OutlineChip>}
              <OutlineChip>{r.city.country}</OutlineChip>
              <OutlineChip>Population {r.city.population.toLocaleString("en-GB")}</OutlineChip>
            </div>
          </section>
          <div className="grid items-start gap-[18px] lg:grid-cols-3">
            {r.lists.map((list) => (
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
          <p className="m-0 text-chip text-mute [text-wrap:pretty]">
            Ranked in Qloo&apos;s order for {r.city.name}. Availability and fees are to confirm with each act&apos;s agent.
          </p>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}
