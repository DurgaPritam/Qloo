"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ChecklistView } from "@/lib/onboarding/checklist";

import { Button, cx, MonoLabel } from "../ui";
import { TierBadge } from "./tier-badge";

/**
 * Getting started, for a workspace: each step ticks itself from the workspace's own data. The
 * first step not done gets the primary button; a step the plan doesn't include says which tier
 * does and links there. Dismissing hides it for the whole workspace.
 */
export function GettingStarted({ view, workspace }: { view: ChecklistView; workspace: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState(false);
  if (view.dismissed || hidden) return null;
  const rows = view.rows;
  const count = rows.filter((r) => r.done).length;
  const complete = count === rows.length;
  const firstTodo = rows.findIndex((r) => !r.done && !r.needs);

  const dismiss = async () => {
    const res = await fetch("/api/workspace/onboarding", { method: "POST" }).catch(() => null);
    if (!res?.ok) return setError(true);
    setHidden(true);
    router.refresh();
  };

  return (
    <section id="getting-started" aria-labelledby="tk-gs" className="flex scroll-mt-20 flex-col gap-3.5 rounded-lg bg-surf p-panel border-card border-ink shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <MonoLabel>Getting started</MonoLabel>
          <h2 id="tk-gs" className="t-display m-0 text-[clamp(24px,4vw,28px)] leading-none [overflow-wrap:anywhere]">
            {complete ? "You’re set up" : `Set up ${workspace}`}
          </h2>
        </div>
        {view.canDismiss && (
          <button type="button" onClick={() => void dismiss()} className="cursor-pointer border-0 bg-transparent py-1.5 font-body text-chip text-mute hover:text-ink">
            Dismiss
          </button>
        )}
      </div>
      {error && <p className="m-0 text-chip text-err">That didn&apos;t save. Try again.</p>}
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={count}
          className="h-2 flex-1 overflow-hidden rounded-pill bg-track"
        >
          <div className="h-full rounded-pill bg-acc-line transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(count / rows.length) * 100}%` }} />
        </div>
        <span className="tabular whitespace-nowrap font-mono text-[11px] text-mute" data-checklist-count>
          {count} of {rows.length} done
        </span>
      </div>
      {complete ? (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 max-w-[52ch] text-mute [text-wrap:pretty]">Everything&apos;s in place. The guide shows what else Takeover does for your role.</p>
          <Link
            href="/guide"
            className="rounded-btn bg-acc px-4 py-2.5 text-body font-semibold text-on-acc no-underline border-card border-ink shadow-card hover:text-on-acc hover:brightness-110"
          >
            Open the guide
          </Link>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((it, i) => (
            <li key={it.key} className="flex items-start gap-3.5 border-t border-line py-3" data-checklist={it.key} data-done={it.done || undefined}>
              <span
                aria-hidden
                className={cx(
                  "box-border flex size-6 flex-none items-center justify-center rounded-pill border-[1.5px] text-chip font-bold text-on-acc",
                  it.done ? "border-acc bg-acc [[data-theme=genz]_&]:border-ink" : "border-line bg-transparent",
                )}
              >
                {it.done ? "✓" : ""}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-2.5">
                <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                  <span className={cx("font-semibold", it.done ? "text-mute" : "text-ink")}>
                    {it.title}
                    {it.done && <span className="sr-only"> (done)</span>}
                  </span>
                  <span className="text-chip text-mute [text-wrap:pretty]">{it.sub}</span>
                </div>
                {it.done ? (
                  <span className="px-1 font-mono text-label uppercase tracking-[0.06em] text-acc-text">Done</span>
                ) : it.needs ? (
                  <Link
                    href={it.needs.selfServe ? `/workspace/settings/billing?tier=${it.needs.tier}` : "/workspace/settings/billing#contact"}
                    className="flex items-center gap-2 rounded-btn border-th border-line px-3 py-1.5 text-chip text-ink no-underline hover:bg-acc-soft hover:text-ink"
                  >
                    <TierBadge tier={it.needs.tier} /> Comes with {it.needs.label}
                  </Link>
                ) : (
                  <Link
                    href={it.href}
                    className={cx(
                      "rounded-btn px-3 py-1.5 text-chip no-underline",
                      i === firstTodo
                        ? "bg-acc font-medium text-on-acc border-card border-ink hover:text-on-acc"
                        : "border-th border-line text-ink hover:bg-acc-soft hover:text-ink",
                    )}
                  >
                    {it.cta}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {complete && view.canDismiss && (
        <div>
          <Button onClick={() => void dismiss()}>Dismiss</Button>
        </div>
      )}
    </section>
  );
}
