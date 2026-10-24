"use client";

import { useEffect, useState } from "react";

import type { NeedsInput } from "@/lib/agent/types";
import { EXAMPLES } from "@/lib/examples";

import { Banner, Button, Chip, MonoLabel, Panel, cx } from "../ui";
import { categoryLabel } from "./format";

/* (a) Several entities match */
export function EntityPicker({ needs, onPick, busy }: { needs: NeedsInput; onPick: (entityId: string) => void; busy?: boolean }) {
  const [picked, setPicked] = useState(0);
  const choice = needs.choices[picked];
  return (
    <Panel className="gap-3.5">
      <div className="text-body font-medium">{needs.question}</div>
      <div role="radiogroup" aria-label={needs.question} className="flex flex-col gap-1.5">
        {needs.choices.map((m, i) => (
          <button
            key={m.entityId}
            type="button"
            role="radio"
            aria-checked={i === picked}
            onClick={() => setPicked(i)}
            className={cx(
              "grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-bg p-2 text-left font-body text-ink",
              i === picked ? "border-acc-line" : "border-line",
            )}
          >
            {m.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Qloo image URLs are external and unknown up front.
              <img src={m.imageUrl} alt={`${m.name} (${m.detail})`} className="size-[52px] rounded-btn object-cover" />
            ) : (
              <div
                aria-hidden
                className="flex size-[52px] items-center justify-center rounded-btn bg-[repeating-linear-gradient(135deg,var(--track)_0_6px,var(--surf)_6px_12px)] font-mono text-[9px] uppercase text-mute"
              >
                img
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-body text-[16px] font-semibold leading-[1.2]">{m.name}</span>
                <span className="rounded-badge bg-acc-soft px-1.5 py-px font-mono text-label uppercase tracking-[0.06em] text-acc-text">
                  {categoryLabel(m.category)}
                </span>
              </div>
              <span className="text-chip text-mute">{m.detail}</span>
            </div>
            <span className="pr-1.5 font-mono text-label uppercase tracking-[0.06em] text-acc-text">{i === picked ? "Selected" : ""}</span>
          </button>
        ))}
      </div>
      <div>
        <Button variant="primary" loading={busy} disabled={!choice} onClick={() => choice && onPick(choice.entityId)}>
          {busy ? "Planning…" : `Plan with ${choice?.name ?? "this one"}`}
        </Button>
      </div>
    </Panel>
  );
}

/* (b) No match, or a likely misspelling */
export function NoMatch({
  query,
  needs,
  onPick,
  onExample,
}: {
  query: string;
  needs: NeedsInput;
  onPick: (entityId: string) => void;
  onExample: (name: string) => void;
}) {
  const suggestions = needs.kind === "did_you_mean" ? needs.choices : [];
  return (
    <Panel className="gap-3.5">
      <div className="flex flex-col gap-1.5 pb-1">
        <h3 className="t-display m-0 text-[28px] leading-[0.92]">We couldn&apos;t find that fanbase</h3>
        <p className="m-0 text-body text-mute">
          Qloo has no entity called “{query}”.{suggestions.length ? " Did you mean one of these?" : " Try one of these instead."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.length
          ? suggestions.map((s) => <Chip key={s.entityId} kind={categoryLabel(s.category)} label={s.name} onClick={() => onPick(s.entityId)} />)
          : EXAMPLES.map((e) => <Chip key={e.name} kind={e.kind} label={e.name} onClick={() => onExample(e.name)} />)}
      </div>
    </Panel>
  );
}

/* (e) API busy or rate limited */
export function ApiBusy({ message, onRetry, onExample }: { message: string; onRetry: () => void; onExample: (name: string) => void }) {
  const [retryIn, setRetryIn] = useState(8);
  useEffect(() => {
    if (retryIn <= 0) return;
    const id = setTimeout(() => setRetryIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [retryIn]);
  return (
    <Panel>
      <Banner
        tone="info"
        action={
          <Button variant="primary" className="tabular px-3.5 py-[7px]" disabled={retryIn > 0} onClick={onRetry}>
            {retryIn > 0 ? `Retry in ${retryIn}s` : "Retry now"}
          </Button>
        }
      >
        <span className="text-body">{message}</span>
      </Banner>
      <div className="flex flex-col gap-2">
        <MonoLabel>While you wait · examples</MonoLabel>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Chip key={e.name} kind={e.kind} label={e.name} onClick={() => onExample(e.name)} />
          ))}
        </div>
      </div>
    </Panel>
  );
}
