"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FIELD } from "../account/fields";
import { Banner, Button, MonoLabel, Panel } from "../ui";

async function post(url: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  return ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";
}

export interface SettingsValues {
  timeZone: string | null;
  currency: string | null;
  outcomeMinSample: number | null;
}

export function WorkspaceSettings({
  name,
  canRename,
  canLeave,
  settings,
  canEditSettings,
  timeZones,
  currencies,
  defaultMinSample,
}: {
  name: string;
  canRename: boolean;
  canLeave: boolean;
  settings: SettingsValues;
  canEditSettings: boolean;
  timeZones: readonly string[];
  currencies: readonly string[];
  defaultMinSample: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ tone: "info" | "err"; text: string } | null>(null);

  const rename = async () => {
    const err = await post("/api/workspace/settings", { name: value });
    setMessage(err ? { tone: "err", text: err } : { tone: "info", text: "Renamed." });
    if (!err) router.refresh();
  };

  const [tz, setTz] = useState(settings.timeZone ?? "");
  const [currency, setCurrency] = useState(settings.currency ?? "");
  const [minSample, setMinSample] = useState(settings.outcomeMinSample?.toString() ?? "");

  const saveSettings = async () => {
    const err = await post("/api/workspace/settings", { timeZone: tz || null, currency: currency || null, outcomeMinSample: minSample.trim() || null });
    setMessage(err ? { tone: "err", text: err } : { tone: "info", text: "Settings saved." });
    if (!err) router.refresh();
  };

  const leave = async () => {
    const err = await post("/api/workspace/members", { action: "leave" });
    if (err) return setMessage({ tone: "err", text: err });
    router.push("/workspace");
    router.refresh();
  };

  return (
    <>
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      <Panel>
        <MonoLabel className="text-acc-text">Name</MonoLabel>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={60}
            disabled={!canRename}
            aria-label="Workspace name"
            className={`${FIELD} min-w-0 flex-1 basis-[220px] disabled:opacity-55`}
          />
          {canRename && (
            <Button type="submit" variant="primary">
              Save
            </Button>
          )}
        </form>
        {!canRename && <p className="m-0 text-chip text-mute">Only owners can rename the workspace.</p>}
      </Panel>
      <Panel>
        <MonoLabel className="text-acc-text">Workspace settings</MonoLabel>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSettings();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-body">Time zone</span>
            <select value={tz} onChange={(e) => setTz(e.target.value)} disabled={!canEditSettings} aria-label="Time zone" className={`${FIELD} cursor-pointer disabled:opacity-55`}>
              <option value="">UTC (not set)</option>
              {timeZones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <span className="text-chip text-mute">Market watch checks run on Monday at 07:00 here, and the weekly digest goes out after them.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body">Currency for logged gross</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canEditSettings} aria-label="Currency" className={`${FIELD} cursor-pointer disabled:opacity-55`}>
              <option value="">Not set</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-chip text-mute">Shown beside every gross amount in Outcomes. Amounts are never converted.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body">Events needed before Outcomes judges</span>
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={minSample}
              onChange={(e) => setMinSample(e.target.value)}
              placeholder={`${defaultMinSample} (default)`}
              disabled={!canEditSettings}
              aria-label="Minimum sample"
              className={`${FIELD} w-40 disabled:opacity-55`}
            />
            <span className="text-chip text-mute">Below this many events with results, cities and partners are not compared with your median.</span>
          </label>
          {canEditSettings ? (
            <div>
              <Button type="submit" variant="primary">
                Save settings
              </Button>
            </div>
          ) : (
            <p className="m-0 text-chip text-mute">Admins change these settings.</p>
          )}
        </form>
      </Panel>
      {canLeave && (
        <Panel>
          <MonoLabel className="text-acc-text">Leave</MonoLabel>
          <p className="m-0 text-body text-mute">You&apos;ll lose access to its plans and comments until someone invites you again.</p>
          <div>
            <Button onClick={leave}>Leave this workspace</Button>
          </div>
        </Panel>
      )}
    </>
  );
}

/** Opening the inbox marks its mentions read, so the header count clears. */
export function MarkInboxRead({ unread }: { unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!unread) return;
    void fetch("/api/workspace/inbox", { method: "POST" }).then(() => router.refresh());
  }, [unread, router]);
  return null;
}
