/**
 * @mentions use a member's handle: the part of their email before the @, lower-cased. When two
 * members share it, both get the first label of their email domain appended (alex.acme, alex.gmail).
 */

export interface Mentionable {
  userId: string;
  email: string | null;
  name: string | null;
}

const local = (email: string) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
const domainLabel = (email: string) => (email.split("@")[1] ?? "").split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");

/** userId → handle, unique within the given members. */
export function handlesFor(members: readonly Mentionable[]): Map<string, string> {
  const withEmail = members.filter((m): m is Mentionable & { email: string } => Boolean(m.email));
  const counts = new Map<string, number>();
  for (const m of withEmail) counts.set(local(m.email), (counts.get(local(m.email)) ?? 0) + 1);
  return new Map(
    withEmail.map((m) => {
      const base = local(m.email);
      return [m.userId, (counts.get(base) ?? 0) > 1 ? `${base}.${domainLabel(m.email)}` : base];
    }),
  );
}

const MENTION = /(^|[^\w@])@([a-z0-9][a-z0-9._-]*)/gi;

/** The members a comment mentions, by handle; unknown handles are ignored. */
export function mentionedUserIds(body: string, members: readonly Mentionable[]): string[] {
  const byHandle = new Map([...handlesFor(members)].map(([id, h]) => [h, id]));
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    // A trailing full stop ends the sentence, not the handle.
    const id = byHandle.get(m[2].toLowerCase().replace(/\.+$/, ""));
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Splits a comment into text and mention parts for display; only real handles are marked. */
export function splitMentions(body: string, handles: ReadonlySet<string>): { text: string; mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    const handle = m[2].replace(/\.+$/, "");
    if (!handles.has(handle.toLowerCase())) continue;
    const start = m.index! + m[1].length;
    if (start > last) parts.push({ text: body.slice(last, start), mention: false });
    parts.push({ text: `@${handle}`, mention: true });
    last = start + 1 + handle.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}
