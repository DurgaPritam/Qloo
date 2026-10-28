"use client";

import { useState } from "react";

import { Banner, Segmented } from "../ui";

export interface MemberView {
  workspaceName: string;
  visibility: "workspace" | "public";
  canShare: boolean;
}

/** Who can open this plan's link: the workspace only (default) or anyone with it. */
export function PlanSharing({ planId, member }: { planId: string; member: MemberView }) {
  const [visibility, setVisibility] = useState(member.visibility);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: "workspace" | "public") => {
    if (next === visibility) return;
    const before = visibility;
    setVisibility(next);
    setError(null);
    const res = await fetch("/api/workspace/visibility", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId, visibility: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setVisibility(before);
      setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Sharing didn't change. Try again.");
    }
  };

  return (
    <>
      <Banner
        tone={visibility === "public" ? "info" : "neutral"}
        action={
          member.canShare ? (
            <Segmented
              label="Who can open this link"
              value={visibility}
              onChange={change}
              options={[
                { value: "workspace", label: "Workspace only" },
                { value: "public", label: "Anyone with the link" },
              ]}
            />
          ) : undefined
        }
      >
        {visibility === "public"
          ? `In ${member.workspaceName}. Anyone with the link can view it; comments stay inside the workspace.`
          : `In ${member.workspaceName}. Only its members can open this link.`}
      </Banner>
      {error && <Banner tone="err">{error}</Banner>}
    </>
  );
}
