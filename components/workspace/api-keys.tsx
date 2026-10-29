"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, DataTable, MonoLabel, Panel, useCopy } from "../ui";

/** Settings → API: keys (shown once), and this month's usage against the tier's quota. */
export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  used: number;
  byEndpoint: { endpoint: string; count: number }[];
}

export function ApiKeys({ keys, canManage, limits, tier, note }: { keys: KeyRow[]; canManage: boolean; limits: { perMinute: number; monthly: number; keys: number }; tier: string; note: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();
  const live = keys.filter((k) => !k.revokedAt);

  const create = async () => {
    setError(null);
    const res = await fetch("/api/workspace/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { key?: string; error?: string };
    if (!res?.ok || !data.key) return setError(data.error ?? "That didn't work.");
    setCreated({ key: data.key, name });
    setName("");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-[18px]">
      {error && <Banner tone="err">{error}</Banner>}
      {created && (
        <Banner tone="info">
          <span className="flex flex-col gap-2">
            <span>Copy the key for {created.name} now: it is shown only this once, and Takeover keeps only a hash of it.</span>
            <code className="font-mono text-chip [overflow-wrap:anywhere]" data-new-key>
              {created.key}
            </code>
            <span>
              <Button onClick={() => copy("key", created.key)}>{copied === "key" ? "Copied" : "Copy key"}</Button>
            </span>
          </span>
        </Banner>
      )}
      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>Plan · {tier}</MonoLabel>
          <span className="tabular font-mono text-chip text-mute">
            {limits.perMinute} requests a minute · {limits.monthly.toLocaleString("en-GB")} a month per key · {live.length} of {limits.keys} keys
          </span>
        </div>
        <span className="text-chip text-mute">{note}</span>
        {canManage && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Key name, e.g. Website" aria-label="Key name" className={cx(FIELD, "min-w-0 flex-1 basis-[220px]")} />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Create key
            </Button>
          </form>
        )}
      </Panel>
      <section className="flex flex-col gap-2" aria-label="Keys and usage">
        <MonoLabel>Keys and usage this month</MonoLabel>
        <DataTable
          columns={["Key", "Used", "Endpoints", ""]}
          template="minmax(0,1.4fr) minmax(110px,auto) minmax(0,1.6fr) minmax(80px,auto)"
          rows={keys.map((k) => [
            <span key="k" className="flex flex-col" data-key-row={k.name}>
              <span className="font-medium">{k.name}</span>
              <span className="font-mono text-chip text-mute">
                {k.prefix}… · {k.revokedAt ? "revoked" : k.lastUsedAt ? `used ${k.lastUsedAt.slice(0, 10)}` : "not used yet"}
              </span>
            </span>,
            <span key="u" className="flex flex-col gap-1">
              <span className="tabular font-mono text-chip">
                {k.used.toLocaleString("en-GB")} / {limits.monthly.toLocaleString("en-GB")}
              </span>
              <span className="h-1.5 overflow-hidden rounded-pill bg-track">
                <span className="block h-full bg-acc-line" style={{ width: `${Math.min(100, Math.round((k.used / limits.monthly) * 100))}%` }} />
              </span>
            </span>,
            <span key="e" className="font-mono text-chip text-mute [overflow-wrap:anywhere]">
              {k.byEndpoint.length ? k.byEndpoint.map((e) => `${e.endpoint} ${e.count}`).join(" · ") : "—"}
            </span>,
            canManage && !k.revokedAt ? (
              <Button
                key="r"
                onClick={async () => {
                  await fetch(`/api/workspace/api-keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" }).catch(() => null);
                  router.refresh();
                }}
              >
                Revoke
              </Button>
            ) : (
              <span key="r" />
            ),
          ])}
        />
      </section>
      <span className="text-chip text-mute">
        Send the key as <code className="font-mono">Authorization: Bearer tk_…</code>. Reference: <a href="/developers">API docs</a>.
      </span>
    </div>
  );
}
