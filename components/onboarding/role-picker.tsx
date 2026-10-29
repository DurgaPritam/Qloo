"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ROLES, type RoleCard, type RoleKey } from "@/lib/features";

import { cx, MonoLabel } from "../ui";
import { TierBadge } from "./tier-badge";

/** Radio pill. Selected: lime fill and ink text (Gen Z adds an ink outline and a 2px shadow). */
export function RolePill({ on, onClick, children, size = "md" }: { on: boolean; onClick: () => void; children: ReactNode; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        "cursor-pointer rounded-pill border-th font-body hover:border-acc-line",
        size === "md" ? "min-h-10 px-4 py-2 text-body" : "min-h-9 px-3.5 py-1.5 text-chip",
        on
          ? "border-acc bg-acc font-semibold text-on-acc [[data-theme=genz]_&]:border-ink [[data-theme=genz]_&]:shadow-[2px_2px_0_var(--ink)]"
          : "border-line bg-transparent text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Arrow keys move between radios, as a radiogroup should. */
export function radioKeys(keys: readonly string[], current: string, pick: (k: string) => void) {
  return (e: React.KeyboardEvent) => {
    const i = keys.indexOf(current);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = keys[(i + step + keys.length) % keys.length];
    pick(next);
    (e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[keys.indexOf(next)] as HTMLButtonElement | undefined)?.focus();
  };
}

/** Landing: "What can I do?" — pick a role, see three tools to start with. Sits under the hero. */
export function WhatCanIDo({ cards }: { cards: Record<RoleKey, RoleCard[]> }) {
  const [role, setRole] = useState<RoleKey>("promoter");
  const keys = ROLES.map((r) => r.key);
  return (
    <section aria-labelledby="tk-wcid" className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
      <div className="flex flex-col gap-1.5">
        <MonoLabel>Start here</MonoLabel>
        <h2 id="tk-wcid" className="t-display m-0 text-[clamp(28px,5vw,36px)] leading-[0.92]">
          What can I do?
        </h2>
        <p className="m-0 text-mute [text-wrap:pretty]">Pick the role closest to yours to see where to start.</p>
      </div>
      <div role="radiogroup" aria-label="Your role" className="flex flex-wrap gap-2" onKeyDown={radioKeys(keys, role, (k) => setRole(k as RoleKey))}>
        {ROLES.map((r) => (
          <RolePill key={r.key} on={r.key === role} onClick={() => setRole(r.key)}>
            {r.label}
          </RolePill>
        ))}
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]" data-role-tools={role}>
        {cards[role].map((tool, i) => (
          <RoleToolCard key={tool.id} n={i + 1} tool={tool} />
        ))}
      </div>
      <Link href="/guide" className="self-start text-chip">
        See every feature in the guide
      </Link>
    </section>
  );
}

function RoleToolCard({ n, tool }: { n: number; tool: RoleCard }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surf p-[18px] border-card border-ink shadow-card" data-role-tool={tool.id}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">Tool {String(n).padStart(2, "0")}</span>
        <TierBadge tier={tool.tier} />
      </div>
      <h3 className="m-0 text-[16px] font-semibold">{tool.name}</h3>
      <p className="m-0 text-body text-mute [text-wrap:pretty]">{tool.benefit}</p>
      <p className="m-0 flex-1 pb-2.5 text-chip text-mute">
        {tool.account ? "Needs an account. " : ""}
        {tool.more ? `Free to try; ${tool.more}.` : ""}
      </p>
      {tool.example ? (
        <Link
          href={tool.example.href}
          data-example
          className="flex min-h-10 items-center gap-2 rounded-btn border-th border-line px-3 py-2 text-ink no-underline hover:bg-acc-soft hover:text-ink"
        >
          <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">Try</span>
          <span className="min-w-0 flex-1 truncate text-chip">{tool.example.label} · cached run</span>
          <span aria-hidden className="font-mono text-chip text-acc-text">
            →
          </span>
        </Link>
      ) : (
        <Link href={tool.route} className="flex min-h-10 items-center gap-2 rounded-btn border-th border-line px-3 py-2 text-ink no-underline hover:bg-acc-soft hover:text-ink">
          <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">Open</span>
          <span className="min-w-0 flex-1 truncate text-chip">{tool.name}</span>
          <span aria-hidden className="font-mono text-chip text-acc-text">
            →
          </span>
        </Link>
      )}
    </div>
  );
}
