"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CommentTarget } from "@/lib/db/schema";
import { splitMentions } from "@/lib/workspace/mentions";

import { FIELD } from "../account/fields";
import { Banner, Button, Chip, MonoLabel, OutlineChip, Panel, Sk, cx } from "../ui";

interface Comment {
  id: string;
  targetType: CommentTarget;
  targetId: string;
  parentId: string | null;
  body: string;
  author: string;
  mine: boolean;
  resolved: boolean;
  createdAt: string;
}

interface State {
  can: { comment: boolean; resolve: boolean };
  targets: { type: CommentTarget; id: string; label: string }[];
  members: { handle: string; name: string | null }[];
  comments: Comment[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Threaded comments on the plan and on each decision; @handles notify workspace members in-app. */
export function PlanComments({ planId }: { planId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/workspace/comments?planId=${planId}`, { cache: "no-store" }).catch(() => null);
    const body = res ? ((await res.json()) as State & { error?: string }) : null;
    if (!res?.ok || !body) return setError(body?.error ?? "Comments could not be loaded.");
    setError(null);
    setState(body);
  }, [planId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once per plan
    void load();
  }, [load]);

  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId, ...payload }) }).catch(() => null);
    const body = res ? ((await res.json()) as { error?: string }) : null;
    if (!res?.ok) {
      setError(body?.error ?? "That didn't save. Try again.");
      return false;
    }
    await load();
    return true;
  };

  if (error && !state) return <Banner tone="err">{error}</Banner>;
  if (!state) return <Sk.block />;

  const handles = new Set(state.members.map((m) => m.handle.toLowerCase()));
  const open = state.comments.filter((c) => !c.parentId && !c.resolved).length;

  return (
    <Panel>
      <div id="comments" className="flex flex-wrap items-baseline justify-between gap-2">
        <MonoLabel className="text-acc-text">Team comments</MonoLabel>
        <span className="text-chip text-mute">{open ? `${open} open thread${open === 1 ? "" : "s"}` : "No open threads"}</span>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      <div className="flex flex-col">
        {state.targets.map((t) => (
          <TargetThreads
            key={`${t.type}:${t.id}`}
            target={t}
            comments={state.comments.filter((c) => c.targetType === t.type && c.targetId === t.id)}
            can={state.can}
            members={state.members}
            handles={handles}
            onPost={(body, parentId) => post("/api/workspace/comments", { targetType: t.type, targetId: t.id, body, parentId })}
            onResolve={(commentId, resolved) => post("/api/workspace/comments/resolve", { commentId, resolved })}
          />
        ))}
      </div>
      {!state.can.comment && <p className="m-0 text-chip text-mute">Viewers can read comments. Ask an admin for the member role to join in.</p>}
    </Panel>
  );
}

function TargetThreads({
  target,
  comments,
  can,
  members,
  handles,
  onPost,
  onResolve,
}: {
  target: State["targets"][number];
  comments: Comment[];
  can: State["can"];
  members: State["members"];
  handles: Set<string>;
  onPost: (body: string, parentId?: string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => Promise<boolean>;
}) {
  const roots = comments.filter((c) => !c.parentId);
  const open = roots.filter((r) => !r.resolved).length;
  // Starts open when there is something to read; afterwards only the reader opens or closes it.
  const [expanded, setExpanded] = useState(open > 0);
  return (
    <details
      className="group border-b border-line py-3"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
      data-target={target.type}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 text-body font-medium marker:hidden">
        <span className="inline-block font-mono text-acc-text transition-transform group-open:rotate-45">+</span>
        <span className="flex-1">{target.label}</span>
        {roots.length > 0 && <span className="text-chip font-normal text-mute">{open ? `${open} open` : `${roots.length} resolved`}</span>}
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        {roots.map((root) => (
          <Thread
            key={root.id}
            root={root}
            replies={comments.filter((c) => c.parentId === root.id)}
            can={can}
            members={members}
            handles={handles}
            onReply={(body) => onPost(body, root.id)}
            onResolve={(resolved) => onResolve(root.id, resolved)}
          />
        ))}
        {can.comment && <Composer members={members} placeholder={`Comment on ${target.label.toLowerCase()}…`} button="Comment" onSubmit={(body) => onPost(body)} />}
      </div>
    </details>
  );
}

function Thread({
  root,
  replies,
  can,
  members,
  handles,
  onReply,
  onResolve,
}: {
  root: Comment;
  replies: Comment[];
  can: State["can"];
  members: State["members"];
  handles: Set<string>;
  onReply: (body: string) => Promise<boolean>;
  onResolve: (resolved: boolean) => Promise<boolean>;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <div className={cx("flex flex-col gap-2 rounded-md border-th border-line bg-bg p-3", root.resolved && "opacity-70")} data-thread>
      {[root, ...replies].map((c, i) => (
        <div key={c.id} className={cx("flex flex-col gap-0.5", i > 0 && "border-l-2 border-line pl-3")}>
          <div className="flex flex-wrap items-baseline gap-2 text-chip">
            <span className="font-medium text-ink">{c.author}</span>
            <span className="text-mute">{when(c.createdAt)}</span>
          </div>
          <p className="m-0 whitespace-pre-line text-body [overflow-wrap:anywhere]">
            {splitMentions(c.body, handles).map((p, k) =>
              p.mention ? (
                <span key={k} className="font-medium text-acc-text">
                  {p.text}
                </span>
              ) : (
                p.text
              ),
            )}
          </p>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {root.resolved && <OutlineChip>Resolved</OutlineChip>}
        {can.comment && !root.resolved && !replying && (
          <Button onClick={() => setReplying(true)}>Reply</Button>
        )}
        {can.resolve && (
          <Button onClick={() => onResolve(!root.resolved)}>{root.resolved ? "Reopen" : "Resolve"}</Button>
        )}
      </div>
      {replying && (
        <Composer
          members={members}
          placeholder="Reply…"
          button="Reply"
          autoFocus
          onSubmit={async (body) => {
            const ok = await onReply(body);
            if (ok) setReplying(false);
            return ok;
          }}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  );
}

function Composer({
  members,
  placeholder,
  button,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  members: State["members"];
  placeholder: string;
  button: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const mentionable = useMemo(() => members.slice(0, 8), [members]);
  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(body);
    setBusy(false);
    if (ok) setBody("");
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
        placeholder={placeholder}
        aria-label={placeholder.replace("…", "")}
        maxLength={2000}
        rows={2}
        autoFocus={autoFocus}
        className={cx(FIELD, "min-h-[64px] resize-y")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={send}>
          {button}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        {mentionable.length > 1 && <span className="text-chip text-mute">Mention:</span>}
        {mentionable.length > 1 &&
          mentionable.map((m) => (
            <Chip key={m.handle} label={`@${m.handle}`} onClick={() => setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${m.handle} `)} />
          ))}
      </div>
    </div>
  );
}
