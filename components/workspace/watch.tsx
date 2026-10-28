"use client";

import Link from "next/link";
import { useState } from "react";

import { digestHtml, EMAIL_THEME_LABEL, EMAIL_THEMES, type EmailTheme } from "@/lib/email/digest-html";
import type { WatchView } from "@/lib/watch/service";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, MonoLabel, Panel, Segmented, SourceBadge } from "../ui";
import { Calls } from "./calls";

type Kind = "fanbase" | "city";
type Choice = { entityId: string; name: string; category: string; detail?: string };
type CityOption = { id: string; name: string; admin1: string; country: string };

const points = (v: number) => String(Math.round(v * 100));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const LIST_LABEL: Record<string, string> = {
  cities: "Where the fans are",
  partners: "Top crossover partners",
  "category:artist": "Top artists",
  "category:podcast": "Top podcasts",
  "category:tv_show": "Top TV shows",
  "category:brand": "Top brands",
};

async function send<T>(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  return { ok: Boolean(res?.ok), data: ((await res?.json().catch(() => null)) ?? { error: "That didn't work. Try again." }) as T & { error?: string } };
}

export function WatchScreen({
  initial,
  canEdit,
  me,
  recipients,
}: {
  initial: WatchView;
  canEdit: boolean;
  me: { email: string | null; digestOn: boolean; theme: EmailTheme };
  recipients: string[];
}) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Kind>("fanbase");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    const { ok, data } = await send<WatchView>("/api/workspace/watch", "GET");
    if (ok) setView(data);
  };
  const say = (n: string | null, e: string | null = null) => {
    setNotice(n);
    setError(e);
  };
  const items = view.items.filter((i) => i.kind === tab);

  return (
    <div className="flex flex-col gap-[18px]">
      {error && <Banner tone="err">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      {view.items.length === 0 && (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-10 sm:px-12">
          <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">No watchlists yet</h2>
          <p className="m-0 max-w-[420px] text-body text-mute">Follow fanbases and cities and see when their Qloo affinity changes. Add one below.</p>
        </section>
      )}
      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonoLabel>Watching</MonoLabel>
            <Segmented
              label="Watching"
              options={[
                { value: "fanbase", label: "Fanbases" },
                { value: "city", label: "Cities" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
          {canEdit && <AddWatch kind={tab} onDone={reload} say={say} />}
          {items.length === 0 ? (
            <p className="m-0 text-chip text-mute">{tab === "fanbase" ? "No fanbases watched yet." : "No cities watched yet."}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0" aria-label={tab === "fanbase" ? "Watched fanbases" : "Watched cities"}>
              {items.map((i) => (
                <WatchRow key={i.id} item={i} canEdit={canEdit} onRemoved={reload} />
              ))}
            </ul>
          )}
        </Panel>
        <Alerts view={view} />
      </div>
      <Digest view={view} me={me} recipients={recipients} say={say} />
    </div>
  );
}

function AddWatch({ kind, onDone, say }: { kind: Kind; onDone: () => Promise<void>; say: (n: string | null, e?: string | null) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{ question: string; list: Choice[] } | null>(null);
  const [cities, setCities] = useState<CityOption[] | null>(null);

  const add = async (extra: { entityId?: string; cityId?: string; query?: string } = {}) => {
    setBusy(true);
    say(null);
    const { ok, data } = await send<{ status: string; note?: string; name?: string; question?: string; choices?: Choice[]; options?: CityOption[] }>("/api/workspace/watch", "POST", {
      kind,
      query: extra.query ?? q,
      ...extra,
    });
    setBusy(false);
    if (!ok) return say(null, data.error ?? "That didn't work.");
    setChoices(null);
    setCities(null);
    if (data.status === "choose") return setChoices({ question: data.question ?? "Which one?", list: data.choices ?? [] });
    if (data.status === "chooseCity") return setCities(data.options ?? []);
    if (data.status === "none") return say(null, kind === "fanbase" ? `Qloo has no entity matching “${q}”.` : `No city of 100,000+ people called “${q}”.`);
    setQ("");
    say(`${data.name}: ${data.note}`);
    await onDone();
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void add();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "fanbase" ? "Watch a fanbase…" : "Watch a city…"}
          aria-label={kind === "fanbase" ? "Watch a fanbase" : "Watch a city"}
          maxLength={100}
          className={cx(FIELD, "min-w-0 flex-1")}
        />
        <Button type="submit" loading={busy} disabled={!q.trim()} className="min-h-[44px] px-4">
          Watch
        </Button>
      </form>
      <span className="text-chip text-mute">The first snapshot is taken now ({kind === "fanbase" ? "3" : "4"} Qloo calls); changes appear from next week.</span>
      {choices && (
        <div className="flex flex-col gap-1.5">
          <span className="text-chip text-mute">{choices.question}</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.list.map((c) => (
              <Button key={c.entityId} variant="pick" onClick={() => void add({ entityId: c.entityId, query: c.name })}>
                {c.name} · {c.category.replace("_", " ")}
              </Button>
            ))}
          </div>
        </div>
      )}
      {cities && (
        <div className="flex flex-col gap-1.5">
          <span className="text-chip text-mute">More than one city by that name. Which one?</span>
          <div className="flex flex-wrap gap-1.5">
            {cities.map((c) => (
              <Button key={c.id} variant="pick" onClick={() => void add({ cityId: c.id, query: c.name })}>
                {c.name}, {c.admin1 || c.country} ({c.country})
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WatchRow({ item, canEdit, onRemoved }: { item: WatchView["items"][number]; canEdit: boolean; onRemoved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const status = item.snapshots === 0 ? "Not checked yet" : item.snapshots === 1 ? "1st snapshot" : item.changes ? `${item.changes} change${item.changes === 1 ? "" : "s"}` : "No changes";
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3" data-watch={item.name}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer flex-col border-0 bg-transparent p-0 text-left font-body text-ink">
          <span className="font-semibold [overflow-wrap:anywhere]">{item.kind === "fanbase" ? `${item.name} fans` : item.name}</span>
          <span className="text-chip text-mute">
            {item.kind === "fanbase" ? (item.detail ?? "").replace("_", " ") : item.detail}
            {item.lastSnapshotAt ? ` · checked ${day(item.lastSnapshotAt)}` : ""}
            {item.nextDueAt ? ` · next ${day(item.nextDueAt)}` : ""}
          </span>
        </button>
        <span className={cx("whitespace-nowrap font-mono text-chip", item.changes ? "text-acc-text" : "text-mute")} data-watch-status>
          {status}
        </span>
      </div>
      {item.note && <span className={cx("text-chip", /^Skipped/.test(item.note) ? "text-warn" : "text-mute")}>{item.note}</span>}
      {open && (
        <div className="flex flex-col gap-3 rounded-md bg-bg p-3 text-chip">
          {item.lists.length === 0 && <span className="text-mute">No snapshot yet.</span>}
          {item.lists.map((l) => (
            <div key={l.list} className="flex flex-col gap-1">
              <MonoLabel>{LIST_LABEL[l.list] ?? l.list}</MonoLabel>
              {l.entries.map((e) => (
                <span key={e.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    #{e.rank} {e.name}
                  </span>
                  <span className="tabular whitespace-nowrap font-mono text-mute">
                    {e.before ? `#${e.before.rank} → #${e.rank} · ${points(e.before.value)} → ` : item.snapshots > 1 ? "new · " : ""}
                    {points(e.value)} / 100
                  </span>
                </span>
              ))}
            </div>
          ))}
          {item.calls.length > 0 && (
            <details>
              <summary className="cursor-pointer text-acc-text">Qloo requests behind this snapshot</summary>
              <div className="pt-1.5">
                <Calls calls={item.calls} />
              </div>
            </details>
          )}
          {canEdit && (
            <div>
              <Button
                onClick={async () => {
                  await send(`/api/workspace/watch/${item.id}`, "DELETE");
                  await onRemoved();
                }}
              >
                Stop watching
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const TAG_TONE: Record<string, string> = { Rising: "border-acc-line text-acc-text", "New entry": "border-acc-line text-acc-text", Falling: "border-err text-err" };

function Alerts({ view }: { view: WatchView }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>Alerts</MonoLabel>
        <SourceBadge />
      </div>
      {view.alerts.length === 0 ? (
        <p className="m-0 text-chip text-mute" data-no-alerts>
          No changes yet. Each fanbase or city needs two weekly snapshots before it can alert: one reading is not a trend.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Alerts">
          {view.alerts.map((a) => (
            <li key={a.id} className="flex gap-3 border-t border-line py-3" data-alert={a.kind}>
              <span className={cx("h-fit whitespace-nowrap rounded-badge border px-1.5 py-px font-mono text-label uppercase tracking-[0.06em]", TAG_TONE[a.tag])}>{a.tag}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{a.title}</span>
                <span className="text-chip text-mute">{a.body}</span>
                <span className="flex flex-wrap items-center gap-2 font-mono text-label text-mute">
                  {day(a.createdAt)}
                  {a.itemKind === "fanbase" ? (
                    <Link href={`/run?${new URLSearchParams({ q: a.itemName, entity: a.itemTarget })}`} className="font-body text-chip">
                      Plan a takeover
                    </Link>
                  ) : a.list !== "cities" ? (
                    <Link href={`/run?${new URLSearchParams({ q: a.entityName, entity: a.entityId })}`} className="font-body text-chip">
                      Plan {a.entityName}
                    </Link>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Digest({ view, me, recipients, say }: { view: WatchView; me: { email: string | null; digestOn: boolean; theme: EmailTheme }; recipients: string[]; say: (n: string | null, e?: string | null) => void }) {
  const [on, setOn] = useState(me.digestOn);
  const [theme, setTheme] = useState<EmailTheme>(me.theme);
  const [list, setList] = useState(recipients);
  const [busy, setBusy] = useState(false);
  const lines = view.alerts.filter((a) => view.thisWeek.includes(a.id)).slice(0, 8);

  const pickTheme = async (t: EmailTheme) => {
    setTheme(t);
    const { ok, data } = await send("/api/workspace/watch/digest", "POST", { theme: t });
    if (!ok) say(null, data.error ?? "That didn't work.");
  };
  const n = lines.length;
  // The same HTML the email carries, so the preview is the email.
  const preview = digestHtml({
    theme,
    intro: n ? `${n} thing${n === 1 ? "" : "s"} moved on your watchlist this week.` : "Nothing moved on your watchlist this week.",
    lines: lines.map((a) => ({ tag: a.tag, title: a.title, body: a.body })),
    outro: "Every change is Qloo signal, compared with last week's snapshot. Manage alerts in Market watch.",
    marketWatchUrl: "#",
    unsubscribeUrl: "#",
  });

  const toggle = async () => {
    const next = !on;
    const { ok, data } = await send("/api/workspace/watch/digest", "POST", { enabled: next });
    if (!ok) return say(null, data.error ?? "That didn't work.");
    setOn(next);
    if (me.email) setList((l) => (next ? [...new Set([...l, me.email!])] : l.filter((e) => e !== me.email)));
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Weekly digest">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>Weekly digest</MonoLabel>
        <label className="flex items-center gap-2.5 text-chip">
          <span>{on ? "On · every Monday" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Email me the weekly digest"
            onClick={() => void toggle()}
            className={cx("relative h-6 w-10 cursor-pointer rounded-pill border-0 transition-colors", on ? "bg-acc" : "bg-track")}
          >
            <span className={cx("absolute top-[3px] h-[18px] w-[18px] rounded-pill transition-[left]", on ? "left-[19px] bg-on-acc" : "left-[3px] bg-mute")} />
          </button>
        </label>
      </div>
      <Panel className={cx(!on && "opacity-80")}>
        <div className="flex flex-col font-mono text-chip">
          <div className="flex gap-4 border-b border-line py-1.5">
            <span className="w-16 text-mute">To</span>
            <span className="[overflow-wrap:anywhere]">{list.length ? list.join(", ") : "Nobody yet: each member turns the digest on for themselves."}</span>
          </div>
          <div className="flex gap-4 border-b border-line py-1.5">
            <span className="w-16 text-mute">Subject</span>
            <span>
              Market watch · {lines.length} change{lines.length === 1 ? "" : "s"} this week
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 text-body">
          {lines.length === 0 ? (
            <p className="m-0 text-mute">Nothing moved this week, so no digest is sent.</p>
          ) : (
            lines.map((a) => (
              <p key={a.id} className="m-0">
                <strong>{a.title}.</strong> {a.body}
              </p>
            ))
          )}
          <p className="m-0 text-chip text-mute">Sent every Monday, only to members who turn it on, with an unsubscribe link. Every change is Qloo signal.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-chip">Email look</span>
          <Segmented label="Email look" options={EMAIL_THEMES.map((t) => ({ value: t, label: EMAIL_THEME_LABEL[t] }))} value={theme} onChange={(t) => void pickTheme(t)} />
        </div>
        <iframe title={`Digest email preview, ${EMAIL_THEME_LABEL[theme]}`} srcDoc={preview} sandbox="" className="h-[460px] w-full rounded-md border-th border-line bg-bg" data-digest-preview={theme} />
        <div>
          <Button
            loading={busy}
            disabled={!me.email}
            onClick={async () => {
              setBusy(true);
              const { ok, data } = await send<{ to: string }>("/api/workspace/watch/digest", "POST", { test: true });
              setBusy(false);
              if (ok) say(`Test digest sent to ${data.to}.`);
              else say(null, data.error ?? "That didn't work.");
            }}
          >
            Send me a test
          </Button>
        </div>
      </Panel>
    </section>
  );
}
