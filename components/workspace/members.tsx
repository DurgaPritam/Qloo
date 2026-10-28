"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Role } from "@/lib/db/schema";
import { ROLE_LABEL } from "@/lib/workspace/permissions";

import { FIELD } from "../account/fields";
import { Banner, Button, DataTable, MonoLabel, OutlineChip, Panel } from "../ui";

export interface MemberRow {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
  you: boolean;
  /** Roles the viewer may move this member to; empty when they can't manage them. */
  assignable: Role[];
  removable: boolean;
}

export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expires: string;
}

const SELECT = "cursor-pointer rounded-btn border-th border-line bg-bg px-2 py-1 font-body text-chip text-ink";

async function post(url: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  return ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";
}

export function Members({ members, invites, inviteRoles }: { members: MemberRow[]; invites: InviteRow[] | null; inviteRoles: Role[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(inviteRoles.includes("member") ? "member" : (inviteRoles[0] ?? "member"));
  const [busy, setBusy] = useState(false);

  const run = async (url: string, body: Record<string, unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    const err = await post(url, body);
    if (err) {
      setError(err);
      return false;
    }
    if (done) setNotice(done);
    router.refresh();
    return true;
  };

  const invite = async () => {
    setBusy(true);
    const ok = await run("/api/workspace/invitations", { email, role }, `Invitation sent to ${email.trim()}.`);
    setBusy(false);
    if (ok) setEmail("");
  };

  return (
    <>
      {error && <Banner tone="err">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      {invites && (
        <Panel>
          <MonoLabel className="text-acc-text">Invite someone</MonoLabel>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              aria-label="Email to invite"
              className={`${FIELD} min-w-0 flex-1 basis-[220px]`}
            />
            <select aria-label="Role for the invitation" value={role} onChange={(e) => setRole(e.target.value as Role)} className={SELECT}>
              {inviteRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" loading={busy}>
              Send invite
            </Button>
          </form>
          <p className="m-0 text-chip text-mute">
            They get an email with a link that works for 7 days. Viewers read; members plan and comment; admins also manage people.
          </p>
        </Panel>
      )}

      <section className="flex flex-col gap-2">
        <MonoLabel>Members · {members.length}</MonoLabel>
        <DataTable
          columns={["Person", "Role", ""]}
          template="minmax(0,2fr) minmax(110px,1fr) minmax(90px,auto)"
          rows={members.map((m) => [
            <span key="p" className="flex min-w-0 flex-col">
              <span className="font-medium [overflow-wrap:anywhere]">
                {m.name ?? m.email}
                {m.you ? " (you)" : ""}
              </span>
              {m.name && <span className="text-chip text-mute [overflow-wrap:anywhere]">{m.email}</span>}
            </span>,
            m.assignable.length ? (
              <select
                key="r"
                aria-label={`Role for ${m.email}`}
                value={m.role}
                onChange={(e) => run("/api/workspace/members", { action: "role", userId: m.userId, role: e.target.value })}
                className={SELECT}
              >
                {[...new Set([m.role, ...m.assignable])].map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            ) : (
              <OutlineChip key="r">{ROLE_LABEL[m.role]}</OutlineChip>
            ),
            m.removable && !m.you ? (
              <Button key="x" onClick={() => run("/api/workspace/members", { action: "remove", userId: m.userId }, `Removed ${m.email}.`)}>
                Remove
              </Button>
            ) : (
              <span key="x" />
            ),
          ])}
        />
      </section>

      {invites && invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <MonoLabel>Pending invitations · {invites.length}</MonoLabel>
          <DataTable
            columns={["Email", "Role", ""]}
            template="minmax(0,2fr) minmax(110px,1fr) minmax(90px,auto)"
            rows={invites.map((i) => [
              <span key="e" className="[overflow-wrap:anywhere]">
                {i.email}
                <span className="block text-chip text-mute">Expires {i.expires}</span>
              </span>,
              <OutlineChip key="r">{ROLE_LABEL[i.role]}</OutlineChip>,
              <Button key="x" onClick={() => run("/api/workspace/invitations", { action: "revoke", id: i.id }, `Cancelled the invitation to ${i.email}.`)}>
                Cancel
              </Button>,
            ])}
          />
        </section>
      )}
    </>
  );
}
