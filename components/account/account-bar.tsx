"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AccountState } from "@/app/api/account/route";

/**
 * The header's account corner: "Sign in" when signed out; the workspace switcher, inbox and
 * workspace link when signed in. Loaded after paint, so every page stays static.
 */
export function AccountBar() {
  const [state, setState] = useState<AccountState | null>(null);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    let live = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json() as Promise<AccountState>)
      .then((s) => live && setState(s))
      .catch(() => live && setState({ user: null }));
    return () => {
      live = false;
    };
  }, [path]);

  if (!state) return <div className="h-[30px] w-[72px] flex-none" aria-hidden />;

  const link = "whitespace-nowrap rounded-btn px-2.5 py-1 text-chip no-underline text-mute hover:bg-acc-soft hover:text-ink";

  if (!state.user) {
    return (
      <Link href={`/signin?next=${encodeURIComponent(path === "/signin" ? "/workspace" : path)}`} className={`${link} border-th border-line text-ink`}>
        Sign in
      </Link>
    );
  }

  const switchTo = async (id: string) => {
    await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
    setState({ ...state, workspace: state.workspaces?.find((w) => w.id === id) });
    router.refresh();
  };

  return (
    <div className="flex flex-none items-center gap-1">
      {state.workspaces && state.workspaces.length > 1 ? (
        <select
          aria-label="Workspace"
          value={state.workspace?.id}
          onChange={(e) => switchTo(e.target.value)}
          className="max-w-[180px] cursor-pointer truncate rounded-btn border-th border-line bg-bg px-2 py-1 font-body text-chip text-ink"
        >
          {state.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : null}
      <Link href="/workspace" className={link} aria-label={`Workspace: ${state.workspace?.name ?? ""}`}>
        {state.workspaces && state.workspaces.length > 1 ? "Workspace" : (state.workspace?.name ?? "Workspace")}
      </Link>
      <Link href="/workspace/inbox" className={link} aria-label={`Inbox, ${state.unread ?? 0} unread`}>
        Inbox{state.unread ? <span className="ml-1 rounded-pill bg-acc px-1.5 font-mono text-label text-on-acc">{state.unread}</span> : null}
      </Link>
    </div>
  );
}
