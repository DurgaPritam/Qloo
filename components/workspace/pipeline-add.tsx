"use client";

import { useState } from "react";

import { Button } from "../ui";

/** Puts a plan's drafts, or a shortlisted sponsor match, on the workspace's outreach board. */
export function AddToPipeline({ planId, matchId, label = "Add to pipeline" }: { planId?: string; matchId?: string; label?: string }) {
  const [state, setState] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const add = async () => {
    setState({ busy: true, text: null });
    const res = await fetch("/api/workspace/pipeline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(planId ? { planId } : { matchId }) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { added?: number; error?: string };
    const text = !res?.ok ? (data.error ?? "That didn't work.") : data.added ? `Added ${data.added === 1 ? "the draft" : `${data.added} drafts`} to the pipeline.` : "Already in the pipeline.";
    setState({ busy: false, text });
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void add()} loading={state.busy}>
        {label}
      </Button>
      {state.text && (
        <span className="text-chip text-mute" role="status">
          {state.text} <a href="/workspace/pipeline">Open the pipeline</a>
        </span>
      )}
    </span>
  );
}
