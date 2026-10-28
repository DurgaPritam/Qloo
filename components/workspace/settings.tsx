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

export function WorkspaceSettings({ name, canRename, canLeave }: { name: string; canRename: boolean; canLeave: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ tone: "info" | "err"; text: string } | null>(null);

  const rename = async () => {
    const err = await post("/api/workspace/settings", { name: value });
    setMessage(err ? { tone: "err", text: err } : { tone: "info", text: "Renamed." });
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
