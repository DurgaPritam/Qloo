import type { Metadata } from "next";

import { AppHeader, MonoLabel, Page, Panel, SourceBadge } from "@/components/ui";
import { ATTRIBUTION } from "@/lib/api/attribution";
import { ENDPOINTS } from "@/lib/api/openapi";
import { PLACEHOLDER_NOTE, TIERS } from "@/lib/entitlements";

export const metadata: Metadata = { title: "API docs · Takeover", description: "Takeover's public API: fan overlap, fanbase cities, venues, brand matches and plans, from Qloo taste data." };

/** The public API's docs, from the same list the OpenAPI description is built from. */
export default function DevelopersPage() {
  return (
    <Page max="max-w-[960px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Developers</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Takeover API</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute">
          The same engine as the site, over REST: fan overlap, where a fanbase is strongest, who to book in a city, brand matches, and full plans. Machine-readable description:{" "}
          <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1).
        </p>
      </section>

      <Panel>
        <MonoLabel>Authentication</MonoLabel>
        <p className="m-0 text-body">
          Create a key in your workspace under Settings → API. It is shown once; Takeover keeps only a hash. Send it on every request:
        </p>
        <pre className="m-0 overflow-x-auto rounded-md bg-bg p-3 font-mono text-chip">{`curl -H "Authorization: Bearer tk_…" "https://<host>/api/v1/overlap?a=Phoebe%20Bridgers&b=PEN15"`}</pre>
      </Panel>

      <Panel>
        <MonoLabel>Plan and limits per key</MonoLabel>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
          <li className="tabular font-mono text-chip">
            {TIERS.enterprise.label}: {TIERS.enterprise.limits.api.perMinute} requests a minute, {TIERS.enterprise.limits.api.monthly.toLocaleString("en-GB")} a month, {TIERS.enterprise.limits.api.keys} keys
          </li>
        </ul>
        <span className="text-chip text-mute">{PLACEHOLDER_NOTE} Over the minute limit: 429 rate_limited with Retry-After. Over the month: 429 quota_exceeded, until the 1st (UTC).</span>
      </Panel>

      <Panel>
        <MonoLabel>Every response</MonoLabel>
        <pre className="m-0 overflow-x-auto rounded-md bg-bg p-3 font-mono text-chip">{JSON.stringify({ data: "…", evidence: { requests: ["the Qloo requests behind the figures"], method: "how each figure is computed" }, attribution: ATTRIBUTION, meta: { quota: { used: 12, limit: 500 } } }, null, 2)}</pre>
        <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
          <SourceBadge /> Show the attribution (“{ATTRIBUTION.text}”, linked to {ATTRIBUTION.url}) wherever you display the data. Capacity, dates, prices and fees are never in the data: they are always to confirm.
        </span>
      </Panel>

      <section className="flex flex-col gap-3" aria-label="Endpoints">
        <MonoLabel>Endpoints</MonoLabel>
        {ENDPOINTS.map((e) => (
          <Panel key={`${e.method} ${e.path}`} className="gap-2">
            <h2 className="m-0 font-mono text-[15px]">
              {e.method.toUpperCase()} /api/v1{e.path}
            </h2>
            <p className="m-0 text-body">{e.description}</p>
            {[...e.params.map((p) => ({ name: p.name, required: p.required, description: p.description })), ...(e.body ?? []).map((b) => ({ name: b.field, required: b.required, description: b.description }))].map((p) => (
              <span key={p.name} className="text-chip">
                <code className="font-mono">{p.name}</code>
                {p.required ? " (required)" : ""}: {p.description}
              </span>
            ))}
            <code className="font-mono text-chip text-mute">Example: /api/v1{e.example}</code>
          </Panel>
        ))}
      </section>
    </Page>
  );
}
