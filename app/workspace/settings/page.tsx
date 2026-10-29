import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import Link from "next/link";

import { Banner, DataTable, MonoLabel, Skeleton } from "@/components/ui";
import { WorkspaceSettings } from "@/components/workspace/settings";
import { can } from "@/lib/workspace/permissions";
import { ENGINE_CONFIG } from "@/lib/engine/config";
import { CURRENCIES } from "@/lib/workspace/currency";
import { currentWorkspace } from "@/lib/workspace/session";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";

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
  "roster.created": "created a roster",
  "roster.deleted": "deleted a roster",
  "roster.acts_added": "added acts to a roster",
  "data.uploaded": "uploaded data",
  "data.attached": "attached data to a fanbase",
  "data.deleted": "deleted data and its file",
  "branding.saved": "changed the deck branding",
  "branding.reset": "reset the deck branding",
  "workspace.settings": "changed the workspace settings",
  "watch.added": "started watching",
  "sponsor.shortlisted": "shortlisted a sponsor match",
  "outcome.logged": "logged event results",
  "outreach.added": "added outreach to the pipeline",
  "outreach.moved": "moved outreach",
  "outreach.sent": "marked outreach sent",
  "tour.saved": "saved a tour",
  "brief.created": "made a campaign brief",
  "api.key_created": "created an API key",
  "api.key_revoked": "revoked an API key",
  "outreach.assigned": "reassigned outreach",
};

function detail(action: string, d: Record<string, string | number | boolean | null> | null): string {
  if (!d) return "";
  if (action === "roster.acts_added" && typeof d.count === "number") return `${d.count} act${d.count === 1 ? "" : "s"}`;
  if (action === "data.attached") return typeof d.entity === "string" ? d.entity : "detached";
  if (action === "outreach.added" && typeof d.cards === "number") return `${d.cards} draft${d.cards === 1 ? "" : "s"}`;
  if (action === "sponsor.shortlisted" && typeof d.holder === "string") return `${d.holder} × ${d.brand}`;
  if (action === "workspace.settings") return [d.timeZone, d.currency, typeof d.minSample === "number" ? `${d.minSample} events` : null].filter(Boolean).join(" · ");
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
  const [activity, members, ws] = await Promise.all([repo.activity.list(40), repo.members.list(), repo.workspace.get()]);
  const lastOwner = ctx.role === "owner" && members.filter((m) => m.role === "owner").length === 1;

  return (
    <>
      <SettingsTabs />
      <PageTitle label={current.name} title="Settings" />
      <WorkspaceSettings
        name={current.name}
        canRename={can(ctx.role, "workspace.rename")}
        canLeave={!current.personal && !lastOwner}
        settings={{ timeZone: ws?.timeZone ?? null, currency: ws?.currency ?? null, outcomeMinSample: ws?.outcomeMinSample ?? null }}
        canEditSettings={can(ctx.role, "workspace.settings")}
        timeZones={Intl.supportedValuesOf("timeZone")}
        currencies={CURRENCIES}
        defaultMinSample={ENGINE_CONFIG.outcomes.minSample}
      />
      <Banner tone="neutral" action={<Link href="/workspace/settings/branding">Branded decks →</Link>}>
        Your logo, colours and headline font on every deck this workspace exports.
      </Banner>
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
              {detail(a.action, a.detail) ? <span className="text-mute"> · {detail(a.action, a.detail)}</span> : null}
            </span>,
          ])}
        />
      </section>
    </>
  );
}

export default function SettingsPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
