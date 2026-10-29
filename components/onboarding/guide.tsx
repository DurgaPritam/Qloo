"use client";

import Link from "next/link";
import { useState } from "react";

import { ROLES, type RoleKey } from "@/lib/features";
import type { GuideRow } from "@/lib/onboarding/guide";

import { Button, cx, MonoLabel } from "../ui";
import { radioKeys, RolePill } from "./role-picker";
import { TierBadge } from "./tier-badge";

const COLS = "md:grid md:gap-[18px] md:[grid-template-columns:minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.1fr)]";

/** /guide: search, a role filter and one section per role. A feature can sit under several roles. */
export function GuideList({ rows, signedIn }: { rows: GuideRow[]; signedIn: boolean }) {
  const [role, setRole] = useState<RoleKey | "all">("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const keys = ["all", ...ROLES.map((r) => r.key)];
  const groups = ROLES.filter((r) => role === "all" || r.key === role)
    .map((r) => ({ ...r, items: rows.filter((f) => f.roles.includes(r.key) && (!query || `${f.name} ${f.benefit} ${f.numbers} ${f.tier}`.toLowerCase().includes(query))) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <label className="box-border flex h-11 max-w-[520px] items-center gap-2 rounded-md border-th border-line bg-surf px-3 shadow-card">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none text-mute" aria-hidden>
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search features"
            aria-label="Search features"
            className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink outline-none"
          />
        </label>
        <div role="radiogroup" aria-label="Filter by role" className="flex flex-wrap gap-2" onKeyDown={radioKeys(keys, role, (k) => setRole(k as RoleKey | "all"))}>
          <RolePill size="sm" on={role === "all"} onClick={() => setRole("all")}>
            All roles
          </RolePill>
          {ROLES.map((r) => (
            <RolePill size="sm" key={r.key} on={role === r.key} onClick={() => setRole(r.key)}>
              {r.label}
            </RolePill>
          ))}
        </div>
        {!signedIn && <p className="m-0 text-chip text-mute">Signed out: features marked as needing an account open the sign-in page first, then the feature.</p>}
      </div>

      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="flex flex-col gap-2.5" data-guide-role={g.key}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-display m-0 text-[clamp(24px,4vw,30px)] leading-none">{g.label}</h2>
            <span className="tabular whitespace-nowrap font-mono text-label uppercase tracking-[0.06em] text-mute">
              {g.items.length} feature{g.items.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="rounded-lg bg-surf px-panel py-1 border-card border-ink shadow-card">
            <div className={cx(COLS, "hidden border-b border-line pb-2 pt-3 font-mono text-label uppercase tracking-[0.06em] text-mute md:grid")}>
              <span>Feature</span>
              <span>Where its numbers come from</span>
              <span>Try it</span>
              <span className="text-right">Plan</span>
            </div>
            {g.items.map((f, i) => (
              <div key={f.id} data-guide-feature={f.id} className={cx(COLS, "flex flex-col gap-1.5 py-3.5 md:items-baseline", i < g.items.length - 1 && "border-b border-line")}>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 text-[16px] font-semibold">{f.name}</span>
                    <span className="md:hidden">
                      <TierBadge tier={f.tier} />
                    </span>
                  </div>
                  <span className="text-mute [text-wrap:pretty]">{f.benefit}</span>
                </div>
                <span className="text-chip [text-wrap:pretty]">
                  <MonoLabel className="md:hidden">Numbers </MonoLabel>
                  {f.numbers}
                </span>
                <span className="text-chip">
                  {f.example ? (
                    <Link href={f.example.href} data-example>
                      {f.example.label} · cached run →
                    </Link>
                  ) : (
                    <Link href={f.route}>Open {f.name} →</Link>
                  )}
                </span>
                <span className="flex flex-col gap-1 md:items-end md:text-right">
                  <span className="hidden md:inline">
                    <TierBadge tier={f.tier} />
                  </span>
                  <span className="text-chip text-mute [text-wrap:pretty]" data-access>
                    {f.access.text}
                  </span>
                  {f.access.href !== f.route && (
                    <Link href={f.access.href} className="text-chip">
                      {f.access.label} →
                    </Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-lg border-th border-dashed border-line bg-surf px-panel py-8">
          <span className="font-semibold">No features match “{q}”</span>
          <span className="text-chip text-mute">Try a tool name like “tour” or “sponsor”, or clear the role filter.</span>
          <Button
            className="mt-1"
            onClick={() => {
              setQ("");
              setRole("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      <p className="m-0 flex flex-wrap gap-x-[18px] gap-y-2 border-t border-line pt-[18px] text-chip text-mute">
        <span className="min-w-[220px] flex-1">
          Plans: Free, Pro, Team and Enterprise. Each includes everything in the one before it. Limits are placeholders until pricing is confirmed.
        </span>
        <Link href="/method">How the numbers are made</Link>
        <Link href={signedIn ? "/workspace/settings/billing" : "/signin?next=%2Fworkspace%2Fsettings%2Fbilling"}>Compare plans</Link>
      </p>
    </>
  );
}
