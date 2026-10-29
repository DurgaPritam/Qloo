"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AccountState } from "@/app/api/account/route";
import { signOutAction } from "@/app/signin/actions";
import { ROLE_LABEL } from "@/lib/workspace/permissions";

import { AppearanceControls } from "../appearance";
import { cx, MonoLabel, Wordmark } from "../ui";

/** The design's App Shell: workspace pages sit inside it; public pages keep the site header. */
const NAV = [
  { href: "/workspace", label: "Plans" },
  { href: "/workspace/rosters", label: "Rosters" },
  { href: "/workspace/pipeline", label: "Pipeline" },
  { href: "/workspace/watch", label: "Watchlists" },
  { href: "/workspace/sponsorship", label: "Sponsorship" },
  { href: "/workspace/data", label: "Data" },
  { href: "/workspace/settings", label: "Settings", also: ["/workspace/members", "/workspace/inbox"] },
] as const;
const TOOLS = [
  { href: "/workspace/outcomes", label: "Outcomes" },
  { href: "/tour", label: "Tour optimizer" },
  { href: "/lineup", label: "Lineup optimizer" },
  { href: "/workspace/campaign", label: "Campaign brief" },
] as const;

export const initials = (name: string) =>
  name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "·";

type Result = { kind: string; label: string; href: string };
type Note = { id: string; text: string; href: string; unread: boolean; at: string };

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [account, setAccount] = useState<AccountState | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json() as Promise<AccountState>)
      .then((s) => live && setAccount(s))
      .catch(() => live && setAccount({ user: null }));
    return () => {
      live = false;
    };
  }, [path]);

  const active = (item: { href: string; also?: readonly string[] }) =>
    item.href === "/workspace" ? path === "/workspace" : path === item.href || path.startsWith(`${item.href}/`) || Boolean(item.also?.some((a) => path.startsWith(a)));

  const switchTo = async (id: string) => {
    await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
    setWsOpen(false);
    router.refresh();
    setAccount((a) => (a ? { ...a, workspace: a.workspaces?.find((w) => w.id === id) } : a));
  };

  const ws = account?.workspace;
  const navLink = (item: { href: string; label: string; also?: readonly string[] }) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setDrawer(false)}
      aria-current={active(item) ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-btn px-3 py-2 text-body no-underline",
        active(item) ? "bg-acc-soft font-medium text-ink" : "text-mute hover:bg-acc-soft hover:text-ink",
      )}
    >
      <span className={cx("h-4 w-[3px] rounded-pill", active(item) ? "bg-acc-line" : "bg-transparent")} aria-hidden />
      {item.label}
    </Link>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-ink no-underline" aria-label="Takeover home">
          <Wordmark />
        </Link>
        <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="cursor-pointer border-0 bg-transparent p-1 text-[20px] leading-none text-mute lg:hidden">
          ×
        </button>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setWsOpen(!wsOpen)}
          aria-expanded={wsOpen}
          aria-label={`Workspace: ${ws?.name ?? ""}`}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-th border-line bg-surf p-2.5 text-left"
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-btn bg-acc font-mono text-label font-medium text-on-acc">{initials(ws?.name ?? "")}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-ink">{ws?.name ?? " "}</span>
            <span className="text-chip text-mute">{ws?.members ? `${ws.members} member${ws.members === 1 ? "" : "s"}` : " "}</span>
          </span>
          <span className="text-label text-mute" aria-hidden>
            ▾
          </span>
        </button>
        {wsOpen && account?.workspaces && (
          <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 flex flex-col gap-0.5 rounded-md border-th border-line bg-surf p-1.5 shadow-card" role="menu" aria-label="Workspaces">
            <MonoLabel className="px-2 py-1">Workspaces</MonoLabel>
            {account.workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                role="menuitem"
                onClick={() => void switchTo(w.id)}
                className="flex cursor-pointer items-center gap-2 rounded-btn border-0 bg-transparent p-2 text-left font-body text-body text-ink hover:bg-acc-soft"
              >
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-badge bg-track font-mono text-label">{initials(w.name)}</span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === ws?.id && <span className="text-acc-text">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        {NAV.map(navLink)}
      </nav>
      <MonoLabel className="px-3">Tools</MonoLabel>
      <nav aria-label="Tools" className="flex flex-col gap-0.5">
        {TOOLS.map(navLink)}
      </nav>
      <div className="flex-1" />
      {account?.user && (
        <div className="flex items-center gap-2.5 border-t border-line pt-3">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-pill bg-acc-soft font-mono text-label text-acc-text">{initials(account.user.name ?? account.user.email ?? "")}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ink">{account.user.name ?? account.user.email}</span>
            <span className="text-chip text-mute">{ws ? ROLE_LABEL[ws.role as keyof typeof ROLE_LABEL] : ""}</span>
          </span>
          <form action={signOutAction}>
            <button type="submit" className="cursor-pointer border-0 bg-transparent font-body text-chip text-mute hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg font-body text-body text-ink">
      <aside className="sticky top-[var(--banner-h,0px)] hidden h-[calc(100vh-var(--banner-h,0px))] w-[260px] overflow-y-auto flex-none border-r border-line lg:block print:hidden">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute inset-0 cursor-default border-0 bg-ink/40" />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] overflow-y-auto bg-bg shadow-card" aria-label="Menu">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--banner-h,0px)] z-20 flex items-center gap-3 border-b border-line bg-bg px-panel py-3 print:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-btn border-th border-line bg-transparent text-ink lg:hidden">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
          <Search />
          <div className="flex-1" />
          <Bell unread={account?.unread ?? 0} onRead={() => setAccount((a) => (a ? { ...a, unread: 0 } : a))} />
          <div className="hidden sm:block">
            <AppearanceControls />
          </div>
        </header>
        <main className="mx-auto box-border flex w-full max-w-[1180px] flex-1 flex-col gap-[22px] p-panel">{children}</main>
      </div>
    </div>
  );
}

/** Search this workspace's plans, rosters, talent, watches and data. ⌘K or Ctrl+K focuses it. */
function Search() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; results: Result[] } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/workspace/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ results: Result[] }>) : { results: [] }))
        .then((d) => setFound({ q: term, results: d.results }))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim();
  const results = found && found.q === term ? found.results : null;
  return (
    <div className="relative min-w-0 max-w-[460px] flex-1">
      <label className="flex items-center gap-2 rounded-md border-th border-line bg-surf px-3 py-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none text-mute" aria-hidden>
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3.5 3.5" />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search plans, talent, cities"
          aria-label="Search this workspace"
          className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink outline-none"
        />
        <span className="hidden rounded-badge border-th border-line px-1.5 font-mono text-label text-mute sm:inline">⌘K</span>
      </label>
      {open && term.length >= 2 && results && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 flex flex-col gap-0.5 rounded-md border-th border-line bg-surf p-1.5 shadow-card" role="listbox" aria-label="Search results">
          {results.length === 0 && <span className="p-2 text-chip text-mute">No matches for “{term}”.</span>}
          {results.map((r, i) => (
            <button
              key={`${r.href}-${i}`}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setQ("");
                router.push(r.href);
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded-btn border-0 bg-transparent p-2 text-left font-body text-body text-ink hover:bg-acc-soft"
            >
              <span className="w-14 flex-none font-mono text-label uppercase tracking-[0.06em] text-mute">{r.kind}</span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bell({ unread, onRead }: { unread: number; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[] | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const res = await fetch("/api/workspace/inbox").catch(() => null);
      setItems(res?.ok ? ((await res.json()) as { items: Note[] }).items : []);
    }
  };
  const markRead = async () => {
    await fetch("/api/workspace/inbox", { method: "POST" }).catch(() => null);
    setItems((xs) => xs?.map((x) => ({ ...x, unread: false })) ?? null);
    onRead();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`}
        className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-btn border-th border-line bg-transparent text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M4 11V7a4 4 0 018 0v4l1 1.5H3L4 11zM6.5 14h3" />
        </svg>
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-pill bg-acc px-1.5 font-mono text-[10px] text-on-acc">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex w-[320px] max-w-[90vw] flex-col gap-1 rounded-md border-th border-line bg-surf p-2 shadow-card" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-1 py-1">
            <MonoLabel>Notifications</MonoLabel>
            <button type="button" onClick={() => void markRead()} className="cursor-pointer border-0 bg-transparent font-body text-chip text-acc-text">
              Mark all read
            </button>
          </div>
          {items === null && <span className="p-2 text-chip text-mute">Loading…</span>}
          {items?.length === 0 && <span className="p-2 text-chip text-mute">No mentions yet.</span>}
          {items?.map((x) => (
            <Link key={x.id} href={x.href} onClick={() => setOpen(false)} className="flex gap-2 rounded-btn p-2 text-chip text-ink no-underline hover:bg-acc-soft">
              <span className={cx("mt-1.5 h-1.5 w-1.5 flex-none rounded-pill", x.unread ? "bg-acc-line" : "bg-transparent")} aria-hidden />
              <span className="flex flex-col">
                <span>{x.text}</span>
                <span className="text-mute">{new Date(x.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
            </Link>
          ))}
          <Link href="/workspace/inbox" onClick={() => setOpen(false)} className="px-2 py-1 text-chip">
            All mentions →
          </Link>
        </div>
      )}
    </div>
  );
}

/** Settings sub-tabs, as in the design: General, Members, Branded decks, Inbox. */
export function SettingsTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/workspace/settings", label: "General" },
    { href: "/workspace/members", label: "Members" },
    { href: "/workspace/settings/branding", label: "Branded decks" },
    { href: "/workspace/settings/api", label: "API" },
    { href: "/workspace/settings/white-label", label: "White-label" },
    { href: "/workspace/inbox", label: "Inbox" },
  ];
  return (
    <nav aria-label="Settings" className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-track p-[3px] border-card border-ink">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path === t.href ? "page" : undefined}
          className={cx("whitespace-nowrap rounded-btn px-3.5 py-1.5 text-chip font-medium no-underline", path === t.href ? "bg-surf text-ink shadow-tab" : "text-mute")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A workspace page's heading, as in the design: a small label over a display title. */
export function PageTitle({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <MonoLabel>{label}</MonoLabel>
      <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92] [overflow-wrap:anywhere]">{title}</h1>
      {sub && <p className="m-0 text-chip text-mute">{sub}</p>}
    </section>
  );
}
