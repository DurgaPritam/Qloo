import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MonoLabel, Skeleton } from "@/components/ui";
import { WatchScreen } from "@/components/workspace/watch";
import { watchView } from "@/lib/watch/service";
import { can } from "@/lib/workspace/permissions";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Market watch · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/watch");
  const { ctx, repo, user } = found;
  const [view, mine, recipients] = await Promise.all([watchView(repo), repo.digest.get(), repo.digest.recipients()]);
  return (
    <>
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Watchlists</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,44px)] leading-[0.92]">Market watch</h1>
        <p className="m-0 text-chip text-mute">Qloo affinity is re-checked every Monday. Changes are week over week.</p>
      </section>
      <WatchScreen
        initial={view}
        canEdit={can(ctx.role, "watch.edit")}
        me={{ email: user.email, digestOn: Boolean(mine?.enabled), theme: mine?.theme ?? "light" }}
        recipients={recipients.flatMap((r) => (r.email ? [r.email] : []))}
      />
    </>
  );
}

export default function WatchPage() {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
