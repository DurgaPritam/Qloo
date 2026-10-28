"use client";

import { useEffect, useMemo, useState } from "react";

import { bestLineup, type LineupPick } from "@/lib/engine/lineup";
import type { LineupDraft, PoolResult, Tier } from "@/lib/tools/lineup-pool";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, MonoLabel, Panel, YourDataBadge } from "../ui";

/**
 * Lineup optimizer (design: LineupOptimizer). Qloo gives each candidate's fit with the headliner's
 * audience; the budget, fee tiers and each act's tier are the user's. The engine picks the bill.
 */
const TIERS: Tier[] = ["A", "B", "C"];
const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function LineupOptimizer({ plans, canEdit }: { plans: { id: string; label: string }[]; canEdit: boolean }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<LineupDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [slots, setSlots] = useState(3);
  const [fees, setFees] = useState<Record<Tier, string>>({ A: "", B: "", C: "" });
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [headTier, setHeadTier] = useState<Tier>("A");

  const load = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/workspace/lineup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as PoolResult & { error?: string };
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "That didn't work.");
    if (data.status === "none") return setError(`Qloo has no headliner matching “${query}”.`);
    if (data.status === "choose") return setError(`${data.question} Pick one of: ${data.choices.map((c) => c.name).join(", ")}; type it more exactly.`);
    setDraft(data);
    setTiers(Object.fromEntries(data.pool.map((a) => [a.id, "B" as Tier])));
  };

  const pick: LineupPick | null = useMemo(() => {
    if (!draft || !budget.trim()) return null;
    const fee = (t: Tier) => num(fees[t]);
    return bestLineup(
      { id: draft.headliner.id, name: draft.headliner.name, fit: null, fee: fee(headTier) },
      draft.pool.map((a) => ({ id: a.id, name: a.name, fit: a.fit, fee: fee(tiers[a.id] ?? "B") })),
      { slots, budget: num(budget) },
    );
  }, [draft, budget, fees, tiers, headTier, slots]);
  const chosen = new Set(pick?.slots.map((s) => s.id) ?? []);

  const save = async () => {
    if (!draft) return;
    setError(null);
    const res = await fetch("/api/workspace/lineup/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.draftId, budget: num(budget), slots, fees: { A: num(fees.A), B: num(fees.B), C: num(fees.C) }, tiers, headlinerTier: headTier }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
    if (!res?.ok) return setError(data.error ?? "That didn't work.");
    setSaved("Added to the plan. It shows on the plan's page.");
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Tools</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Lineup optimizer</h1>
        <p className="m-0 text-chip text-mute">
          {draft
            ? `${draft.city ? `${draft.city} · ` : ""}Picks the strongest lineup for the ${draft.headliner.name} audience inside your budget.`
            : "Picks the strongest lineup for a headliner's audience inside your budget."}
        </p>
      </section>
      {error && <Banner tone="err">{error}</Banner>}
      {saved && <Banner tone="info">{saved}</Banner>}

      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(planId ? { planId } : { query });
          }}
        >
          <MonoLabel>Headliner</MonoLabel>
          <select aria-label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className={cx(FIELD, "min-w-0 flex-1 basis-[220px] cursor-pointer")}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="">Someone else (type below)</option>
          </select>
          {!planId && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="A headliner, e.g. Ali Wong"
              aria-label="Headliner"
              maxLength={100}
              className={cx(FIELD, "min-w-0 flex-1 basis-[200px]")}
            />
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={!planId && !query.trim()} className="min-h-[44px] px-4">
            Find candidates
          </Button>
          <span className="w-full text-chip text-mute">Uses up to 4 Qloo calls. Fees are never suggested: you set them.</span>
        </form>
      )}

      {draft && (
        <>
          <Panel>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <MonoLabel>Budget and fee tiers</MonoLabel>
              <YourDataBadge />
            </div>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
              <label className="flex flex-col gap-1.5">
                <span className="text-chip font-medium">Total budget (USD)</span>
                <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Total budget" className={cx(FIELD, "tabular font-mono")} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-chip font-medium">Slots</span>
                <select value={slots} onChange={(e) => setSlots(Number(e.target.value))} aria-label="Slots" className={cx(FIELD, "cursor-pointer font-mono")}>
                  {[2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {TIERS.map((t) => (
                <label key={t} className="flex flex-col gap-1.5">
                  <span className="text-chip font-medium">Tier {t} fee</span>
                  <input
                    inputMode="numeric"
                    value={fees[t]}
                    onChange={(e) => setFees({ ...fees, [t]: e.target.value })}
                    aria-label={`Tier ${t} fee`}
                    className={cx(FIELD, "tabular font-mono")}
                  />
                </label>
              ))}
            </div>
          </Panel>

          <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))]">
            <Panel className="gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_6.5em_6.5em] gap-2.5 border-b border-line pb-2 font-mono text-label uppercase tracking-[0.06em] text-mute">
                <span>Candidate pool</span>
                <span className="text-right">◆ Fit</span>
                <span>■ Fee tier</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5em_6.5em] items-center gap-2.5 border-b border-line py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{draft.headliner.name}</span>
                  <span className="text-chip text-mute">Headliner · always on the bill</span>
                </span>
                <span className="text-right font-mono text-label text-mute">—</span>
                <TierSelect name={draft.headliner.name} value={headTier} fees={fees} onChange={setHeadTier} />
              </div>
              {draft.pool.map((a) => (
                <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_6.5em_6.5em] items-center gap-2.5 border-b border-line py-2.5" data-candidate={a.name}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cx("h-2 w-2 flex-none rounded-pill", chosen.has(a.id) ? "bg-acc-line" : "bg-transparent")} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{a.name}</span>
                      <span className="text-chip text-mute">{a.category}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-track">
                      <span className="block h-full bg-acc-line" style={{ width: `${a.fit}%` }} />
                    </span>
                    <span className="tabular font-mono text-[11px]">{a.fit}</span>
                  </span>
                  <TierSelect name={a.name} value={tiers[a.id] ?? "B"} fees={fees} onChange={(t) => setTiers({ ...tiers, [a.id]: t })} />
                </div>
              ))}
              <span className="pt-2 text-chip text-mute">Fit is Qloo affinity among {draft.headliner.name} fans, 0–100.</span>
            </Panel>

            <section className="flex flex-col gap-3.5 rounded-lg border-th border-acc-line bg-surf p-panel lg:sticky lg:top-[82px]" aria-label="Suggested lineup">
              <MonoLabel className="text-acc-text">Suggested lineup</MonoLabel>
              {!budget.trim() ? (
                <span className="text-chip text-mute">Enter your total budget and fee tiers to see the best bill.</span>
              ) : pick ? (
                <>
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {pick.slots.map((s) => (
                      <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md bg-bg px-3 py-2.5" data-slot={s.role}>
                        <span className="w-[5.5em] font-mono text-label uppercase tracking-[0.06em] text-mute">{s.role}</span>
                        <span className="t-display text-[24px] leading-none [overflow-wrap:anywhere]">{s.name}</span>
                        <span className="tabular text-right font-mono text-[11px]">
                          {s.fit === null ? "—" : s.fit} · {usd(s.fee)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-col gap-1.5">
                    <div className="tabular flex justify-between gap-2 font-mono text-[11px]">
                      <span className="text-mute">Fees vs budget</span>
                      <span>
                        {usd(pick.cost)} of {usd(num(budget))}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-pill bg-track">
                      <div className="h-full rounded-pill bg-acc-line" style={{ width: `${num(budget) ? Math.min(100, Math.round((pick.cost / num(budget)) * 100)) : 0}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-chip text-mute">
                    <span>
                      Combined fit <span className="tabular font-mono text-ink">{pick.meanFit} / 100</span>
                    </span>
                    <span>{usd(pick.left)} left</span>
                  </div>
                  {canEdit && draft.planId ? (
                    <Button variant="primary" onClick={() => void save()} className="min-h-[44px]">
                      Add lineup to plan
                    </Button>
                  ) : (
                    <span className="text-chip text-mute">Start from one of the workspace&apos;s plans to add the lineup to it.</span>
                  )}
                </>
              ) : (
                <div className="rounded-md border-th border-warn bg-surf px-3.5 py-2.5 text-chip" role="status">
                  No {slots}-act lineup fits a {usd(num(budget))} budget at these fee tiers. Raise the budget, lower a tier or drop a slot.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function TierSelect({ name, value, fees, onChange }: { name: string; value: Tier; fees: Record<Tier, string>; onChange: (t: Tier) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Tier)}
      aria-label={`Fee tier for ${name}`}
      className="min-h-9 cursor-pointer rounded-badge border-th border-line bg-bg p-1.5 font-mono text-chip text-ink"
    >
      {TIERS.map((t) => (
        <option key={t} value={t}>
          {t} · {usd(num(fees[t]))}
        </option>
      ))}
    </select>
  );
}

/** On a plan's page: the lineup added from the optimizer, if any. */
export function PlanLineup({ planId }: { planId: string }) {
  const [row, setRow] = useState<{ lineup: LineupPick; yours: { budget: number } } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspace/lineup?planId=${encodeURIComponent(planId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setRow(d?.lineup ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [planId]);
  if (!row) return null;
  return (
    <section aria-label="Lineup">
      <Panel className="gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>Lineup · from the optimizer</MonoLabel>
          <span className="flex items-center gap-2 text-chip text-mute">
            Fees and budget <YourDataBadge />
          </span>
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {row.lineup.slots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-body">
              <span className="w-[6em] font-mono text-label uppercase text-mute">{s.role}</span>
              <span className="font-semibold">{s.name}</span>
              {s.fit !== null && <span className="tabular font-mono text-chip text-mute">fit {s.fit}</span>}
            </li>
          ))}
        </ol>
        <span className="tabular font-mono text-chip text-mute">
          {usd(row.lineup.cost)} of {usd(row.yours.budget)} · combined fit {row.lineup.meanFit} / 100
        </span>
      </Panel>
    </section>
  );
}
