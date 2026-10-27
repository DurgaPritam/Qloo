"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { Category } from "@/lib/engine/types";

import { categoryLabel } from "../run/format";
import { planHref } from "../showcase";
import { Banner, Button, Chip, InputBar, MonoLabel, Panel, cx } from "../ui";

/** One Qloo call as the API reports it. */
export interface CallView {
  endpoint: string;
  params: Record<string, string>;
  cached: boolean;
}

/**
 * Fetches a tool's JSON for the `param` in the URL, so every result has a link that can be shared
 * or opened from the landing page. Errors come back as the API's own message.
 */
export function useToolQuery<T>(endpoint: string, param: string, body: (value: string, entityId?: string) => Record<string, unknown>) {
  const params = useSearchParams();
  const router = useRouter();
  const value = (params.get(param) ?? "").trim();
  const id = params.get("id") ?? undefined;
  const key = `${value}|${id ?? ""}`;
  const [state, setState] = useState<{ for: string; data?: T; error?: string; loading: boolean }>({ for: "", loading: false });

  const load = useCallback(
    async (v: string, entityId?: string) => {
      const k = `${v}|${entityId ?? ""}`;
      setState({ for: k, loading: true });
      const done = (next: { data?: T; error?: string }) => setState({ for: k, loading: false, ...next });
      try {
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(v, entityId)) });
        const json = (await res.json()) as T & { error?: string };
        done(res.ok ? { data: json } : { error: json.error ?? "Something went wrong." });
      } catch {
        done({ error: "Network error. Check your connection and try again." });
      }
    },
    // body is a stable formatter supplied by each tool
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch for the value in the URL
    if (value && key !== state.for) void load(value, id);
  }, [value, id, key, state.for, load]);

  const submit = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (t === value && !id) void load(t);
    else router.push(`?${param}=${encodeURIComponent(t)}`);
  };
  /** Picks one of several matches; the pick goes in the URL too. */
  const pick = (entityId: string) => router.push(`?${param}=${encodeURIComponent(value)}&id=${encodeURIComponent(entityId)}`);
  return {
    value,
    state: state.for === key ? state : { for: key, loading: Boolean(value) },
    submit,
    pick,
    retry: () => load(value, id),
  };
}

export function ToolIntro({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <section className="flex flex-col gap-2 pt-4">
      <MonoLabel>{label}</MonoLabel>
      <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">{title}</h1>
      <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">{body}</p>
    </section>
  );
}

export function ToolForm({
  initial,
  placeholder,
  button,
  examples,
  onSubmit,
  busy,
}: {
  initial: string;
  placeholder: string;
  button: string;
  examples: { kind?: string; label: string }[];
  onSubmit: (v: string) => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  // Follow the URL when it changes (an example chip, Back).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(initial), [initial]);
  return (
    <div className="flex flex-col gap-3">
      <InputBar value={draft} onChange={setDraft} onSubmit={() => onSubmit(draft)} placeholder={placeholder} buttonLabel={button} busy={busy} />
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel>Try</MonoLabel>
        {examples.map((e) => (
          <Chip key={e.label} kind={e.kind} label={e.label} onClick={() => onSubmit(e.label)} />
        ))}
      </div>
    </div>
  );
}

export function ToolError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="err" action={onRetry && <Button variant="primary" onClick={onRetry}>Retry</Button>}>
      {message}
    </Banner>
  );
}

export function SampleBanner({ mock }: { mock?: boolean }) {
  return mock ? <Banner tone="warn">SAMPLE DATA — not Qloo results</Banner> : null;
}

/** The Qloo calls behind a result, collapsed by default. */
export function CallsUsed({ calls }: { calls: CallView[] }) {
  if (!calls.length) return null;
  return (
    <details className="rounded-md border-th border-line px-3.5 py-2.5 text-chip text-mute">
      <summary className="cursor-pointer font-mono text-label uppercase tracking-[0.06em] text-acc-text">
        ◆ {calls.length} Qloo call{calls.length === 1 ? "" : "s"} behind this
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        {calls.map((c, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="font-mono text-ink">
              GET {c.endpoint}
              {c.cached ? " · cached" : ""}
            </span>
            <span className="font-mono [overflow-wrap:anywhere]">
              {Object.entries(c.params)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Several matches for the typed name: one button each, with Qloo's description. */
export function ChoicePicker({
  question,
  choices,
  onPick,
}: {
  question: string;
  choices: { entityId: string; name: string; category: string; detail?: string }[];
  onPick: (entityId: string) => void;
}) {
  return (
    <Panel>
      <h2 className="m-0 text-[20px] font-semibold leading-[1.2]">{question}</h2>
      <div className="flex flex-col gap-2">
        {choices.map((c) => (
          <button
            key={c.entityId}
            type="button"
            onClick={() => onPick(c.entityId)}
            className="flex cursor-pointer flex-col items-start gap-0.5 rounded-md border-th border-line bg-bg px-3.5 py-2.5 text-left font-body text-ink hover:bg-acc-soft"
          >
            <span className="text-body font-medium">{c.name}</span>
            <span className="text-chip text-mute">
              {categoryLabel(c.category as Category)}
              {c.detail ? ` · ${c.detail}` : ""}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** A ranked name with a link that plans a takeover for it. */
export function RankRow({ rank, name, meta, extra }: { rank: number; name: string; meta: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-x-3 border-b border-line py-2.5 last:border-b-0">
      <span className={cx("tabular w-6 flex-none font-mono text-chip", rank === 1 ? "text-acc-text" : "text-mute")}>{String(rank).padStart(2, "0")}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium [overflow-wrap:anywhere]">{name}</span>
        <span className="text-chip text-mute">{meta}</span>
      </div>
      {extra}
      <Link
        href={planHref(name)}
        aria-label={`Plan a takeover for ${name}`}
        title="Plan a takeover"
        className="flex-none whitespace-nowrap rounded-btn border-th border-line px-2.5 py-1 text-chip text-ink no-underline hover:bg-acc-soft"
      >
        Plan →
      </Link>
    </div>
  );
}
