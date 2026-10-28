"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";

import { mailto } from "@/components/run/format";
import { OUTREACH_STAGES, STAGE_LABEL, type OutreachKind, type OutreachStage } from "@/lib/pipeline/stages";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, DataTable, MonoLabel, Panel, Segmented, useCopy, YourDataBadge } from "../ui";
import { Composer, Thread, type Comment } from "./plan-comments";
import { initials } from "./shell";

/**
 * The outreach pipeline (design: Pipeline). Cards move by drag and drop or by their Move select.
 * Takeover never sends: the user sends from their own email, then marks the card sent.
 */
export interface CardView {
  id: string;
  kind: OutreachKind;
  context: string;
  recipient: string;
  recipientEmail: string | null;
  subject: string;
  body: string;
  stage: OutreachStage;
  owner: string | null;
  ownerId: string | null;
  planId: string | null;
  movedAt: string;
  contactName: string | null;
  /** YYYY-MM-DD, set by the user. */
  dueDate: string | null;
  notes: string | null;
  /** The hash of the draft as shown; marking it sent sends this back. */
  hash: string;
}

interface EventView {
  id: string;
  toStage: OutreachStage;
  fromStage: OutreachStage | null;
  at: string;
  actor: string | null;
  actorEmail: string | null;
  sent: {
    recipient: string;
    recipientEmail: string | null;
    subject: string;
  } | null;
}

export interface Member {
  userId: string;
  name: string;
  handle: string | null;
}

const KIND_LABEL: Record<OutreachKind, string> = {
  partner: "Partner",
  venue: "Venue",
  sponsor: "Sponsor",
};
const EMPTY: Record<OutreachStage, string> = {
  drafted: "Drafts from plans land here.",
  sent: "Nothing sent yet.",
  replied: "No replies yet.",
  negotiating: "Nothing in negotiation.",
  booked: "No bookings yet.",
  lost: "Nothing lost. Good.",
};
const LAST: Record<OutreachStage, string> = {
  drafted: "Draft ready",
  sent: "Sent",
  replied: "Replied",
  negotiating: "Negotiating since",
  booked: "Booked",
  lost: "Closed",
};

/** Day and month in UTC, so the server and the browser render the same text. */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Overdue: past its due date (the workspace's local date) and still open. */
const overdue = (c: CardView, today: string) => Boolean(c.dueDate && c.dueDate < today && c.stage !== "booked" && c.stage !== "lost");

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (res?.ok) return null;
  return ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work.";
}

export function PipelineBoard({
  initial,
  canEdit,
  openId,
  members,
  me,
  today,
  remindersOn,
}: {
  initial: CardView[];
  canEdit: boolean;
  openId?: string;
  members: Member[];
  me: string;
  /** The workspace's local date, from the server. */
  today: string;
  remindersOn: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [view, setView] = useState<"board" | "list">("board");
  const [owner, setOwner] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<"all" | OutreachStage>("all");
  const [kindFilter, setKindFilter] = useState<"all" | OutreachKind>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [emails, setEmails] = useState(remindersOn);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<OutreachStage | null>(null);
  const [open, setOpen] = useState<string | null>(openId && initial.some((c) => c.id === openId) ? openId : null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const res = await fetch("/api/workspace/pipeline").catch(() => null);
    if (res?.ok)
      setCards(
        ((await res.json()) as { cards: CardView[] }).cards.map((c) => ({
          ...c,
          movedAt: String(c.movedAt),
        })),
      );
  };

  const move = async (id: string, stage: OutreachStage) => {
    const card = cards.find((c) => c.id === id);
    setDragging(null);
    setOver(null);
    if (!card || card.stage === stage) return;
    setError(null);
    setCards((all) => all.map((c) => (c.id === id ? { ...c, stage, movedAt: new Date().toISOString() } : c)));
    const err = await call(`/api/workspace/pipeline/${id}`, "PATCH", {
      stage,
      seenHash: card.hash,
    });
    if (err) setError(err);
    await reload();
  };

  const n = (s: OutreachStage) => cards.filter((c) => c.stage === s).length;
  const selected = cards.find((c) => c.id === open) ?? null;
  // The owner filter applies to both views; the list adds stage, kind and overdue filters.
  const mine = cards.filter((c) => owner === "all" || c.ownerId === owner);
  const listed = mine.filter((c) => (stageFilter === "all" || c.stage === stageFilter) && (kindFilter === "all" || c.kind === kindFilter) && (!overdueOnly || overdue(c, today)));
  const late = cards.filter((c) => overdue(c, today) && c.ownerId === me).length;
  const toggleEmails = async () => {
    const next = !emails;
    setEmails(next);
    const err = await call("/api/workspace/pipeline/reminders", "POST", { enabled: next });
    if (err) {
      setEmails(!next);
      setError(err);
    }
  };

  if (cards.length === 0) {
    return (
      <>
        <MonoLabel>Pipeline</MonoLabel>
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-panel py-12 sm:px-12">
          <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Nothing in the pipeline</h2>
          <p className="m-0 max-w-[400px] text-body text-mute">Track a plan from first outreach to a confirmed date. Move a plan here from its brief.</p>
          <Link href="/workspace" className="rounded-btn bg-acc px-4 py-2.5 font-semibold text-on-acc no-underline hover:text-on-acc">
            Go to plans
          </Link>
        </section>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <section className="flex flex-col gap-1.5">
          <MonoLabel>Pipeline</MonoLabel>
          <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Outreach</h1>
          <p className="tabular m-0 text-chip text-mute" data-summary>
            {cards.length} outreach · {n("booked")} booked · {n("lost")} lost
          </p>
        </section>
        <p className="m-0 text-chip text-mute">Drag a card, or use its menu, to move it. Takeover never sends email.</p>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      {late > 0 && <Banner tone="warn">{`${late} of your cards ${late === 1 ? "is" : "are"} past the follow-up date you set.`}</Banner>}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          options={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
          value={view}
          onChange={setView}
        />
        <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(FIELD, "cursor-pointer py-1.5 text-chip")}>
          <option value="all">Everyone&apos;s cards</option>
          <option value={me}>My cards</option>
          {members
            .filter((m) => m.userId !== me)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </select>
        <span className="flex-1" />
        <label className="flex items-center gap-2.5 text-chip">
          <span>Email me when my cards are overdue</span>
          <button
            type="button"
            role="switch"
            aria-checked={emails}
            aria-label="Email me when my cards are overdue"
            onClick={() => void toggleEmails()}
            className={cx("relative h-6 w-10 cursor-pointer rounded-pill border-0 transition-colors", emails ? "bg-acc" : "bg-track")}
          >
            <span className={cx("absolute top-[3px] h-[18px] w-[18px] rounded-pill transition-[left]", emails ? "left-[19px] bg-on-acc" : "left-[3px] bg-mute")} />
          </button>
        </label>
      </div>

      {view === "list" ? (
        <section className="flex flex-col gap-2" aria-label="Outreach list">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Stage filter"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}
              className={cx(FIELD, "cursor-pointer py-1.5 text-chip")}
            >
              <option value="all">Every stage</option>
              {OUTREACH_STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]}
                </option>
              ))}
            </select>
            <select
              aria-label="Kind filter"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
              className={cx(FIELD, "cursor-pointer py-1.5 text-chip")}
            >
              <option value="all">Every kind</option>
              {(Object.keys(KIND_LABEL) as OutreachKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-chip">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="accent-acc-line" />
              Overdue only
            </label>
            <span className="tabular font-mono text-chip text-mute">{listed.length} shown</span>
          </div>
          <DataTable
            columns={["To", "Kind", "Stage", "Owner", "Due", "Last move"]}
            template="minmax(0,2fr) minmax(70px,auto) minmax(90px,auto) minmax(0,1fr) minmax(96px,auto) minmax(96px,auto)"
            rows={listed.map((c) => [
              <button
                key="t"
                type="button"
                onClick={() => setOpen(c.id)}
                className="cursor-pointer border-0 bg-transparent p-0 text-left font-body text-body text-ink underline-offset-2 hover:underline"
                data-row={c.recipient}
              >
                {c.contactName ? `${c.contactName} · ${c.recipient}` : c.recipient}
              </button>,
              <span key="k" className="text-chip">
                {KIND_LABEL[c.kind]}
              </span>,
              <span key="s" className="text-chip">
                {STAGE_LABEL[c.stage]}
              </span>,
              <span key="o" className="text-chip [overflow-wrap:anywhere]">
                {c.owner ?? "Nobody"}
              </span>,
              <span key="d" className={cx("tabular font-mono text-chip", overdue(c, today) ? "text-warn" : "text-mute")}>
                {c.dueDate ? `${c.dueDate}${overdue(c, today) ? " · overdue" : ""}` : "—"}
              </span>,
              <span key="m" className="tabular font-mono text-chip text-mute">
                {day(c.movedAt)}
              </span>,
            ])}
          />
        </section>
      ) : (
        <div className="-mx-panel overflow-x-auto px-panel pb-2">
          <div className="grid min-w-min gap-2 [grid-template-columns:repeat(6,minmax(232px,1fr))]">
            {OUTREACH_STAGES.map((stage) => {
              const list = mine.filter((c) => c.stage === stage);
              const hot = over === stage && dragging !== null;
              return (
                <section
                  key={stage}
                  aria-label={STAGE_LABEL[stage]}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    if (over !== stage) setOver(stage);
                  }}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragging;
                    if (id) void move(id, stage);
                  }}
                  className={cx(
                    "flex min-h-[320px] flex-col gap-2 rounded-[14px] border-th p-2.5 transition-colors",
                    hot ? "border-dashed border-acc-line bg-acc-soft" : "border-transparent bg-track",
                  )}
                >
                  <div className="flex items-center justify-between px-1.5 py-1">
                    <span className={cx("font-mono text-label uppercase tracking-[0.08em]", stage === "booked" ? "text-acc-text" : stage === "lost" ? "text-mute" : "text-ink")}>
                      {STAGE_LABEL[stage]}
                    </span>
                    <span className="tabular font-mono text-[11px] text-mute">{list.length}</span>
                  </div>
                  {list.map((c) => (
                    <article
                      key={c.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(c.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      data-card={c.recipient}
                      className={cx(
                        "flex flex-col gap-2 rounded-md border-card border-ink bg-surf p-3 shadow-card",
                        canEdit && "cursor-grab",
                        dragging === c.id && "opacity-40",
                        open === c.id && "ring-2 ring-acc-line",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-label uppercase tracking-[0.06em] text-acc-text">{KIND_LABEL[c.kind]}</span>
                        <span className="flex-1" />
                        <span
                          title={c.owner ?? undefined}
                          className="flex h-[22px] w-[22px] items-center justify-center rounded-pill bg-acc-soft font-mono text-[9.5px] text-acc-text"
                        >
                          {initials(c.owner ?? "")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpen(open === c.id ? null : c.id)}
                        className="flex cursor-pointer flex-col gap-0.5 border-0 bg-transparent p-0 text-left text-ink"
                      >
                        <span className="font-semibold leading-[1.3]">{c.recipient}</span>
                        <span className="text-chip leading-[1.4] text-mute">{c.context}</span>
                      </button>
                      <div className="flex items-center gap-2 border-t border-line pt-1.5">
                        <span className={cx("min-w-0 flex-1 truncate font-mono text-label", overdue(c, today) ? "text-warn" : "text-mute")} data-due={c.dueDate ?? undefined}>
                          {overdue(c, today)
                            ? `Overdue · due ${c.dueDate}`
                            : c.dueDate && c.stage !== "booked" && c.stage !== "lost"
                              ? `Due ${c.dueDate}`
                              : `${LAST[c.stage]} · ${day(c.movedAt)}`}
                        </span>
                        <select
                          value={c.stage}
                          disabled={!canEdit}
                          onChange={(e) => void move(c.id, e.target.value as OutreachStage)}
                          aria-label={`Move ${c.recipient}`}
                          className="min-h-8 max-w-[8.5em] cursor-pointer rounded-badge border-th border-line bg-bg px-1.5 py-1 font-body text-chip text-ink"
                        >
                          {OUTREACH_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}
                  {list.length === 0 && <div className="px-1.5 py-3.5 text-center text-chip text-mute">{EMPTY[stage]}</div>}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <CardDetail
          key={`${selected.id}:${selected.hash}:${selected.stage}`}
          card={selected}
          canEdit={canEdit}
          members={members}
          today={today}
          onChanged={reload}
          onMove={(s) => move(selected.id, s)}
          onClose={() => setOpen(null)}
          onRemoved={() => {
            setOpen(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function CardDetail({
  card,
  canEdit,
  members,
  today,
  onChanged,
  onMove,
  onClose,
  onRemoved,
}: {
  card: CardView;
  canEdit: boolean;
  members: Member[];
  today: string;
  onChanged: () => Promise<void>;
  onMove: (s: OutreachStage) => Promise<void>;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [draft, setDraft] = useState({
    recipient: card.recipient,
    recipientEmail: card.recipientEmail ?? "",
    subject: card.subject,
    body: card.body,
  });
  const [track, setTrack] = useState({ contactName: card.contactName ?? "", dueDate: card.dueDate ?? "", notes: card.notes ?? "" });
  const trackDirty = track.contactName !== (card.contactName ?? "") || track.dueDate !== (card.dueDate ?? "") || track.notes !== (card.notes ?? "");
  const [comments, setComments] = useState<Comment[]>([]);
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const editable = canEdit && card.stage === "drafted";
  const dirty = draft.recipient !== card.recipient || draft.recipientEmail !== (card.recipientEmail ?? "") || draft.subject !== card.subject || draft.body !== card.body;

  type Raw = {
    id: string;
    parentId: string | null;
    body: string;
    author: string | null;
    authorEmail: string | null;
    authorId: string | null;
    resolvedAt: string | null;
    createdAt: string;
  };
  const load = useCallback(async () => {
    const d = (await fetch(`/api/workspace/pipeline/${card.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { events: EventView[]; comments: Raw[] } | null;
    setEvents(d?.events ?? []);
    setComments(
      (d?.comments ?? []).map((c) => ({
        id: c.id,
        targetType: "outreach",
        targetId: card.id,
        parentId: c.parentId,
        body: c.body,
        author: c.author ?? c.authorEmail ?? "Someone",
        mine: false,
        resolved: Boolean(c.resolvedAt),
        createdAt: c.createdAt,
      })),
    );
  }, [card.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the card's history and comments
    void load();
  }, [load, card.stage, card.hash]);
  const mentionable = useMemo(() => members.filter((m) => m.handle).map((m) => ({ handle: m.handle!, name: m.name })), [members]);
  const handles = useMemo(() => new Set(mentionable.map((m) => m.handle)), [mentionable]);
  const postComment = async (body: string, parentId?: string) => {
    const err = await call(`/api/workspace/pipeline/${card.id}/comments`, "POST", { body, parentId });
    if (err) {
      setError(err);
      return false;
    }
    await load();
    return true;
  };
  const roots = comments.filter((c) => !c.parentId);

  const save = async () => {
    setBusy(true);
    setError(await call(`/api/workspace/pipeline/${card.id}`, "PATCH", { draft }));
    setBusy(false);
    await onChanged();
  };

  const to = card.recipientEmail ? `mailto:${encodeURIComponent(card.recipientEmail)}` : "mailto:";
  const link = to + mailto(card.subject, card.body).slice("mailto:".length);

  return (
    <div aria-label={`Outreach to ${card.recipient}`} role="region">
      <Panel className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <MonoLabel>
              {KIND_LABEL[card.kind]} · {STAGE_LABEL[card.stage]}
            </MonoLabel>
            <h2 className="m-0 text-[17px] font-semibold">{card.recipient}</h2>
            <span className="text-chip text-mute">
              {card.context}
              {card.planId && (
                <>
                  {" · "}
                  <a href={`/plan/${card.planId}`}>Open the plan</a>
                </>
              )}
            </span>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
        {error && <Banner tone="err">{error}</Banner>}

        {editable ? (
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-1.5">
              <MonoLabel>To</MonoLabel>
              <input value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} maxLength={200} aria-label="Recipient" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2">
                <MonoLabel>Email address</MonoLabel>
                <YourDataBadge />
              </span>
              <input
                type="email"
                value={draft.recipientEmail}
                onChange={(e) => setDraft({ ...draft, recipientEmail: e.target.value })}
                maxLength={200}
                placeholder="Optional: who you will send it to"
                aria-label="Email address"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <MonoLabel>Subject</MonoLabel>
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={300} aria-label="Subject" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <MonoLabel>Body</MonoLabel>
              <textarea rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} maxLength={10_000} aria-label="Body" className={FIELD} />
            </label>
            <div>
              <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
                Save draft
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border-th border-line p-3">
            <div className="font-mono text-[11px]">
              <span className="text-mute">To </span>
              {card.recipient}
              {card.recipientEmail && <span className="text-mute"> · {card.recipientEmail}</span>}
            </div>
            <div className="font-mono text-[11px]">
              <span className="text-mute">Subject </span>
              {card.subject}
            </div>
            <p className="m-0 whitespace-pre-line text-body">{card.body}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => copy(card.id, `To: ${card.recipient}${card.recipientEmail ? ` <${card.recipientEmail}>` : ""}\nSubject: ${card.subject}\n\n${card.body}`)}>
            {copied === card.id ? "Copied" : "Copy"}
          </Button>
          <a href={link} className="rounded-btn border-th border-line px-3 py-1.5 text-chip text-ink no-underline hover:bg-acc-soft">
            Open in mail
          </a>
          {canEdit && card.stage === "drafted" && (
            <Button variant="primary" disabled={dirty} onClick={() => void onMove("sent")}>
              I sent it
            </Button>
          )}
          {canEdit && (
            <Button
              onClick={async () => {
                setError(await call(`/api/workspace/pipeline/${card.id}`, "DELETE"));
                onRemoved();
              }}
            >
              Remove card
            </Button>
          )}
        </div>
        <p className="m-0 text-chip text-mute">
          {dirty
            ? "Save the draft before marking it sent."
            : "Takeover never sends email. Send it from your own email, then mark it sent here; the team sees exactly what went out."}
        </p>

        <section className="flex flex-col gap-2.5 border-t border-line pt-3" aria-label="Tracking">
          <div className="flex flex-wrap items-center gap-2">
            <MonoLabel>Tracking</MonoLabel>
            <YourDataBadge />
          </div>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
            <label className="flex flex-col gap-1.5">
              <span className="text-chip">Contact name</span>
              <input
                value={track.contactName}
                disabled={!canEdit}
                onChange={(e) => setTrack({ ...track, contactName: e.target.value })}
                maxLength={120}
                aria-label="Contact name"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-chip">Follow up by</span>
              <input
                type="date"
                value={track.dueDate}
                disabled={!canEdit}
                onChange={(e) => setTrack({ ...track, dueDate: e.target.value })}
                aria-label="Follow up by"
                className={FIELD}
              />
              {card.dueDate && overdue(card, today) && <span className="text-chip text-warn">Overdue: the owner has been reminded.</span>}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-chip">Owner</span>
              <select
                value={card.ownerId ?? ""}
                disabled={!canEdit}
                onChange={async (e) => {
                  setError(await call(`/api/workspace/pipeline/${card.id}`, "PATCH", { ownerId: e.target.value }));
                  await onChanged();
                }}
                aria-label="Owner"
                className={cx(FIELD, "cursor-pointer")}
              >
                {!card.ownerId && <option value="">Nobody</option>}
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-chip">Notes</span>
            <textarea
              rows={3}
              value={track.notes}
              disabled={!canEdit}
              onChange={(e) => setTrack({ ...track, notes: e.target.value })}
              maxLength={4000}
              aria-label="Notes"
              className={FIELD}
            />
          </label>
          {canEdit && (
            <div>
              <Button
                disabled={!trackDirty}
                onClick={async () => {
                  setError(await call(`/api/workspace/pipeline/${card.id}`, "PATCH", { track }));
                  await onChanged();
                }}
              >
                Save tracking
              </Button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-line pt-3" aria-label="Comments">
          <MonoLabel>Comments · {comments.length}</MonoLabel>
          {roots.map((r) => (
            <Thread
              key={r.id}
              root={r}
              replies={comments.filter((c) => c.parentId === r.id)}
              can={{ comment: canEdit, resolve: false }}
              members={mentionable}
              handles={handles}
              onReply={(body) => postComment(body, r.id)}
              onResolve={async () => false}
            />
          ))}
          {canEdit && <Composer members={mentionable} placeholder="Comment on this card…" button="Comment" onSubmit={(body) => postComment(body)} />}
        </section>

        <MonoLabel>History</MonoLabel>
        {events === null ? (
          <span className="text-chip text-mute">Loading…</span>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="History">
            {events.map((e) => (
              <li key={e.id} className="text-chip">
                <span className="font-mono text-mute">{day(e.at)} · </span>
                {e.actor ?? e.actorEmail ?? "Someone"}{" "}
                {e.fromStage === null ? "added it as a draft" : e.toStage === "sent" ? "marked it sent" : `moved it to ${STAGE_LABEL[e.toStage]}`}
                {e.sent && (
                  <span className="text-mute">
                    {" "}
                    · “{e.sent.subject}” to {e.sent.recipientEmail ?? e.sent.recipient}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
