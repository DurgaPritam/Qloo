"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ENGINE_CONFIG } from "@/lib/engine/config";
import { optimizeLineup, TIERS, type Tier } from "@/lib/engine/lineup";
import { parseLineupCsv } from "@/lib/lineup/csv";
import type { PoolDraft, PoolEntity, ResolvedName } from "@/lib/tools/lineup";

import { categoryLabel } from "../run/format";
import { FIELD } from "../account/fields";
import { Banner, Button, cx, MonoLabel, OutlineChip, Panel, SourceBadge, YourDataBadge } from "../ui";
import { CallsUsed, SampleBanner, ToolIntro } from "./tool-kit";

/**
 * Lineup optimizer: a pool of acts (typed or from a CSV) with the user's fee tiers, budget, slots per
 * tier and must-includes; Qloo's pairwise affinities among the acts; the engine's best bill, why each
 * act is on it, and the near misses. The poster is the existing one, scored on the server.
 */
interface Row {
  key: string;
  name: string;
  tier: Tier;
  mustInclude: boolean;
  match: ResolvedName | null;
}

const MAX = ENGINE_CONFIG.lineup.maxPool;
const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const two = (x: number) => x.toFixed(2);

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: Boolean(res?.ok), data: ((await res?.json().catch(() => null)) ?? { error: "Network error. Try again." }) as T & { error?: string } };
}

export function LineupBuilder() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<PoolDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [fees, setFees] = useState<Record<Tier, string>>({ A: "", B: "", C: "" });
  const [slots, setSlots] = useState<Record<Tier, number>>({ A: 1, B: 2, C: 2 });
  const [weight, setWeight] = useState<number>(ENGINE_CONFIG.lineup.coverageWeight);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const add = (names: { name: string; tier?: Tier | null; mustInclude?: boolean }[]) => {
    setDraft(null);
    setRows((old) => {
      const next = [...old];
      for (const n of names) {
        if (next.length >= MAX || next.some((r) => r.name.toLowerCase() === n.name.toLowerCase())) continue;
        next.push({ key: `${n.name}-${next.length}`, name: n.name, tier: n.tier ?? "B", mustInclude: Boolean(n.mustInclude), match: null });
      }
      return next;
    });
  };
  const update = (key: string, patch: Partial<Row>) => setRows((old) => old.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Matches every unmatched name with Qloo, then scores the pool once all are matched. */
  const score = async (picked?: { key: string; entityId: string }) => {
    setBusy(true);
    setError(null);
    const todo = rows.filter((r) => r.match?.status !== "resolved" || r.key === picked?.key);
    let current = rows;
    if (todo.length) {
      const { ok, data } = await post<{ acts: ResolvedName[] }>("/api/tools/lineup/resolve", { acts: todo.map((r) => ({ name: r.name, entityId: r.key === picked?.key ? picked.entityId : undefined })) });
      if (!ok) {
        setBusy(false);
        return setError(data.error ?? "That didn't work.");
      }
      current = rows.map((r) => {
        const i = todo.indexOf(r);
        return i >= 0 ? { ...r, match: data.acts[i] ?? null } : r;
      });
      setRows(current);
    }
    const matched = current.filter((r) => r.match?.status === "resolved");
    if (matched.length !== current.length) {
      setBusy(false);
      return setError("Some names need a pick or another spelling before the pool can be scored.");
    }
    if (matched.length < 2) {
      setBusy(false);
      return setError("Add at least two acts.");
    }
    const { ok, data } = await post<PoolDraft>("/api/tools/lineup", { acts: matched.map((r) => (r.match as Extract<ResolvedName, { status: "resolved" }>).entity) });
    setBusy(false);
    if (!ok) return setError(data.error ?? "That didn't work.");
    setDraft(data);
  };

  const entityOf = (r: Row): PoolEntity | null => (r.match?.status === "resolved" ? r.match.entity : null);
  const pool = useMemo(
    () =>
      draft
        ? rows
            .map((r) => ({ r, e: entityOf(r) }))
            .filter((x): x is { r: Row; e: PoolEntity } => Boolean(x.e && draft.acts.some((a) => a.id === x.e!.id)))
            .map(({ r, e }) => ({ id: e.id, name: e.name, tier: r.tier, mustInclude: r.mustInclude }))
        : [],
    [draft, rows],
  );
  const ready = draft && budget.trim();
  const result = useMemo(
    () => (ready ? optimizeLineup(pool, draft.matrix, { budget: num(budget), fees: { A: num(fees.A), B: num(fees.B), C: num(fees.C) }, slots, weight }) : null),
    [ready, pool, draft, budget, fees, slots, weight],
  );
  const nameOf = (id: string) => pool.find((a) => a.id === id)?.name ?? id;

  const savePoster = async () => {
    if (!draft || result?.status !== "done") return;
    setSaving(true);
    const { ok, data } = await post<{ id: string }>("/api/tools/lineup/save", { draftId: draft.draftId, actIds: result.best.ids, tiers: Object.fromEntries(pool.map((a) => [a.id, a.tier])), title });
    setSaving(false);
    if (ok && data.id) router.push(`/lineup/${data.id}`);
    else setError(data.error ?? "That didn't work.");
  };

  return (
    <>
      <ToolIntro
        label="Tools"
        title="Lineup optimizer"
        body="Build a pool of acts with your fee tiers, then let the engine pick the bill: the strongest shared audience (Qloo's affinity between every pair) balanced against how many distinct audiences it reaches, inside your budget and slots."
      />
      {draft && <SampleBanner mock={draft.mock} />}
      {error && <Banner tone="err">{error}</Banner>}

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>Candidate pool · up to {MAX} acts</MonoLabel>
          <YourDataBadge />
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add([{ name: name.trim() }]);
            setName("");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="An act, e.g. Ali Wong" aria-label="Add an act" className={cx(FIELD, "min-w-0 flex-1 basis-[220px]")} />
          <Button type="submit" disabled={!name.trim() || rows.length >= MAX}>
            Add
          </Button>
          <label className="relative cursor-pointer rounded-btn border-th border-line px-3 py-1.5 text-chip text-ink hover:bg-acc-soft">
            Add from CSV
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Acts CSV"
              className="absolute h-px w-px opacity-0"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const parsed = parseLineupCsv(await file.text(), MAX - rows.length);
                if (parsed.error) return setError(parsed.error);
                setError(parsed.dropped ? `Added the first ${parsed.acts.length}; a pool holds ${MAX} acts.` : null);
                add(parsed.acts);
                e.target.value = "";
              }}
            />
          </label>
        </form>
        <span className="text-chip text-mute">CSV columns: name, tier (A, B or C), must_include (yes). Tiers and must-includes are yours; Qloo only matches the names.</span>

        {rows.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Pool">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 border-b border-line py-2.5" data-pool-act={r.name}>
                <span className="flex min-w-0 flex-1 basis-[200px] flex-col">
                  <span className="font-semibold [overflow-wrap:anywhere]">{r.match?.status === "resolved" ? r.match.entity.name : r.name}</span>
                  <span className="text-chip text-mute">
                    {r.match?.status === "resolved" ? `${categoryLabel(r.match.entity.category)} · matched` : r.match?.status === "none" ? "Qloo found nothing; try another spelling" : r.match?.status === "choose" ? r.match.question : "Not matched yet"}
                  </span>
                  {r.match?.status === "choose" && (
                    <span className="flex flex-wrap gap-1.5 pt-1">
                      {r.match.choices.slice(0, 4).map((c) => (
                        <Button key={c.entityId} onClick={() => void score({ key: r.key, entityId: c.entityId })}>
                          {c.name}
                          {c.detail ? ` · ${c.detail}` : ""}
                        </Button>
                      ))}
                    </span>
                  )}
                </span>
                <select value={r.tier} onChange={(e) => update(r.key, { tier: e.target.value as Tier })} aria-label={`Fee tier for ${r.name}`} className={cx(FIELD, "cursor-pointer py-1.5 font-mono text-chip")}>
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      Tier {t}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-chip">
                  <input type="checkbox" checked={r.mustInclude} onChange={(e) => update(r.key, { mustInclude: e.target.checked })} className="accent-acc-line" />
                  Must include
                </label>
                <Button
                  onClick={() => {
                    setDraft(null);
                    setRows(rows.filter((x) => x.key !== r.key));
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} disabled={rows.length < 2} onClick={() => void score()} className="min-h-[44px] px-4">
            {draft ? "Score the pool again" : "Match and score the pool"}
          </Button>
          <span className="text-chip text-mute">One Qloo search per new name, then about one call per act for the affinities between them.</span>
        </div>
      </Panel>

      {draft && (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoLabel>Budget, fees and slots</MonoLabel>
            <YourDataBadge />
          </div>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr))]">
            <label className="flex flex-col gap-1.5">
              <span className="text-chip font-medium">Total budget (USD)</span>
              <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Total budget" className={cx(FIELD, "tabular font-mono")} />
            </label>
            {TIERS.map((t) => (
              <label key={t} className="flex flex-col gap-1.5">
                <span className="text-chip font-medium">Tier {t} fee</span>
                <input inputMode="numeric" value={fees[t]} onChange={(e) => setFees({ ...fees, [t]: e.target.value })} aria-label={`Tier ${t} fee`} className={cx(FIELD, "tabular font-mono")} />
              </label>
            ))}
            {TIERS.map((t) => (
              <label key={`s${t}`} className="flex flex-col gap-1.5">
                <span className="text-chip font-medium">Tier {t} slots</span>
                <select value={slots[t]} onChange={(e) => setSlots({ ...slots, [t]: Number(e.target.value) })} aria-label={`Tier ${t} slots`} className={cx(FIELD, "cursor-pointer font-mono")}>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-baseline justify-between gap-2 text-chip font-medium">
              <span>Trade-off: crowd fit ↔ audience coverage</span>
              <span className="tabular font-mono">
                {Math.round((1 - weight) * 100)}% crowd fit · {Math.round(weight * 100)}% coverage
              </span>
            </span>
            <input type="range" min={0} max={100} step={5} value={Math.round(weight * 100)} onChange={(e) => setWeight(Number(e.target.value) / 100)} aria-label="Coverage weight" className="accent-acc-line" />
            <span className="text-chip text-mute">Left: acts whose fans already love each other. Right: a bill that reaches more separate audiences. Default {Math.round(ENGINE_CONFIG.lineup.coverageWeight * 100)}%.</span>
          </label>
        </Panel>
      )}

      {draft && !budget.trim() && <Banner tone="neutral">Enter your budget and fee tiers to see the best bill.</Banner>}
      {result?.status === "infeasible" && (
        <Banner tone="warn">{result.reason}</Banner>
      )}
      {result?.status === "done" && (
        <section className="flex flex-col gap-3.5 rounded-lg border-th border-acc-line bg-surf p-panel" aria-label="Suggested lineup">
          <MonoLabel className="text-acc-text">Suggested lineup</MonoLabel>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {result.reasons.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 rounded-md bg-bg px-3 py-2.5" data-bill={x.name}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="t-display text-[24px] leading-none [overflow-wrap:anywhere]">{x.name}</span>
                  <span className="tabular font-mono text-[11px]">
                    Tier {x.tier} · {usd(x.fee)}
                  </span>
                </span>
                <span className="text-chip text-mute" data-why>
                  {x.mustInclude ? "Must include (yours). " : ""}
                  {x.cluster}.{" "}
                  {x.strongest ? `Shares most fans with ${x.strongest.name} (mutual Qloo affinity ${two(x.strongest.mutual)}).` : "Qloo shows no shared fans with the rest of the bill."}
                  {x.drop === null ? "" : x.drop >= 0 ? ` Without it the score falls by ${two(x.drop)}.` : ` Without it the score would rise by ${two(-x.drop)}, but a slot would stay empty.`}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1 font-mono text-chip" data-score>
            <span>
              Score {two(result.best.score)} = {two(1 - result.weight)} × crowd fit {two(result.best.crowdFit)} + {two(result.weight)} × coverage {two(result.best.coverage)}
            </span>
            <span className="text-mute">
              Fees {usd(result.best.cost)} of {usd(num(budget))} · {usd(num(budget) - result.best.cost)} left
            </span>
          </div>
          {(result.nearMisses.length > 0 || result.overBudget) && (
            <div className="flex flex-col gap-1.5" aria-label="Near misses" role="group">
              <MonoLabel>Near misses</MonoLabel>
              {result.nearMisses.map((n, i) => (
                <span key={i} className="text-chip" data-near-miss>
                  {[...n.removed.map((id) => `without ${nameOf(id)}`), ...n.added.map((id) => `with ${nameOf(id)}`)].join(", ") || "Same acts"}: score {two(n.score)} ({n.score - result.best.score > 0 ? "+" : ""}
                  {two(n.score - result.best.score)}
                  {n.ids.length < result.best.ids.length ? `, ${result.best.ids.length - n.ids.length} slot${result.best.ids.length - n.ids.length === 1 ? "" : "s"} empty` : ""})
                </span>
              ))}
              {result.overBudget && (
                <span className="text-chip text-warn" data-over-budget>
                  {[...result.overBudget.removed.map((id) => `without ${nameOf(id)}`), ...result.overBudget.added.map((id) => `with ${nameOf(id)}`)].join(", ")}: score {two(result.overBudget.score)}, but {usd(result.overBudget.overBudget ?? 0)}{" "}
                  over budget.
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-chip text-mute">
            {result.clusters.map((c) => (
              <OutlineChip key={c.label}>
                {c.label}: {c.ids.map(nameOf).join(", ")}
              </OutlineChip>
            ))}
          </div>
          <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
            <SourceBadge /> Affinities from Qloo; fees, budget, tiers and slots are yours. No fee is ever suggested.
          </span>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="Poster title (optional)" aria-label="Poster title" className={cx(FIELD, "min-w-0 flex-1 basis-[200px]")} />
            <Button variant="primary" loading={saving} disabled={result.best.ids.length > 6} onClick={() => void savePoster()}>
              Make the poster
            </Button>
          </div>
        </section>
      )}
      {draft && <CallsUsed calls={draft.calls} />}
    </>
  );
}
