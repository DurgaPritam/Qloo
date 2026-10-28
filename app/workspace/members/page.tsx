import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { Members } from "@/components/workspace/members";
import { assignableRoles, can, canManage } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";

export const metadata: Metadata = { title: "Members · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/members");
  const { ctx, repo } = found;
  const canInvite = can(ctx.role, "member.invite");
  const [members, invites] = await Promise.all([repo.members.list(), canInvite ? repo.invitations.listPending() : null]);
  const assignable = assignableRoles(ctx.role);

  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="Members" />
      <Members
        members={members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          you: m.userId === ctx.userId,
          assignable: canManage(ctx.role, m.role) ? assignable : [],
          removable: canManage(ctx.role, m.role),
        }))}
        invites={invites?.map((i) => ({ id: i.id, email: i.email, role: i.role, expires: i.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) })) ?? null}
        inviteRoles={assignable.filter((r) => r !== "owner")}
      />
    </>
  );
}

export default function MembersPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
