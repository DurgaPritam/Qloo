import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppHeader, Banner, MonoLabel, Page, Panel, Skeleton } from "@/components/ui";

import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe · Takeover", robots: { index: false } };

/**
 * From the digest's link. Opening the page changes nothing (mail scanners open links); the
 * button does. No sign-in: the link's signed token says who and which workspace.
 */
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  if (sp.done === "1") return <Banner tone="info">You are unsubscribed. No more Market watch digests from this workspace. You can turn it back on in Market watch.</Banner>;
  if (sp.invalid === "1" || !token) return <Banner tone="err">That unsubscribe link is not valid. Turn the digest off in Market watch instead.</Banner>;
  return (
    <Panel>
      <MonoLabel>Weekly digest</MonoLabel>
      <p className="m-0 text-body">Stop the Market watch digest from this workspace? You can turn it back on any time.</p>
      <form action={unsubscribeAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="min-h-[44px] cursor-pointer rounded-btn bg-acc px-4 font-body text-chip font-medium text-on-acc border-card border-ink">
          Unsubscribe
        </button>
      </form>
    </Panel>
  );
}

export default function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe/digest">) {
  return (
    <Page>
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Market watch</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Unsubscribe</h1>
      </section>
      <Suspense fallback={<Skeleton className="h-[120px] w-full rounded-lg" />}>
        <Content searchParams={searchParams} />
      </Suspense>
      <Link href="/" className="text-chip text-mute">
        ← Takeover
      </Link>
    </Page>
  );
}
