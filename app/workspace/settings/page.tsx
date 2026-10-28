import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppHeader, DataTable, MonoLabel, Page, Skeleton } from "@/components/ui";
import { WorkspaceSettings } from "@/components/workspace/settings";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { can, ROLE_LABEL } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Workspace settings · Takeover", robots: { index: false } };

const ACTIONS: Record<string, string> = {
  "workspace.created": "created the workspace",
  "workspace.renamed": "renamed the workspace",
  "member.invited": "sent an invitation",
  "member.invite_revoked": "cancelled an invitation",
  "member.joined": "joined",
  "member.role_changed": "changed a role",
  "member.removed": "removed a member",
  "member.left": "left",
  "plan.created": "added a plan",
  "plan.imported": "imported plans from a browser",
  "plan.visibility": "changed who can open a plan",
  "comment.created": "commented",
  "comment.resolved": "resolved a thread",
  "comment.reopened": "reopened a thread",
};

function detail(d: Record<string, string | number | boolean | null> | null): string {
  if (!d) return "";
  if (typeof d.email === "string") return `${d.email}${d.role ? ` as ${d.role}` : ""}`;
  if (typeof d.input === "string") return d.input;
  if (typeof d.visibility === "string") return d.visibility === "public" ? "anyone with the link" : "workspace only";
  if (typeof d.from === "string") return `${d.from} → ${d.to}`;
  if (typeof d.count === "number") return `${d.count} plan${d.count === 1 ? "" : "s"}`;
  if (typeof d.name === "string") return d.name;
  return "";
}

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings");
  const { ctx, repo, memberships } = found;
  const current = memberships.find((m) => m.workspaceId === ctx.workspaceId)!;
  const [activity, members] = await Promise.all([repo.activity.list(40), repo.members.list()]);
  const lastOwner = ctx.role === "owner" && members.filter((m) => m.role === "owner").length === 1;

  return (
    <>
      <WorkspaceTabs name={current.name} role={ROLE_LABEL[ctx.role]} />
      <WorkspaceSettings name={current.name} canRename={can(ctx.role, "workspace.rename")} canLeave={!current.personal && !lastOwner} />
      <section className="flex flex-col gap-2">
        <MonoLabel>Activity</MonoLabel>
        <DataTable
          columns={["When", "Who", "What"]}
          template="minmax(96px,auto) minmax(0,1fr) minmax(0,2fr)"
          rows={activity.map((a) => [
            <span key="w" className="tabular text-chip text-mute">
              {a.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>,
            <span key="p" className="[overflow-wrap:anywhere]">
              {a.actor ?? a.actorEmail ?? "Someone"}
            </span>,
            <span key="a" className="[overflow-wrap:anywhere]">
              {ACTIONS[a.action] ?? a.action}
              {detail(a.detail) ? <span className="text-mute"> · {detail(a.detail)}</span> : null}
            </span>,
          ])}
        />
      </section>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Page max="max-w-[880px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </Page>
  );
}
