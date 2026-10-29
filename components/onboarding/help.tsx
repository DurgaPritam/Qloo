"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { EXAMPLES } from "@/lib/examples";
import { HELP_TOPICS, REGISTRY, tierOf } from "@/lib/features";

import { cx, MonoLabel } from "../ui";
import { TierBadge } from "./tier-badge";
import { TOUR_EVENT } from "./tour";

/** Everything the help panel searches: each feature's help text from the registry, and the general topics. */
const ARTICLES = [
  ...REGISTRY.map((f) => ({
    id: f.id,
    cat: f.account ? "Workspace" : "Tools",
    q: f.name,
    a: `${f.benefit} ${f.help}`,
    numbers: f.numbers,
    tier: tierOf(f),
    href: f.route,
    link: `Open ${f.name}`,
  })),
  ...HELP_TOPICS.map((t) => ({
    id: t.id,
    cat: "Questions",
    q: t.q,
    a: t.a,
    numbers: null,
    tier: null,
    href: t.href,
    link: t.href.startsWith("/method") ? "How it works" : "Open",
  })),
];

export function searchHelp(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return ARTICLES;
  const words = q.split(/\s+/);
  return ARTICLES.filter((a) => {
    const text = `${a.cat} ${a.q} ${a.a} ${a.numbers ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return Boolean(t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable));
};

/** The "?" button and its panel. "?" opens it from anywhere except while typing; Esc closes it. */
export function Help({ workspace = false }: { workspace?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !open && !typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    setTimeout(() => button.current?.focus(), 0);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Help (?)"
        className={cx(
          "flex size-10 flex-none cursor-pointer items-center justify-center rounded-btn border-th border-line font-mono text-[15px] font-medium text-ink hover:bg-acc-soft",
          open ? "bg-acc-soft" : "bg-transparent",
        )}
      >
        ?
      </button>
      {open && <HelpPanel onClose={close} workspace={workspace} />}
    </>
  );
}

function HelpPanel({ onClose, workspace }: { onClose: () => void; workspace: boolean }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Esc closes; Tab stays inside the panel while it is open.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button, input")).filter((el) => !el.hasAttribute("disabled"));
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const query = q.trim();
  const list = searchHelp(query);
  const tourHref = `/run?q=${encodeURIComponent(EXAMPLES[1].name)}&tour=1`;
  const quickLinks = [
    {
      title: "Take the run tour",
      sub: "Five tips on the run screen.",
      href: tourHref,
      onClick: (e: React.MouseEvent) => {
        // On a finished run, restart the tour here instead of opening another run.
        if (document.querySelector('[data-tour="log"]')) {
          e.preventDefault();
          onClose();
          window.dispatchEvent(new Event(TOUR_EVENT));
        }
      },
    },
    { title: "Open the guide", sub: "Every feature, who it's for and its tier.", href: "/guide" },
    ...(workspace ? [{ title: "Getting started checklist", sub: "What's set up in this workspace.", href: "/workspace#getting-started" }] : []),
    { title: "How the numbers are made", sub: "The formulas behind every score.", href: "/method" },
  ];

  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 z-[49] bg-[var(--scrim)]" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tk-help-title"
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-50 box-border flex w-[min(420px,100vw)] flex-col border-l border-th border-line bg-surf text-ink shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
          <h2 id="tk-help-title" className="t-display m-0 flex-1 text-[24px] leading-none">
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="size-9 cursor-pointer border-0 bg-transparent text-[20px] leading-none text-mute hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="px-[18px] pb-1.5 pt-3.5">
          <label className="box-border flex h-11 items-center gap-2 rounded-md border-th border-line bg-bg px-2.5">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none text-mute" aria-hidden>
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpenId(null);
              }}
              placeholder="Search help"
              aria-label="Search help"
              className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="cursor-pointer border-0 bg-transparent p-1 text-[16px] text-mute">
                ×
              </button>
            )}
          </label>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-[18px] pb-[18px] pt-2">
          {!query && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="pb-0.5">Get started</MonoLabel>
              {quickLinks.map((l) => (
                <Link
                  key={l.title}
                  href={l.href}
                  onClick={(e) => (l.onClick ? l.onClick(e) : onClose())}
                  className="flex items-center gap-3 rounded-md border-th border-line bg-bg px-3.5 py-3 text-ink no-underline hover:bg-acc-soft hover:text-ink"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body font-semibold">{l.title}</span>
                    <span className="text-chip text-mute">{l.sub}</span>
                  </span>
                  <span aria-hidden className="font-mono text-chip text-acc-text">
                    →
                  </span>
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-col">
            <MonoLabel className="tabular pb-2">
              <span role="status">{query ? `${list.length} result${list.length === 1 ? "" : "s"}` : "Features and questions"}</span>
            </MonoLabel>
            {list.map((a) => {
              const o = openId === a.id;
              return (
                <div key={a.id} className="border-t border-line" data-help-article={a.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(o ? null : a.id)}
                    aria-expanded={o}
                    className="flex w-full cursor-pointer items-start gap-2.5 border-0 bg-transparent py-3 text-left font-body text-ink"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-mono text-label uppercase tracking-[0.06em] text-mute">
                        {a.cat}
                        {a.tier && <TierBadge tier={a.tier} />}
                      </span>
                      <span className="text-body font-medium [text-wrap:pretty]">{a.q}</span>
                    </span>
                    <span aria-hidden className="pt-4 font-mono text-chip text-mute">
                      {o ? "–" : "+"}
                    </span>
                  </button>
                  {o && (
                    <div className="mb-3.5 flex flex-col gap-2 text-body text-mute">
                      <p className="m-0 [text-wrap:pretty]">{a.a}</p>
                      {a.numbers && <p className="m-0 text-chip [text-wrap:pretty]">Numbers: {a.numbers}</p>}
                      <Link href={a.href} onClick={onClose} className="text-chip">
                        {a.link} →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
            {query && list.length === 0 && (
              <div className="flex flex-col gap-1 border-t border-line py-3">
                <span className="font-medium">Nothing matches “{q}”</span>
                <span className="text-chip text-mute">Try “score”, “invite”, “tour” or “CSV”, or open the guide.</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-[18px] py-3">
          <span className="min-w-[140px] flex-1 text-chip text-mute">Every formula and data source is on How it works.</span>
          <Link
            href="/method"
            onClick={onClose}
            className="whitespace-nowrap rounded-btn border-th border-line px-3 py-1.5 text-chip text-ink no-underline hover:bg-acc-soft hover:text-ink"
          >
            How it works
          </Link>
        </div>
      </aside>
    </>
  );
}
