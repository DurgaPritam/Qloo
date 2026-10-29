import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Banner, Skeleton } from "@/components/ui";
import { BillingScreen, ContactForm, Invoices, UsagePanel } from "@/components/workspace/billing";
import { PageTitle, SettingsTabs } from "@/components/workspace/shell";
import { billingView, usageRows } from "@/lib/billing/view";
import { PLACEHOLDER_NOTE, TIERS } from "@/lib/entitlements";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Plans & billing · Takeover", robots: { index: false } };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function Content({ searchParams }: { searchParams: PageProps<"/workspace/settings/billing">["searchParams"] }) {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/settings/billing");
  const { repo, ctx, user, memberships } = found;
  const sp = await searchParams;
  const [view, usage] = await Promise.all([billingView(repo), usageRows(repo)]);
  const name = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "This workspace";
  const sub = view.subscription;
  const renews = sub?.currentPeriodEnd ? `${sub.cancelAtPeriodEnd ? "ends" : "renews"} ${day(sub.currentPeriodEnd)}` : null;
  return (
    <>
      <SettingsTabs />
      <PageTitle label="Settings" title="Plans & billing" sub={`${name} is on ${TIERS[view.tier].label}${renews ? ` · ${renews}` : ""}`} />
      {sp.checkout === "done" && <Banner tone="info">Thanks. Stripe is confirming the payment; the plan changes here as soon as it does, usually within a minute.</Banner>}
      {sp.checkout === "cancelled" && <Banner tone="neutral">Checkout was cancelled. Nothing was charged and the plan is unchanged.</Banner>}
      {sub?.paymentFailed && <Banner tone="err">Stripe couldn&apos;t take the last payment. Update the card in Manage billing; the plan stays on while Stripe retries.</Banner>}
      {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd && (
        <Banner tone="warn">The plan ends on {day(sub.currentPeriodEnd)}. After that the workspace is on Free and everything saved stays readable.</Banner>
      )}
      {view.notReady && <Banner tone="neutral">{view.notReady}</Banner>}
      <BillingScreen
        cards={view.cards}
        current={view.tier}
        canManage={view.canManage}
        notReady={view.notReady}
        preselect={typeof sp.tier === "string" ? sp.tier : null}
        seatsInUse={view.seatsInUse}
        subscribed={sub?.hasCustomer ? { interval: sub.interval } : null}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-[18px]">
        <UsagePanel rows={usage} />
        <Invoices
          invoices={(view.invoices ?? []).map((i) => ({ ...i, created: i.created.toISOString() }))}
          note={!view.canManage && !sub ? "Owners and admins see invoices." : view.invoices === null && sub?.hasCustomer ? "Stripe's invoices couldn't be loaded just now." : null}
        />
      </div>
      <ContactForm name={user.name ?? ""} email={user.email} />
      <p className="m-0 text-chip text-mute">{PLACEHOLDER_NOTE}</p>
    </>
  );
}

export default function BillingPage({ searchParams }: PageProps<"/workspace/settings/billing">) {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
