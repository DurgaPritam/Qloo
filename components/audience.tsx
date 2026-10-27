"use client";

import { useEffect, useState } from "react";

import type { AudienceProfile } from "@/lib/tools/audience";

import { Banner, MonoLabel, Panel, Sk, SourceBadge, cx } from "./ui";

const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;

/** One audience's age and gender skew: bars grow right for over-indexing, left for under. */
export function AudienceCard({ name, profile }: { name: string; profile: AudienceProfile }) {
  const { summary } = profile;
  const gender =
    summary.gender === "balanced" ? "No strong gender skew" : `Skews ${summary.gender} (${signed(summary.genderSkew)})`;
  const ages = summary.skewsTo.length ? `Strongest at ${summary.skewsTo.slice(0, 2).join(" and ")}` : "No age band stands out";
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <div className="text-body font-medium [overflow-wrap:anywhere]">{name}</div>
        <div className="text-chip text-mute">
          {ages}. {gender}.
        </div>
      </div>
      <div className="flex flex-col gap-1.5" role="list" aria-label={`Age skew for ${name}`}>
        {summary.bands.map((b) => (
          <div key={b.key} role="listitem" className="grid items-center gap-2 text-chip [grid-template-columns:88px_1fr_44px]">
            <span className="text-mute">{b.label}</span>
            <div className="relative h-2 rounded-pill bg-track" aria-hidden>
              <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <div
                className={cx("absolute inset-y-0 rounded-pill", b.skew >= 0 ? "left-1/2 bg-acc-line" : "right-1/2 bg-mute")}
                style={{ width: `${Math.min(50, Math.abs(b.skew) * 50)}%` }}
              />
            </div>
            <span className="tabular text-right font-mono">{signed(b.skew)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AudienceGrid({ items }: { items: Array<{ name: string; profile: AudienceProfile }> }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel className="text-acc-text">Who the fans are</MonoLabel>
        <SourceBadge>urn:demographics</SourceBadge>
      </div>
      <div className="grid gap-[22px] md:grid-cols-2">
        {items.map((i) => (
          <AudienceCard key={i.profile.entityId} name={i.name} profile={i.profile} />
        ))}
      </div>
      <p className="m-0 text-chip text-mute [text-wrap:pretty]">
        Qloo&apos;s skew against the general population, from −1 to +1: right of the line means more fans in that group than
        average.
      </p>
    </Panel>
  );
}

/** Loads the profiles for a plan's fanbase and partner (one Qloo call each, cached). */
export function AudiencePanel({ people }: { people: Array<{ id: string; name: string }> }) {
  const key = people.map((p) => p.id).join(",");
  const [state, setState] = useState<{ key: string; profiles?: AudienceProfile[]; error?: string; mock?: boolean }>({ key: "" });

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch("/api/tools/audience", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityIds: key.split(",") }),
    })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as { profiles?: AudienceProfile[]; error?: string; mock?: boolean } }))
      .then(({ ok, body }) => live && setState({ key, profiles: ok ? body.profiles : undefined, error: ok ? undefined : body.error, mock: body.mock }))
      .catch(() => live && setState({ key, error: "The audience profile could not be loaded." }));
    return () => {
      live = false;
    };
  }, [key]);

  if (!key) return null;
  if (state.key !== key) return <Sk.block />;
  if (state.error) return <Banner tone="neutral">{state.error}</Banner>;
  const items = (state.profiles ?? []).flatMap((profile) => {
    const p = people.find((x) => x.id === profile.entityId);
    return p ? [{ name: p.name, profile }] : [];
  });
  if (!items.length) return null;
  return (
    <>
      {state.mock && <Banner tone="warn">SAMPLE DATA — not Qloo results</Banner>}
      <AudienceGrid items={items} />
    </>
  );
}
