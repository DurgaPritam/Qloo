"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { Confidence } from "@/lib/engine/types";
import { parseRosterCsv, sameName, type CsvAct } from "@/lib/roster/csv";
import type { CallRecord, RosterActView, RosterView } from "@/lib/roster/types";

import { FIELD } from "../account/fields";
import { Banner, Button, MonoLabel, OutlineChip, Panel, ScoreBar, SourceBadge, YourDataBadge } from "../ui";

interface Choice {
  entityId: string;
  name: string;
  category: string;
  detail?: string;
}

interface Unresolved {
  row: number;
  name: string;
  homeCity?: string;
  choices: Choice[];
  reason: string;
}

async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const data = ((await res?.json().catch(() => null)) ?? { error: "That didn't work. Try again." }) as T & { error?: string };
  return { ok: Boolean(res?.ok), data };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Create roster": a name, then straight to the new roster. */
export function CreateRoster({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New roster
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { ok, data } = await send<{ id: string }>("/api/workspace/rosters", "POST", { name });
        setBusy(false);
        if (ok) router.push(`/workspace/rosters/${data.id}`);
        else setError(data.error ?? "That didn't work.");
      }}
    >
      <input className={`${FIELD} min-w-0 flex-1 basis-[220px]`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Roster name, e.g. Comedy clients" aria-label="Roster name" maxLength={60} required />
      <Button type="submit" variant="primary" loading={busy} className="min-h-[40px] px-4">
        Create roster
      </Button>
      {error && <span className="w-full text-chip text-err">{error}</span>}
    </form>
  );
}

const CONFIDENCE: Record<Confidence, { label: string; width: string; tone: string; fill: string }> = {
  high: { label: "High", width: "100%", tone: "text-acc-text", fill: "bg-acc-line" },
  medium: { label: "Medium", width: "66%", tone: "text-ink", fill: "bg-mute" },
  low: { label: "Low · thin data", width: "33%", tone: "text-warn", fill: "bg-warn" },
};

/** The design's confidence cell: a bar in three steps and the level. No number: confidence is a level, not a score. */
function ConfidenceCell({ level }: { level: Confidence }) {
  const c = CONFIDENCE[level];
  return (
    <span className="flex flex-col gap-1">
      <span className="h-1.5 overflow-hidden rounded-pill bg-track" aria-hidden>
        <span className={`block h-full rounded-pill ${c.fill}`} style={{ width: c.width }} />
      </span>
      <span className={`font-mono text-label uppercase tracking-[0.06em] ${c.tone}`}>{c.label}</span>
    </span>
  );
}

const planHref = (q: string, params: Record<string, string>) => `/run?${new URLSearchParams({ q, ...params }).toString()}`;
const two = (x: number) => x.toFixed(2);

/** Where a pair's card is, so a matrix cell can link to its evidence. Order-free. */
const pairAnchor = (view: RosterView, a: string, b: string) => {
  const [i, j] = [view.acts.findIndex((x) => x.entityId === a), view.acts.findIndex((x) => x.entityId === b)].sort((x, y) => x - y);
  return `pair-${i}-${j}`;
};

/** The Qloo requests behind a number, as the run's step cards show them. */
function Calls({ calls }: { calls: CallRecord[] }) {
  if (!calls.length) return <span className="text-mute">Qloo requests were not recorded for this result; refresh to record them.</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {calls.map((c, i) => (
        <li key={i} className="flex flex-col font-mono text-label [overflow-wrap:anywhere]">
          <span className="text-ink">
            GET {c.endpoint}
            {c.cached ? " · cached" : ""}
          </span>
          {Object.entries(c.params).map(([k, v]) => (
            <span key={k} className="text-mute">
              {k} = {v}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** A collapsed "Evidence" section under a score. */
function Evidence({ children, label = "Evidence" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="text-chip">
      <summary className="cursor-pointer text-acc-text">{label}</summary>
      <div className="flex flex-col gap-2 pt-2">{children}</div>
    </details>
  );
}

export function RosterScreen({ initial }: { initial: RosterView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const url = `/api/workspace/rosters/${view.id}`;

  const reload = useCallback(async () => {
    const { ok, data } = await send<RosterView>(url, "GET");
    if (ok) setView(data);
  }, [url]);

  // Background batches report through their job rows; poll while any is waiting or running.
  const working = view.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [working, reload]);

  const say = (msg: string | null, err: string | null = null) => {
    setNotice(msg);
    setError(err);
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <MonoLabel>Rosters</MonoLabel>
          <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92] [overflow-wrap:anywhere]">{view.name}</h1>
          <span className="tabular text-chip text-mute">
            {plural(view.acts.length, "act")}
            {view.mock && " · sample data"}
          </span>
        </div>
        <Exports view={view} />
      </header>

      {error && <Banner tone="err">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}

      {view.canEdit && <ImportPanel view={view} onDone={reload} say={say} />}

      <Panel>
        {view.canEdit && <AddAct view={view} onDone={reload} say={say} />}
        {view.canEdit && <RefreshBar view={view} onDone={reload} say={say} />}
        <ActsTable view={view} onRemoved={reload} />
        <div className="flex flex-wrap items-center gap-2 text-chip text-mute">
          <SourceBadge />
          <span>Confidence reflects how much Qloo taste data backs each pick: the weakest of the three. Low means thin data; check before planning.</span>
        </div>
      </Panel>

      <Matrix view={view} />
      <Pairings view={view} />
    </div>
  );
}

function Exports({ view }: { view: RosterView }) {
  const [busy, setBusy] = useState(false);
  const csv = async () => {
    const [{ rosterCsv, rosterFileName }, { save }] = await Promise.all([import("@/lib/export/roster"), import("../run/exports")]);
    save(new Blob([rosterCsv(view)], { type: "text/csv;charset=utf-8" }), rosterFileName(view, "csv"));
  };
  const deck = async () => {
    setBusy(true);
    try {
      const [{ rosterOutline, rosterFileName, rosterFooter }, { renderDeck }] = await Promise.all([import("@/lib/export/roster"), import("../run/exports")]);
      await renderDeck(rosterOutline(view), { title: view.name, footer: rosterFooter(view), mock: view.mock, fileName: rosterFileName(view, "pptx") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void csv()} disabled={!view.acts.length} className="min-h-[40px] px-4">
        Export CSV
      </Button>
      <Button onClick={() => void deck()} loading={busy} disabled={!view.acts.length} className="min-h-[40px] px-4">
        Export deck
      </Button>
    </div>
  );
}

type Say = (msg: string | null, err?: string | null) => void;

function AddAct({ view, onDone, say }: { view: RosterView; onDone: () => Promise<void>; say: Say }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ question: string; choices: Choice[] } | null>(null);
  const [none, setNone] = useState<string | null>(null);

  const add = async (query: string, entityId?: string) => {
    setBusy(true);
    say(null);
    const { ok, data } = await send<{ status: string; name?: string; question?: string; choices?: Choice[] }>(`/api/workspace/rosters/${view.id}/acts`, "POST", { query, entityId });
    setBusy(false);
    if (!ok) return say(null, data.error ?? "That didn't work.");
    setNone(null);
    setFound(null);
    if (data.status === "choose") return setFound({ question: data.question ?? "Which one?", choices: data.choices ?? [] });
    if (data.status === "none") return setNone(query);
    setQ("");
    say(data.status === "already" ? `${data.name} is already on this roster.` : `Added ${data.name}. Refresh to score it.`);
    await onDone();
  };

  return (
    <div className="relative">
      <form
        role="search"
        className="flex items-center gap-2 rounded-md border-th border-line bg-bg py-1 pl-3 pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void add(q.trim());
        }}
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setFound(null);
            setNone(null);
          }}
          placeholder="Add an act to this roster…"
          aria-label="Add an act"
          maxLength={100}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 font-body text-body text-ink outline-none"
        />
        <span className="hidden whitespace-nowrap pr-1 font-mono text-label text-mute sm:inline">Qloo search</span>
        <Button type="submit" variant="primary" loading={busy} disabled={!q.trim()}>
          Add
        </Button>
      </form>
      {(found || none) && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 flex flex-col gap-0.5 rounded-md border-th border-line bg-surf p-1.5 shadow-card" role="listbox" aria-label="Matches">
          {found && <div className="px-2 py-1 text-chip text-mute">{found.question}</div>}
          {found?.choices.map((c) => (
            <button
              key={c.entityId}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => void add(c.name, c.entityId)}
              className="flex cursor-pointer items-center gap-2.5 rounded-btn border-0 bg-transparent p-2 text-left font-body text-body text-ink hover:bg-acc-soft"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{c.name}</span>
                {c.detail && <span className="truncate text-chip text-mute">{c.detail}</span>}
              </span>
              <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">{c.category.replace("_", " ")}</span>
              <span className="font-mono text-chip text-acc-text">+ Add</span>
            </button>
          ))}
          {none && <div className="p-2 text-chip text-mute">Qloo has no entity matching “{none}”.</div>}
        </div>
      )}
    </div>
  );
}

function ImportPanel({ view, onDone, say }: { view: RosterView; onDone: () => Promise<void>; say: Say }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; rows: CsvAct[]; already: number; duplicates: number; overLimit: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<Unresolved[]>([]);

  const read = async (f: File | undefined) => {
    setParseError(null);
    setFile(null);
    if (!f) return;
    const parsed = parseRosterCsv(await f.text());
    if (parsed.error) return setParseError(parsed.error);
    const rows = parsed.acts.filter((r) => !view.acts.some((a) => sameName(a.name, r.name)));
    setFile({ name: f.name, rows, already: parsed.acts.length - rows.length, duplicates: parsed.duplicates, overLimit: parsed.overLimit });
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    say(null);
    const { ok, data } = await send<{ added: number; already: number; unresolved: Unresolved[] }>(`/api/workspace/rosters/${view.id}/import`, "POST", { rows: file.rows });
    setBusy(false);
    if (!ok) return say(null, data.error ?? "The import didn't work.");
    setFile(null);
    setUnresolved(data.unresolved);
    const parts = [`Imported ${plural(data.added, "act")}.`];
    if (data.already) parts.push(`${data.already} were already on the roster.`);
    if (data.unresolved.length) parts.push(`${plural(data.unresolved.length, "name")} need matching by hand, below.`);
    say(parts.join(" "));
    await onDone();
  };

  const match = async (u: Unresolved, c: Choice) => {
    const { ok, data } = await send<{ status: string; name?: string }>(`/api/workspace/rosters/${view.id}/acts`, "POST", { query: c.name, entityId: c.entityId });
    if (!ok) return say(null, data.error ?? "That didn't work.");
    setUnresolved((rows) => rows.filter((r) => r !== u));
    say(`Matched row ${u.row} to ${data.name ?? c.name}.`);
    await onDone();
  };

  const toFetch = file?.rows.length ?? 0;
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setOpen((o) => !o)} className="min-h-[40px] px-4" aria-expanded={open}>
          {open ? "Close import" : "Import CSV"}
        </Button>
      </div>
      {open && (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoLabel>Import roster CSV</MonoLabel>
            <YourDataBadge />
          </div>
          <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-th border-dashed border-line bg-bg px-4 py-7 text-center">
            <input type="file" accept=".csv,text/csv" className="absolute h-px w-px opacity-0" aria-label="Roster CSV file" onChange={(e) => void read(e.target.files?.[0])} />
            <span className="font-semibold">{file ? file.name : "Drop a CSV or choose a file"}</span>
            <span className="text-chip text-mute">{file ? "Ready to import" : "One act per row. Names are matched to Qloo entities."}</span>
          </label>
          <div className="font-mono text-chip text-mute [overflow-wrap:anywhere]">Columns: act_name (required) · qloo_id · home_city</div>
          {parseError && <Banner tone="err">{parseError}</Banner>}
          {file && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="min-w-[200px] flex-1 text-body">
                {plural(file.rows.length + file.already, "act")} found.
                {file.already > 0 && ` ${file.already} ${file.already === 1 ? "is" : "are"} already on this roster and will be skipped.`}
                {file.duplicates > 0 && ` ${plural(file.duplicates, "repeated name")} dropped.`}
                {file.overLimit > 0 && ` ${file.overLimit} past the first 100 not imported.`}
                {toFetch > 0 && ` Matching uses up to ${plural(toFetch, "Qloo search", "Qloo searches")} (${view.usage.remaining} left this month).`}
              </span>
              <Button variant="primary" loading={busy} disabled={!toFetch} onClick={() => void run()} className="min-h-[40px] px-4">
                Import {plural(toFetch, "act")}
              </Button>
            </div>
          )}
        </Panel>
      )}
      {unresolved.length > 0 && (
        <Panel>
          <MonoLabel>Match by hand · {unresolved.length} left</MonoLabel>
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Unresolved rows">
            {unresolved.map((u) => (
              <li key={`${u.row}-${u.name}`} className="flex flex-col gap-2 border-b border-line py-3" data-unresolved={u.name}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-label text-mute">Row {u.row}</span>
                  <span className="font-semibold">{u.name}</span>
                  {u.homeCity && <span className="text-chip text-mute">{u.homeCity}</span>}
                  <span className="flex-1" />
                  <Button onClick={() => setUnresolved((rows) => rows.filter((r) => r !== u))}>Skip</Button>
                </div>
                <span className="text-chip text-mute">{u.reason}</span>
                {u.choices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {u.choices.map((c) => (
                      <Button key={c.entityId} variant="pick" onClick={() => void match(u, c)}>
                        {c.name} · {c.category.replace("_", " ")}
                        {c.detail ? ` · ${c.detail.slice(0, 40)}` : ""}
                      </Button>
                    ))}
                  </div>
                )}
                {u.choices.length === 0 && <span className="text-chip text-mute">Search for it by another name in “Add an act”.</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/** The budget step: what a refresh will use, checked against what is left, before anything runs. */
function RefreshBar({ view, onDone, say }: { view: RosterView; onDone: () => Promise<void>; say: Say }) {
  const [busy, setBusy] = useState(false);
  const { stale, all } = view.estimate;
  const left = view.usage.remaining;
  const running = view.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const finished = view.jobs.filter((j) => j.status !== "queued" && j.status !== "running");

  const refresh = async (force: boolean) => {
    setBusy(true);
    say(null);
    const { ok, data } = await send<{ status: string; message?: string; note?: string; batches?: number }>(`/api/workspace/rosters/${view.id}/refresh`, "POST", { force });
    setBusy(false);
    if (data.status === "blocked") return say(null, data.message ?? "This refresh would go over the Qloo allowance.");
    if (!ok) return say(null, data.error ?? "The refresh didn't start.");
    if (data.status === "queued") say(`Refreshing in the background: ${plural(data.batches ?? 0, "batch", "batches")}, a few seconds apart.`);
    else if (data.status === "fresh") say("Everything is up to date.");
    else say(data.note ?? "Refreshed.");
    await onDone();
  };

  const describe = (e: typeof stale) =>
    `${plural(e.acts, "act")}: ${plural(e.profiles, "profile")}, ${plural(e.pairings, "pairing call")} · up to ${plural(e.calls, "Qloo call")}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border-th border-line bg-bg p-3" aria-label="Refresh">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-[220px] flex-1 text-chip">
          {running.length > 0
            ? `Refreshing in the background: ${finished.length} of ${view.jobs.length} batches done.`
            : stale.calls > 0
              ? `To refresh: ${describe(stale)}.`
              : "Everything is up to date. Profiles and pairings are reused for a week."}
          <span className="block text-mute">
            {left} of {view.usage.allowance} Qloo calls left this month for this workspace
            {view.usage.dailyRemaining !== null ? ` · ${view.usage.dailyRemaining} left today across the site` : ""}. Cached answers are free.
          </span>
        </span>
        {stale.calls > 0 && (
          <Button variant="primary" loading={busy} disabled={running.length > 0 || stale.calls > left} onClick={() => void refresh(false)}>
            Refresh · {stale.calls} calls
          </Button>
        )}
        <Button loading={busy} disabled={running.length > 0 || all.calls === 0 || all.calls > left} onClick={() => void refresh(true)}>
          Refresh all · {all.calls} calls
        </Button>
      </div>
      {stale.calls > left && <Banner tone="warn">This refresh can use up to {stale.calls} Qloo calls, and the workspace has {left} left this month. Remove some acts or wait for next month.</Banner>}
      {(stale.batches > 1 || all.batches > 1) && running.length === 0 && (
        <span className="text-chip text-mute">Large rosters refresh in batches of up to 25 calls, staggered through the job queue.</span>
      )}
      {finished.length > 0 && running.length === 0 && finished.every((j) => j.estimate !== null) && (
        <span className="text-chip text-mute" data-estimate-check>
          Last refresh: estimated {finished.reduce((n, j) => n + (j.estimate ?? 0), 0)} Qloo calls, used {finished.reduce((n, j) => n + j.qlooCalls, 0)}. Cached
          answers are free, so it can use fewer, never more.
        </span>
      )}
      {finished
        .filter((j) => j.note)
        .slice(0, 3)
        .map((j) => (
          <span key={j.id} className={`text-chip ${j.status === "done" ? "text-mute" : "text-warn"}`} data-job-status={j.status}>
            {j.status === "skipped_budget" ? "Skipped (budget): " : j.status === "failed" ? "Failed: " : ""}
            {j.note}
          </span>
        ))}
    </div>
  );
}

function ActsTable({ view, onRemoved }: { view: RosterView; onRemoved: () => Promise<void> }) {
  const remove = async (act: RosterActView) => {
    await send(`/api/workspace/rosters/${view.id}/acts?act=${encodeURIComponent(act.id)}`, "DELETE");
    await onRemoved();
  };
  if (!view.acts.length) {
    return <p className="m-0 text-body text-mute">No acts yet. Add one by name, or import a CSV.</p>;
  }
  const grid = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9em] gap-3";
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="flex min-w-[680px] flex-col text-body" role="table" aria-label="Acts">
        <div role="row" className={`${grid} border-b border-line pb-2 font-mono text-label uppercase tracking-[0.06em] text-mute`}>
          <span role="columnheader">Act</span>
          <span role="columnheader">Best city</span>
          <span role="columnheader">Partner</span>
          <span role="columnheader">Sponsor</span>
          <span role="columnheader">Confidence</span>
        </div>
        {view.acts.map((a) => (
          <div role="row" key={a.id} className={`${grid} items-center border-b border-line py-3`} data-act={a.name}>
            <span role="cell" className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold [overflow-wrap:anywhere]">{a.name}</span>
              <span className="text-chip text-mute">{a.kind}</span>
              {a.homeCity && (
                <span className="flex flex-wrap items-center gap-1.5 text-chip text-mute">
                  Home: {a.homeCity} <YourDataBadge />
                </span>
              )}
              <span className="flex flex-wrap gap-x-3 text-chip">
                <Link href={planHref(a.name, { entity: a.entityId })}>Plan a takeover →</Link>
                {view.canEdit && (
                  <button type="button" onClick={() => void remove(a)} className="cursor-pointer border-0 bg-transparent p-0 font-body text-chip text-mute hover:text-ink">
                    Remove
                  </button>
                )}
              </span>
            </span>
            {a.profile ? (
              <>
                <span role="cell" className="flex min-w-0 flex-col">
                  <span>{a.profile.city?.name ?? "—"}</span>
                  <span className="font-mono text-label text-mute">{a.profile.city ? `${a.profile.city.country} · ${a.profile.city.confidence}` : "no city-level data"}</span>
                </span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">
                  {a.profile.partner?.name ?? "—"}
                </span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">
                  {a.profile.sponsor?.name ?? "—"}
                </span>
                <span role="cell" className="flex flex-col gap-1">
                  <ConfidenceCell level={a.profile.confidence} />
                  {a.stale && <span className="font-mono text-label text-mute">Due a refresh</span>}
                </span>
                <span role="cell" className="col-span-5">
                  <ActEvidence act={a} />
                </span>
              </>
            ) : (
              <span role="cell" className="col-span-4 font-mono text-chip text-mute">
                Not scored yet · refresh to score with Qloo
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pairings({ view }: { view: RosterView }) {
  const router = useRouter();
  if (view.acts.length < 2) return null;
  return (
    <Panel>
      <MonoLabel>Pairings · acts on this roster whose fans overlap</MonoLabel>
      {view.pairs.length === 0 && (
        <p className="m-0 text-body text-mute">{view.pendingPairs ? "Refresh the roster to score its pairings." : "No pairing has Qloo affinity data yet."}</p>
      )}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]" aria-label="Pairings">
        {view.pairs.map((p) => (
          <div
            key={`${p.a.id}|${p.b.id}`}
            id={pairAnchor(view, p.a.id, p.b.id)}
            className="flex scroll-mt-4 flex-col gap-2.5 rounded-md border-th border-line bg-bg p-4 target:border-acc-line"
            data-pair={`${p.a.name} + ${p.b.name}`}
          >
            <div className="t-display text-[24px] leading-none [overflow-wrap:anywhere]">
              {p.a.name} + {p.b.name}
            </div>
            <ScoreBar value={p.score} label={`${p.score} / 100 shared`} />
            <div className="text-chip text-mute">
              {p.evidence.bAmongA !== null && `${p.a.name} fans over-index on ${p.b.name} at ${p.evidence.bAmongA.toFixed(2)}. `}
              {p.evidence.aAmongB !== null && `${p.b.name} fans over-index on ${p.a.name} at ${p.evidence.aAmongB.toFixed(2)}. `}
              {(p.evidence.bAmongA === null || p.evidence.aAmongB === null) && "Qloo returned one direction only. "}
              {p.cityNote}
            </div>
            <PairEvidence view={view} pair={p} />
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge />
              <OutlineChip>{p.confidence} confidence</OutlineChip>
              <span className="flex-1" />
              <Button variant="pick" onClick={() => router.push(planHref(p.a.name, { entity: p.a.id, partner: p.b.id, pc: p.b.category }))}>
                Plan this pairing
              </Button>
            </div>
          </div>
        ))}
      </div>
      {(view.unscored.length > 0 || view.pendingPairs > 0) && (
        <div className="flex flex-col gap-1 text-chip text-mute">
          {view.pendingPairs > 0 && <span>{plural(view.pendingPairs, "pairing")} not scored yet: refresh the roster.</span>}
          {view.unscored.map((u) => (
            <span key={`${u.a.id}|${u.b.id}`}>
              {u.a.name} + {u.b.name}: {u.reason}
            </span>
          ))}
        </div>
      )}
      <span className="text-chip text-mute">
        Shared score: the mean of Qloo&apos;s affinity in both directions, 0–100, ranked by Takeover&apos;s engine. It is not a share of fans.
      </span>
    </Panel>
  );
}

/** The numbers behind an act's row: each pick's Qloo values and the requests they came from. */
function ActEvidence({ act }: { act: RosterActView }) {
  const p = act.profile!;
  const pick = (label: string, x: typeof p.partner | typeof p.sponsor) =>
    x && (
      <span>
        {label}: {x.name} · score {two(x.score)}
        {x.evidence && ` · Qloo affinity ${two(x.evidence.affinity)}, popularity ${two(x.evidence.popularity)}, ${two(x.evidence.relativeAffinity)} relative to its group`}
      </span>
    );
  return (
    <Evidence>
      {p.city && (
        <span>
          City: {p.city.name}
          {p.city.evidence && ` · Qloo heat ${two(p.city.evidence.heat)} over ${p.city.evidence.cells} cells`} · {p.city.confidence}
        </span>
      )}
      {pick("Partner", p.partner)}
      {pick("Sponsor", p.sponsor)}
      {p.notes.map((n) => (
        <span key={n} className="text-warn">
          {n}
        </span>
      ))}
      <Calls calls={p.calls ?? []} />
    </Evidence>
  );
}

/** Both directions from Qloo, how the score and level follow from them, and the requests. */
function PairEvidence({ view, pair }: { view: RosterView; pair: RosterView["pairs"][number] }) {
  const a = view.acts.find((x) => x.entityId === pair.a.id);
  const b = view.acts.find((x) => x.entityId === pair.b.id);
  const directions = [pair.evidence.bAmongA, pair.evidence.aAmongB].filter((x): x is number => x !== null);
  return (
    <Evidence>
      <span>
        Score {pair.score} = mean of {directions.map(two).join(" and ")} × 100, rounded. Level {pair.level}: strong from 0.92, clear from 0.85.
      </span>
      {pair.city && (
        <span>
          {pair.city.name}: combined city heat {two(pair.city.combined)} ({pair.city.confidence}).
        </span>
      )}
      <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">{pair.a.name} as the signal</span>
      <Calls calls={(a?.pairingCalls ?? []).filter((c) => c.params["filter.results.entities"]?.split(",").includes(pair.b.id))} />
      <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">{pair.b.name} as the signal</span>
      <Calls calls={(b?.pairingCalls ?? []).filter((c) => c.params["filter.results.entities"]?.split(",").includes(pair.a.id))} />
    </Evidence>
  );
}

/** Every pair at once: shared scores (0–100) by act, each linking to the pair's card and evidence. */
function Matrix({ view }: { view: RosterView }) {
  if (view.acts.length < 2) return null;
  const score = (a: string, b: string) => view.pairs.find((p) => (p.a.id === a && p.b.id === b) || (p.a.id === b && p.b.id === a));
  const unscored = (a: string, b: string) => view.unscored.find((u) => (u.a.id === a && u.b.id === b) || (u.a.id === b && u.b.id === a));
  const cols = `minmax(9em,1.2fr) repeat(${view.acts.length}, minmax(3.5em,1fr))`;
  return (
    <Panel>
      <MonoLabel>Matrix · shared score by pair, 0–100</MonoLabel>
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex flex-col text-chip" role="table" aria-label="Pairing matrix" style={{ minWidth: `${9 + view.acts.length * 4}em` }}>
          <div role="row" className="grid gap-1 border-b border-line pb-1.5 font-mono text-label uppercase tracking-[0.04em] text-mute" style={{ gridTemplateColumns: cols }}>
            <span role="columnheader">Act</span>
            {view.acts.map((a) => (
              <span role="columnheader" key={a.id} className="truncate text-right" title={a.name}>
                {a.name}
              </span>
            ))}
          </div>
          {view.acts.map((row) => (
            <div role="row" key={row.id} className="grid items-center gap-1 border-b border-line py-1.5" style={{ gridTemplateColumns: cols }} data-matrix-row={row.name}>
              <span role="rowheader" className="truncate font-medium" title={row.name}>
                {row.name}
              </span>
              {view.acts.map((col) => {
                if (col.id === row.id) {
                  return (
                    <span role="cell" key={col.id} className="text-right text-mute">
                      —
                    </span>
                  );
                }
                const p = score(row.entityId, col.entityId);
                return (
                  <span role="cell" key={col.id} className="tabular text-right font-mono">
                    {p ? (
                      <a href={`#${pairAnchor(view, row.entityId, col.entityId)}`} title={`${row.name} + ${col.name}: evidence`}>
                        {p.score}
                      </a>
                    ) : (
                      <span className="text-mute" title={unscored(row.entityId, col.entityId)?.reason ?? "Not scored yet: refresh the roster."}>
                        {unscored(row.entityId, col.entityId) ? "n/a" : "…"}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <span className="text-chip text-mute">Each number links to its pair below: Qloo&apos;s affinity both ways and the requests behind it. “…” not scored yet, “n/a” Qloo has no data.</span>
    </Panel>
  );
}
