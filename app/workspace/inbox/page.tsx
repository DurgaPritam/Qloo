import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Banner, MonoLabel, Skeleton } from "@/components/ui";
import { MarkInboxRead } from "@/components/workspace/settings";
import { currentWorkspace } from "@/lib/workspace/session";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";

export const metadata: Metadata = { title: "Inbox · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/inbox");
  const { repo } = found;
  const items = await repo.notifications.list();
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="Inbox" />
      <MarkInboxRead unread={unread} />
      {items.length === 0 ? (
        <Banner tone="neutral">No mentions yet. When someone writes @ and your handle in a comment, it shows up here.</Banner>
      ) : (
        <section className="flex flex-col">
          <MonoLabel>Mentions{unread ? ` · ${unread} new` : ""}</MonoLabel>
          {items.map((n) => (
            <Link
              key={n.id}
              href={n.planId ? `/plan/${n.planId}#comments` : "/workspace"}
              className={`flex flex-col gap-0.5 border-b border-line py-3 text-ink no-underline hover:bg-acc-soft ${n.readAt ? "" : "font-medium"}`}
            >
              <span className="text-chip text-mute">
                {n.actor ?? n.actorEmail ?? "Someone"} mentioned you{n.planInput ? ` on ${n.planInput}` : ""} ·{" "}
                {n.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              {n.body && <span className="text-body [overflow-wrap:anywhere]">{n.body.length > 200 ? `${n.body.slice(0, 199)}…` : n.body}</span>}
            </Link>
          ))}
        </section>
      )}
    </>
  );
}

export default function InboxPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
