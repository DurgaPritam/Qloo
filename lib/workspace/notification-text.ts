/** One line and one link per notification, shared by the bell and the inbox page. */
export function notificationView(n: {
  kind: "mention" | "overdue";
  planId: string | null;
  outreachId: string | null;
  actor: string | null;
  actorEmail: string | null;
  planInput: string | null;
  cardRecipient: string | null;
  cardDue: string | null;
}): { text: string; href: string } {
  const card = n.outreachId ? `/workspace/pipeline?card=${n.outreachId}` : null;
  if (n.kind === "overdue") return { text: `Follow up with ${n.cardRecipient ?? "a pipeline contact"}: due ${n.cardDue ?? "earlier"}`, href: card ?? "/workspace/pipeline" };
  const who = n.actor ?? n.actorEmail ?? "Someone";
  if (card) return { text: `${who} mentioned you on ${n.cardRecipient ?? "a pipeline card"}`, href: card };
  return { text: `${who} mentioned you${n.planInput ? ` on ${n.planInput}` : ""}`, href: n.planId ? `/plan/${n.planId}#comments` : "/workspace/inbox" };
}
