"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { TourResult } from "@/lib/tools/tour";

import { GeoMap } from "../geo-map";
import { categoryLabel, pct } from "../run/format";
import { planHref } from "../showcase";
import { Banner, DataTable, MonoLabel, Num, OutlineChip, Panel, Segmented, Sk, SourceBadge } from "../ui";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [{ label: "Phoebe Bridgers" }, { label: "John Mulaney" }, { label: "Call Her Daddy" }, { label: "Black Country, New Road" }];
type Stops = "4" | "6" | "8";

export function TourPlanner() {
  const [stops, setStops] = useState<Stops>("6");
  // The request builder is kept from the first render, so it reads the stop count from a ref.
  const stopsRef = useRef<Stops>("6");
  const { value, state, submit, pick, retry } = useToolQuery<TourResult>("/api/tools/tour", "q", (fanbase, entityId) => ({
    fanbase,
    entityId,
    stops: Number(stopsRef.current),
  }));
  const r = state.data;
  const best = r?.status === "done" ? Math.max(...r.tour.stops.map((s) => s.combined)) : 0;
  return (
    <>
      <ToolIntro
        label="Tour planner"
        title="Route a tour through the fans"
        body="For artists, comedians and their agents. Type a fanbase and get a tour through its strongest cities, in driving order, with the distance of every leg. Stops are at least 150 km apart so they don't split one crowd."
      />
      <ToolForm initial={value} placeholder="A fanbase, e.g. Phoebe Bridgers" button="Plan the tour" examples={EXAMPLES} onSubmit={submit} busy={state.loading} />
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel>Stops</MonoLabel>
        <Segmented
          label="Number of stops"
          options={[
            { value: "4", label: "4" },
            { value: "6", label: "6" },
            { value: "8", label: "8" },
          ]}
          value={stops}
          onChange={(s) => {
            stopsRef.current = s;
            setStops(s);
            if (value) retry();
          }}
          mono
        />
      </div>

      {state.error && <ToolError message={state.error} onRetry={retry} />}
      {state.loading && <Sk.map />}
      {r?.status === "none" && <Banner tone="neutral">We couldn&apos;t find a fanbase called “{value}”. Try one of the examples.</Banner>}
      {r?.status === "choose" && r.choices && <ChoicePicker question={r.question ?? "Which one?"} choices={r.choices} onPick={pick} />}
      {r?.status === "done" && (
        <>
          <SampleBanner mock={r.mock} />
          <section className="flex flex-col gap-2">
            <MonoLabel>Tour</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{r.fanbase.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <OutlineChip>{categoryLabel(r.fanbase.category)}</OutlineChip>
              <OutlineChip>{r.market.name}</OutlineChip>
              <OutlineChip>
                {r.tour.stops.length} stops · {r.tour.totalKm.toLocaleString("en-GB")} km
              </OutlineChip>
            </div>
          </section>
          {r.tour.fallback && <Banner tone="warn">{r.tour.reason}</Banner>}
          {r.tour.stops.length > 0 && (
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <MonoLabel className="text-acc-text">Route</MonoLabel>
                <SourceBadge>urn:heatmap</SourceBadge>
              </div>
              <div className="grid items-start gap-[18px] md:grid-cols-2">
                <GeoMap
                  points={r.tour.stops.map((s, i) => ({
                    id: s.city.id,
                    name: `${i + 1}. ${s.city.name}`,
                    lat: s.city.lat,
                    lon: s.city.lon,
                    value: String(pct(s.combined)),
                    size: s.combined === best ? 22 : 14,
                    tone: s.combined === best ? "acc" : "mute",
                    ring: s.combined === best,
                  }))}
                  route={r.tour.stops.map((s) => s.city)}
                  label={`Map of a ${r.tour.stops.length}-stop tour route for ${r.fanbase.name}`}
                />
                <DataTable
                  columns={["Stop", "City", "Heat", "Leg"]}
                  template="3em minmax(0,1fr) 3.5em 6em"
                  rows={r.tour.stops.map((s, i) => [
                    <Num key="n" mute>
                      {String(i + 1).padStart(2, "0")}
                    </Num>,
                    <span key="c">
                      {s.city.name}
                      <span className="text-mute">, {s.city.admin1 || s.city.country}</span>
                    </span>,
                    <Num key="h" top={s.combined === best}>
                      {pct(s.combined)}
                    </Num>,
                    <Num key="l" mute>
                      {i === 0 ? "start" : `${Math.round(s.legKm).toLocaleString("en-GB")} km`}
                    </Num>,
                  ])}
                />
              </div>
              <p className="m-0 text-chip text-mute">
                Always includes the strongest city; the stops are in the order of the shortest route. Heat is 0–100 against the strongest
                city in {r.market.name}. Venues, dates and fees are to confirm with the promoter.
              </p>
            </Panel>
          )}
          <Link href={planHref(r.fanbase.name)} className="self-start rounded-btn bg-acc px-3.5 py-2 text-chip font-medium text-on-acc no-underline">
            Plan the opening takeover →
          </Link>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}
