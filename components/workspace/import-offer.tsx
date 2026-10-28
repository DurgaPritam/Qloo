"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { loadSaved } from "@/lib/saved-plans";

import { Banner, Button } from "../ui";

const handledKey = (workspaceId: string) => `takeover:import-handled:v1:${workspaceId}`;

function readHandled(workspaceId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(handledKey(workspaceId)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function markHandled(workspaceId: string, ids: string[]) {
  try {
    localStorage.setItem(handledKey(workspaceId), JSON.stringify([...new Set([...readHandled(workspaceId), ...ids])]));
  } catch {
    // Private mode: the offer may come back next visit.
  }
}

/**
 * Offers to copy the plans saved in this browser (My plans) into the workspace. Each plan is
 * offered once per workspace, whether imported or dismissed; the browser list is left as it is.
 */
export function ImportOffer({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const handled = new Set(readHandled(workspaceId));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads this browser's storage after mount
    setIds(loadSaved().map((p) => p.runId).filter((id) => !handled.has(id)));
  }, [workspaceId]);

  if (result) return <Banner tone="info">{result}</Banner>;
  if (!ids.length) return null;

  const importAll = async () => {
    setBusy(true);
    const res = await fetch("/api/workspace/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runIds: ids }) }).catch(() => null);
    const body = res ? ((await res.json()) as { imported?: number; already?: number; missing?: number; error?: string }) : null;
    setBusy(false);
    if (!res?.ok || !body) return setResult(body?.error ?? "The import didn't work. Try again.");
    markHandled(workspaceId, ids);
    const parts = [`Imported ${body.imported} plan${body.imported === 1 ? "" : "s"} into ${workspaceName}.`];
    if (body.already) parts.push(`${body.already} were already here.`);
    if (body.missing) parts.push(`${body.missing} had expired and could not be copied.`);
    setResult(parts.join(" "));
    router.refresh();
  };

  return (
    <Banner
      tone="info"
      action={
        <div className="flex gap-2">
          <Button variant="primary" loading={busy} onClick={importAll}>
            Import {ids.length} plan{ids.length === 1 ? "" : "s"}
          </Button>
          <Button
            onClick={() => {
              markHandled(workspaceId, ids);
              setIds([]);
            }}
          >
            Not now
          </Button>
        </div>
      }
    >
      You have {ids.length} plan{ids.length === 1 ? "" : "s"} saved in this browser (My plans). Copy them into {workspaceName}? Links you
      already shared keep working.
    </Banner>
  );
}
