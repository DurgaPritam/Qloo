"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { TourResult } from "@/lib/tools/tour";

import { FIELD } from "../account/fields";
import { GeoMap } from "../geo-map";
import { categoryLabel, pct } from "../run/format";
import { planHref } from "../showcase";
import { Banner, Button, ConfirmPill, cx, MonoLabel, OutlineChip, Panel, ScoreBar, Sk, SourceBadge, YourDataBadge } from "../ui";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [{ label: "Phoebe Bridgers" }, { label: "John Mulaney" }, { label: "Call Her Daddy" }, { label: "Black Country, New Road" }];

/** Same keys as lib/tools/tour.ts REGIONS, plus single countries. */
const REGION_OPTIONS = [
  { value: "", label: "The fanbase's home country" },
  { value: "US", label: "United States" },
  { value: "us-ca", label: "United States and Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "uk-ie", label: "UK and Ireland" },
  { value: "w-europe", label: "Western Europe" },
  { value: "au-nz", label: "Australia and New Zealand" },
];
const VENUE_BANDS = ["", "Club · under 500", "Theater · 500–3k", "Arena · 3k+"];

interface Constraints {
  region: string;
  stops: number;
  maxLegKm: string;
  start: string;
  end: string;
  include: string;
  exclude: string;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function TourPlanner() {
  const [c, setC] = useState<Constraints>({ region: "", stops: 5, maxLegKm: "", start: "", end: "", include: "", exclude: "" });
  const [dates, setDates] = useState({ from: "", to: "" });
  const [stopInfo, setStopInfo] = useState<Record<string, { band: string; date: string }>>({});
  // The request builder is kept from the first render, so it reads the constraints from a ref.
  const ref = useRef(c);
  const { value, state, submit, pick, retry } = useToolQuery<TourResult>("/api/tools/tour", "q", (fanbase, entityId) => ({
    fanbase,
    entityId,
    region: ref.current.region,
    stops: ref.current.stops,
    maxLegKm: ref.current.maxLegKm ? Number(ref.current.maxLegKm.replace(/[\s,]/g, "")) : null,
    start: ref.current.start,
    end: ref.current.end,
    include: list(ref.current.include),
    exclude: list(ref.current.exclude),
  }));
  const r = state.data;
  const set = (patch: Partial<Constraints>) => {
    const next = { ...c, ...patch };
    ref.current = next;
    setC(next);
  };
  const info = (id: string) => stopInfo[id] ?? { band: "", date: "" };

  return (
    <>
      <ToolIntro
        label="Tools"
        title="Tour optimizer"
        body="Routes a fanbase through the cities where its fans over-index, inside your constraints: stops, the longest drive you accept, where to start and end, cities to keep or skip. Every leg is measured from coordinates, and strong cities left off say why."
      />
      <ToolForm initial={value} placeholder="A fanbase, e.g. Phoebe Bridgers" button="Optimize route" examples={EXAMPLES} onSubmit={submit} busy={state.loading} />

      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoLabel>Constraints</MonoLabel>
            <YourDataBadge />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-chip">
              From
              <input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} aria-label="From" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-chip">
              To
              <input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} aria-label="To" className={FIELD} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-chip">
            Region
            <select aria-label="Region" value={c.region} onChange={(e) => set({ region: e.target.value })} className={cx(FIELD, "cursor-pointer")}>
              {REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-chip">
            Stops
            <div className="flex items-center gap-3">
              <Button aria-label="Fewer stops" onClick={() => set({ stops: Math.max(2, c.stops - 1) })} className="min-h-[40px] min-w-[44px] text-body">
                −
              </Button>
              <span className="tabular w-6 text-center font-mono text-body" aria-live="polite" data-stops>
                {c.stops}
              </span>
              <Button aria-label="More stops" onClick={() => set({ stops: Math.min(12, c.stops + 1) })} className="min-h-[40px] min-w-[44px] text-body">
                +
              </Button>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-chip">
            Longest leg (km)
            <input inputMode="numeric" value={c.maxLegKm} onChange={(e) => set({ maxLegKm: e.target.value })} placeholder="No limit" aria-label="Longest leg (km)" className={FIELD} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-chip">
              Start city
              <input value={c.start} onChange={(e) => set({ start: e.target.value })} placeholder="Optional" aria-label="Start city" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-chip">
              End city
              <input value={c.end} onChange={(e) => set({ end: e.target.value })} placeholder="Optional" aria-label="End city" className={FIELD} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-chip">
            Must include
            <input value={c.include} onChange={(e) => set({ include: e.target.value })} placeholder="Cities, separated by commas" aria-label="Must include" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-chip">
            Skip
            <input value={c.exclude} onChange={(e) => set({ exclude: e.target.value })} placeholder="Cities, separated by commas" aria-label="Skip" className={FIELD} />
          </label>
          <Button variant="primary" disabled={!value} loading={state.loading} onClick={retry} className="min-h-[44px]">
            Optimize route
          </Button>
          <span className="text-chip text-mute">Your constraints shape the route; they never change a Qloo score. Dates are yours to set, never suggested.</span>
        </Panel>

        <div className="flex min-w-0 flex-col gap-[18px]">
          {!value && !state.loading && <Banner tone="neutral">Type a fanbase above to route its tour.</Banner>}
          {state.error && <ToolError message={state.error} onRetry={retry} />}
          {state.loading && <Sk.map />}
          {r?.status === "none" && <Banner tone="neutral">We couldn&apos;t find a fanbase called “{value}”. Try one of the examples.</Banner>}
          {r?.status === "choose" && r.choices && <ChoicePicker question={r.question ?? "Which one?"} choices={r.choices} onPick={pick} />}
          {r?.status === "done" && (
            <>
              <SampleBanner mock={r.mock} />
              {r.understood.unmatched.length > 0 && <Banner tone="warn">Not found in the region, so left out of the constraints: {r.understood.unmatched.join(", ")}.</Banner>}
              {r.missing.length > 0 && <Banner tone="warn">Qloo had no city data for {r.missing.join(", ")} right now; its cities are left out.</Banner>}
              {r.route.infeasible ? (
                <Banner tone="warn">{r.route.infeasible}</Banner>
              ) : (
                <Panel>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <MonoLabel>
                      Route · {r.route.stops.length} stops · {r.markets.map((m) => m.name).join(", ")}
                    </MonoLabel>
                    <OutlineChip>{categoryLabel(r.fanbase.category)}</OutlineChip>
                  </div>
                  {r.route.note && <Banner tone="warn">{r.route.note}</Banner>}
                  {(dates.from || dates.to) && (
                    <span className="flex flex-wrap items-center gap-2 text-chip">
                      Your window: {dates.from || "?"} to {dates.to || "?"} <YourDataBadge />
                    </span>
                  )}
                  <GeoMap
                    points={r.route.stops.map((s, i) => ({
                      id: s.city.id,
                      name: `${String(i + 1).padStart(2, "0")} · ${s.city.name}`,
                      lat: s.city.lat,
                      lon: s.city.lon,
                      value: String(pct(s.city.score)),
                      size: 16,
                      tone: "acc",
                      ring: i === 0,
                    }))}
                    route={r.route.stops.map((s) => s.city)}
                    label={`Map of a ${r.route.stops.length}-stop tour route for ${r.fanbase.name}`}
                  />
                  <ol className="m-0 flex list-none flex-col p-0" aria-label="Stops">
                    {r.route.stops.map((s, i) => {
                      const next = r.route.stops[i + 1];
                      const call = r.heatCalls[s.city.country];
                      return (
                        <li key={s.city.id} className="flex flex-col gap-1.5 border-b border-line py-3" data-stop={s.city.name}>
                          <div className="grid grid-cols-[2.5em_minmax(0,1fr)_minmax(110px,180px)] items-start gap-3">
                            <span className="tabular font-mono text-label text-acc-text">{String(i + 1).padStart(2, "0")}</span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="flex flex-wrap items-center gap-2 font-semibold">
                                {s.city.name}
                                {s.role !== "chosen" && <OutlineChip>{s.role === "included" ? "you included it" : s.role}</OutlineChip>}
                              </span>
                              <span className="text-chip text-mute" data-evidence>
                                {s.city.cells > 0 ? `Qloo heat ${pct(s.city.score)} / 100 over ${s.city.cells} cells, against the hottest city in ${s.city.country}` : "No Qloo heat here; on the route because you named it"}
                              </span>
                              {call && <span className="font-mono text-label text-mute [overflow-wrap:anywhere]">GET {call.endpoint} · {Object.entries(call.params).filter(([k]) => k.startsWith("filter") || k.startsWith("signal")).map(([k, v]) => `${k}=${v}`).join(" · ")}</span>}
                              <span className="flex flex-wrap items-center gap-2 pt-1 text-chip">
                                <select
                                  aria-label={`Venue size in ${s.city.name}`}
                                  value={info(s.city.id).band}
                                  onChange={(e) => setStopInfo({ ...stopInfo, [s.city.id]: { ...info(s.city.id), band: e.target.value } })}
                                  className={cx(FIELD, "cursor-pointer py-1 text-chip")}
                                >
                                  {VENUE_BANDS.map((b) => (
                                    <option key={b} value={b}>
                                      {b || "Venue size: not set"}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  aria-label={`Date in ${s.city.name}`}
                                  value={info(s.city.id).date}
                                  onChange={(e) => setStopInfo({ ...stopInfo, [s.city.id]: { ...info(s.city.id), date: e.target.value } })}
                                  className={cx(FIELD, "py-1 text-chip")}
                                />
                                {info(s.city.id).band || info(s.city.id).date ? <YourDataBadge /> : <ConfirmPill>Date to confirm with the promoter</ConfirmPill>}
                              </span>
                            </span>
                            <ScoreBar value={pct(s.city.score)} label={`${pct(s.city.score)}`} />
                          </div>
                          {next && (
                            <span className="pl-[3.25em] font-mono text-label text-mute" data-leg>
                              ↓ Leg {String(i + 1).padStart(2, "0")} · {s.city.name} → {next.city.name} · {next.legKm.toLocaleString("en-GB")} km
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex flex-col gap-1 text-chip" data-objective>
                    <span className="font-mono">
                      Route score {r.route.scoreSum.toFixed(0)} − distance {r.route.penalty.toFixed(1)} = {r.route.objective.toFixed(1)}
                    </span>
                    <span className="text-mute">
                      Total {r.route.totalKm.toLocaleString("en-GB")} km, straight-line between city centres. Distance costs {r.route.distanceWeight} points per 1,000 km.
                      {r.route.method === "exact" ? " Searched every order." : " Found by greedy insertion, 2-opt and swaps (too many cities to try every order)."}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
                    <SourceBadge /> Stop scores are Qloo signal. Venues, dates and fees are to confirm with the promoter.
                  </span>
                </Panel>
              )}
              {r.route.whyNot.length > 0 && (
                <Panel>
                  <MonoLabel>Why not · strong cities left off</MonoLabel>
                  <ul className="m-0 flex list-none flex-col p-0" aria-label="Why not">
                    {r.route.whyNot.map((w) => (
                      <li key={w.city.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-line py-2" data-why-not={w.city.name}>
                        <span className="font-medium">{w.city.name}</span>
                        <span className="tabular font-mono text-chip">{pct(w.city.score)} / 100</span>
                        <span className="col-span-2 text-chip text-mute">{w.reason.text}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Link href={planHref(r.fanbase.name)} className="self-start rounded-btn bg-acc px-3.5 py-2 text-chip font-medium text-on-acc no-underline">
                Plan the opening takeover →
              </Link>
              <CallsUsed calls={r.calls} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
