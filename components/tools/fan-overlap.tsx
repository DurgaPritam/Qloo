"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { OverlapLevel } from "@/lib/engine/overlap";
import type { OverlapResult } from "@/lib/tools/overlap";

import { AudienceGrid } from "../audience";
import { categoryLabel, pct } from "../run/format";
import { planHref } from "../showcase";
import { Banner, Button, Chip, MonoLabel, Panel, Sk, SourceBadge } from "../ui";
import { CityMap, CityTable } from "./city-table";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolIntro } from "./tool-kit";

export const PAIRS = [
  ["Taylor Swift", "Formula One"],
  ["Phoebe Bridgers", "PEN15"],
  ["Bad Bunny", "WWE"],
  ["John Mulaney", "Succession"],
  ["Arsenal", "Drake"],
] as const;

const LEVEL: Record<OverlapLevel, { title: string; body: string }> = {
  strong: { title: "Strong overlap", body: "As high as a typical top crossover partner on Takeover." },
  clear: { title: "Clear overlap", body: "Fans over-index on each other, a little below a top crossover." },
  some: { title: "Some overlap", body: "Fans share some taste, but a stronger partner probably exists." },
  unknown: { title: "No direct score", body: "Qloo returned no score for this pair; the cities below still show where both are strong." },
};

export const overlapHref = (a: string, b: string) => `/overlap?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;

/** Two names in one form; used here and on the landing page. */
export function OverlapForm({ initial = ["", ""] as const, onSubmit }: { initial?: readonly [string, string]; onSubmit: (a: string, b: string) => void }) {
  const [ia, ib] = initial;
  const [a, setA] = useState<string>(ia);
  const [b, setB] = useState<string>(ib);
  // Follow the URL (an example pair, Back).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setA(ia), [ia]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setB(ib), [ib]);
  const field = "min-w-0 flex-1 rounded-btn border-th border-line bg-bg px-3 py-2.5 font-body text-[17px] text-ink outline-none focus:border-acc-line";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (a.trim() && b.trim()) onSubmit(a.trim(), b.trim());
      }}
      className="flex flex-wrap items-center gap-2 rounded-md border-th border-line bg-surf p-2 shadow-card"
    >
      <input value={a} onChange={(e) => setA(e.target.value)} placeholder="A fanbase, e.g. Taylor Swift" aria-label="First fanbase" maxLength={100} className={field} />
      <span className="t-display flex-none px-1 text-[22px] text-mute" aria-hidden>
        ×
      </span>
      <input value={b} onChange={(e) => setB(e.target.value)} placeholder="Another, e.g. Formula One" aria-label="Second fanbase" maxLength={100} className={field} />
      <Button type="submit" variant="primary" className="px-4 py-2.5 text-body">
        Check overlap
      </Button>
    </form>
  );
}

export function FanOverlap() {
  const params = useSearchParams();
  const router = useRouter();
  const a = (params.get("a") ?? "").trim();
  const b = (params.get("b") ?? "").trim();
  const aId = params.get("aId") ?? undefined;
  const bId = params.get("bId") ?? undefined;
  const key = [a, b, aId, bId].join("|");
  const [state, setState] = useState<{ key: string; data?: OverlapResult; error?: string }>({ key: "" });

  const load = () => {
    setState({ key: `loading:${key}` });
    fetch("/api/tools/overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a, b, aId, bId }),
    })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as OverlapResult & { error?: string } }))
      .then(({ ok, body }) => setState(ok ? { key, data: body } : { key, error: body.error ?? "Something went wrong." }))
      .catch(() => setState({ key, error: "Network error. Check your connection and try again." }));
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch for the pair in the URL
    if (a && b && state.key !== key && state.key !== `loading:${key}`) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const go = (x: string, y: string) => router.push(overlapHref(x, y));
  const loading = Boolean(a && b) && state.key !== key;
  const r = state.key === key ? state.data : undefined;
  const pickSide = (side: "a" | "b", id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(side === "a" ? "aId" : "bId", id);
    router.push(`/overlap?${next.toString()}`);
  };

  return (
    <>
      <ToolIntro
        label="Fan overlap"
        title="Would these fans mix?"
        body="Type any two names: artists, comedians, shows, teams, brands. See how strongly their fans over-index on each other, the cities where both are strong, and who the fans are. All from Qloo."
      />
      <OverlapForm initial={[a, b]} onSubmit={go} />
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel>Try</MonoLabel>
        {PAIRS.map(([x, y]) => (
          <Chip key={x + y} label={`${x} × ${y}`} onClick={() => go(x, y)} />
        ))}
      </div>

      {state.key === key && state.error && <ToolError message={state.error} onRetry={load} />}
      {loading && <Sk.block />}
      {r?.status === "none" && <Banner tone="neutral">We couldn&apos;t find “{r.query}”. Check the spelling, or try an example.</Banner>}
      {r?.status === "choose" && <ChoicePicker question={r.question} choices={r.choices} onPick={(id) => pickSide(r.side, id)} />}
      {r?.status === "done" && (
        <>
          <SampleBanner mock={r.mock} />
          <section className="flex flex-col gap-2">
            <MonoLabel>Overlap</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.95] [overflow-wrap:anywhere]">
              {r.a.name} × {r.b.name}
            </h2>
          </section>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonoLabel className="text-acc-text">{LEVEL[r.level].title}</MonoLabel>
              <SourceBadge>filter.results.entities</SourceBadge>
            </div>
            <p className="m-0 text-body [text-wrap:pretty]">{LEVEL[r.level].body}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { who: r.b, among: r.a, value: r.bAmongA },
                { who: r.a, among: r.b, value: r.aAmongB },
              ].map((d) => (
                <div key={d.who.id} className="flex flex-col gap-1 rounded-md border-th border-line p-3.5">
                  <MonoLabel>
                    {d.who.name} among {d.among.name} fans
                  </MonoLabel>
                  <div className="t-display text-[32px] leading-none">{d.value == null ? "—" : pct(d.value)}</div>
                  <div className="text-chip text-mute">{d.value == null ? "Qloo returned no score this way round." : `Affinity ${d.value.toFixed(2)}`}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonoLabel className="text-acc-text">Where both are strong · {r.market.name}</MonoLabel>
              <SourceBadge>urn:heatmap</SourceBadge>
            </div>
            {r.cities.length ? (
              <div className="grid items-start gap-[18px] md:grid-cols-2">
                <CityMap cities={r.cities} label={`Map of the cities where both ${r.a.name} and ${r.b.name} fans are strong`} />
                <CityTable cities={r.cities} />
              </div>
            ) : (
              <p className="m-0 text-chip text-mute">Qloo has no city-level heat for both of them in {r.market.name}.</p>
            )}
            <p className="m-0 text-chip text-mute">Heat combines both audiences (both must be strong), 0–100 against the best city.</p>
          </Panel>
          {r.audiences.length > 0 && (
            <AudienceGrid
              items={r.audiences.flatMap((p) => {
                const e = [r.a, r.b].find((x) => x.id === p.entityId);
                return e ? [{ name: e.name, profile: p }] : [];
              })}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {[r.a, r.b].map((e) => (
              <Link
                key={e.id}
                href={planHref(e.name)}
                className="rounded-btn bg-acc px-3.5 py-2 text-chip font-medium text-on-acc no-underline"
              >
                Plan a takeover for {e.name} ({categoryLabel(e.category)}) →
              </Link>
            ))}
          </div>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}
