"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ReportView } from "@/lib/export/outcomes";
import type { PlanOutcome } from "@/lib/outcomes/service";

import { FIELD } from "../account/fields";
import { Banner, Button, CombinedBadge, cx, MonoLabel, Panel, Segmented, SourceBadge, YourDataBadge } from "../ui";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-GB"));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Tile({ label, value, badge, hint }: { label: string; value: string; badge: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg p-3.5">
      <MonoLabel>{label}</MonoLabel>
      <span className="t-display text-[40px] leading-none">{value}</span>
      <span>{badge}</span>
      {hint && <span className="text-chip text-mute">{hint}</span>}
    </div>
  );
}

const FIELDS = [
  { key: "attendance", label: "Attendance", hint: "People through the door", mode: "numeric" },
  { key: "ticketsSold", label: "Tickets sold", hint: "From your box office report", mode: "numeric" },
  { key: "capacity", label: "Sellable capacity", hint: "As confirmed with the promoter", mode: "numeric" },
  { key: "gross", label: "Gross", hint: "In your currency, before fees", mode: "decimal" },
] as const;

export function OutcomeScreen({ initial, canLog }: { initial: PlanOutcome; canLog: boolean }) {
  const router = useRouter();
  const o = initial.outcome;
  const [tab, setTab] = useState<"log" | "compare">(o ? "compare" : "log");
  const [values, setValues] = useState<Record<string, string>>({
    attendance: o?.attendance?.toString() ?? "",
    ticketsSold: o?.ticketsSold?.toString() ?? "",
    capacity: o?.capacity?.toString() ?? "",
    gross: o?.gross?.toString() ?? "",
  });
  const [renewed, setRenewed] = useState<"yes" | "no" | "unknown">(o?.sponsorRenewed === true ? "yes" : o?.sponsorRenewed === false ? "no" : "unknown");
  const [notes, setNotes] = useState(o?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspace/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: initial.plan.id, ...values, sponsorRenewed: renewed === "yes" ? true : renewed === "no" ? false : null, notes }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.");
    router.refresh();
    setTab("compare");
  };

  const p = initial.plan;
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <MonoLabel>Outcomes</MonoLabel>
          <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92] [overflow-wrap:anywhere]">{p.title}</h1>
          <span className="text-chip text-mute">
            {[p.city, p.venue].filter(Boolean).join(" · ")}
            {initial.predictedAt ? ` · predictions frozen ${day(initial.predictedAt)}` : ""}
          </span>
        </div>
        <Segmented
          label="Outcomes"
          options={[
            { value: "log", label: "Log results" },
            { value: "compare", label: "Predicted vs actual" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {error && <Banner tone="err">{error}</Banner>}

      {tab === "log" ? (
        canLog ? (
          <Panel>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <MonoLabel>Log results</MonoLabel>
              <span className="text-chip text-mute">Everything on this form is your data. Qloo never fills it in. Every field is optional.</span>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
                {FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2 text-body">
                      {f.label} <YourDataBadge />
                    </span>
                    <input inputMode={f.mode} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-label={f.label} className={cx(FIELD, "font-mono")} />
                    <span className="text-chip text-mute">{f.hint}</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-2 text-body">
                  Sponsor renewed <YourDataBadge />
                </span>
                <Segmented
                  label="Sponsor renewed"
                  options={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                    { value: "unknown", label: "Not known" },
                  ]}
                  value={renewed}
                  onChange={setRenewed}
                />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-body">
                  Notes <YourDataBadge />
                </span>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="What worked, what didn't" aria-label="Notes" className={FIELD} />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" loading={busy} className="min-h-[44px] px-4">
                  Save and compare
                </Button>
                <span className="text-chip text-mute">Saved values replace earlier entries for this event.</span>
              </div>
            </form>
          </Panel>
        ) : (
          <Banner tone="neutral">Members log results; your role can view them.</Banner>
        )
      ) : (
        <Compare data={initial} />
      )}
    </div>
  );
}

function Compare({ data }: { data: PlanOutcome }) {
  const o = data.outcome;
  if (!o) return <Banner tone="neutral">No results logged yet. Log them after the event to compare with what the plan predicted.</Banner>;
  return (
    <Panel>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
        <Tile label="Sell-through" value={pct(data.sellThrough)} badge={<YourDataBadge />} hint={data.sellThrough === null ? "Needs tickets sold and capacity" : `${num(o.ticketsSold)} of ${num(o.capacity)}`} />
        <Tile label="Attendance" value={num(o.attendance)} badge={<YourDataBadge />} />
        <Tile label="Gross" value={num(o.gross)} badge={<YourDataBadge />} hint="In your currency, as entered" />
        <Tile
          label="Against your median"
          value={data.report.judged && data.report.median !== null ? pct(data.report.median) : "—"}
          badge={<CombinedBadge />}
          hint={data.report.judged ? `Median sell-through over ${data.report.sample} events` : `Too few events to judge: ${data.report.sample} of ${data.report.minSample}`}
        />
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-[640px] flex-col text-body" role="table" aria-label="Predicted vs actual">
          <div role="row" className="grid grid-cols-[8em_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-line pb-2 font-mono text-label uppercase tracking-[0.06em] text-mute">
            <span role="columnheader">Metric</span>
            <span role="columnheader">◆ Predicted · Qloo</span>
            <span role="columnheader">■ Actual · your data</span>
            <span role="columnheader" className="text-right">
              Result
            </span>
          </div>
          {data.lines.map((l) => (
            <div role="row" key={l.metric} className="grid grid-cols-[8em_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-line py-3" data-line={l.metric}>
              <span role="cell" className="font-semibold">
                {l.metric}
              </span>
              <span role="cell">{l.predicted}</span>
              <span role="cell">{l.actual}</span>
              <span role="cell" className={cx("text-right font-mono text-label uppercase tracking-[0.06em]", l.tone === "good" ? "text-acc-text" : l.tone === "bad" ? "text-warn" : "text-mute")}>
                {l.result}
              </span>
            </div>
          ))}
        </div>
      </div>
      {o.notes && (
        <p className="m-0 text-chip">
          <YourDataBadge /> {o.notes}
        </p>
      )}
      <span className="text-chip text-mute">
        Predictions are the plan&apos;s own, frozen when it was made{data.backfilled ? " (read from the plan as it was saved, which was before Outcomes existed)" : ""}; they are never recomputed. Outcomes stay in this
        workspace, are never shared with Qloo and never change a score.
      </span>
    </Panel>
  );
}

const groupLabel = (g: ReportView["cities"][number]) => (g.judged ? `${g.above} of ${g.events} above` : `too few events to judge (${g.events})`);

export function OutcomesReport({ view, plans, canLog }: { view: ReportView; plans: { id: string; label: string; logged: boolean }[]; canLog: boolean }) {
  const [busy, setBusy] = useState(false);
  const csv = async () => {
    const [{ outcomesCsv, outcomesFileName }, { save }] = await Promise.all([import("@/lib/export/outcomes"), import("../run/exports")]);
    save(new Blob([outcomesCsv(view)], { type: "text/csv;charset=utf-8" }), outcomesFileName(view, "csv"));
  };
  const deck = async () => {
    setBusy(true);
    try {
      const [{ outcomesOutline, outcomesFileName }, { renderDeck, loadBranding }] = await Promise.all([import("@/lib/export/outcomes"), import("../run/exports")]);
      await renderDeck(outcomesOutline(view), { title: `${view.workspace}: outcomes`, footer: "Results are your data; predictions are frozen Qloo-based plans.", mock: false, fileName: outcomesFileName(view, "pptx"), branding: await loadBranding() });
    } finally {
      setBusy(false);
    }
  };

  if (!plans.length) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-10 sm:px-12">
        <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">No outcomes yet</h2>
        <p className="m-0 max-w-[440px] text-body text-mute">After an event, log what happened on its plan. Takeover compares it with what the plan predicted.</p>
        <Link href="/" className="inline-flex min-h-[44px] items-center rounded-btn bg-acc px-4 text-chip font-medium text-on-acc no-underline border-card border-ink">
          Plan a takeover
        </Link>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-[18px]">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MonoLabel>Report · all logged events</MonoLabel>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void csv()} disabled={!view.rows.length}>
              Export CSV
            </Button>
            <Button onClick={() => void deck()} loading={busy} disabled={!view.rows.length}>
              Export deck
            </Button>
          </div>
        </div>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          <Tile label="Events with sell-through" value={String(view.sample)} badge={<YourDataBadge />} hint={`${view.rows.length} logged in all`} />
          <Tile label="Median sell-through" value={pct(view.median)} badge={<YourDataBadge />} />
          <Tile label="Above the median" value={view.judged ? `${view.aboveMedian}/${view.sample}` : "—"} badge={<CombinedBadge />} hint={view.judged ? undefined : `Too few events to judge: ${view.sample} of ${view.minSample}`} />
        </div>
        {!view.judged && (
          <Banner tone="neutral" data-too-few>
            Too few events to judge: {view.sample} of the {view.minSample} needed have tickets sold and capacity logged.
          </Banner>
        )}
        {view.judged && (
          <div className="grid gap-[18px] md:grid-cols-2">
            {[
              ["Chosen cities", view.cities],
              ["Chosen partners", view.partners],
            ].map(([label, groups]) => (
              <div key={label as string} className="flex flex-col gap-1.5">
                <MonoLabel>{label as string} · above your median</MonoLabel>
                {(groups as ReportView["cities"]).map((g) => (
                  <span key={g.id} className="flex justify-between gap-2 border-b border-line py-1.5 text-chip">
                    <span>{g.name}</span>
                    <span className={cx("font-mono", g.judged ? "" : "text-mute")}>{groupLabel(g)}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
          <SourceBadge /> Predictions frozen at plan time. <YourDataBadge /> Results entered by your team. A group needs {view.minSample} events before it is judged.
        </span>
      </Panel>
      <Panel>
        <MonoLabel>Plans</MonoLabel>
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Plans">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2.5" data-plan={p.label}>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{p.label}</span>
              <Link href={`/workspace/outcomes/${p.id}`} className="text-chip">
                {p.logged ? "Predicted vs actual →" : canLog ? "Log results →" : "No results yet"}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
