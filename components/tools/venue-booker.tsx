"use client";

import type { BookingResult } from "@/lib/tools/venue";

import { MonoLabel, OutlineChip, Sk } from "../ui";
import { BookingLists } from "./city-taste";
import { CallsUsed, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

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
          <BookingLists lists={r.lists} onRetry={retry} />
          <p className="m-0 text-chip text-mute [text-wrap:pretty]">
            Ranked in Qloo&apos;s order for {r.city.name}. Availability and fees are to confirm with each act&apos;s agent.
          </p>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}
