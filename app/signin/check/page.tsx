import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { AppHeader, Banner, MonoLabel, Page, Panel } from "@/components/ui";
import { outboxEnabled } from "@/lib/email/mailer";

export const metadata: Metadata = { title: "Check your email · Takeover" };

async function LocalOutbox() {
  await connection();
  if (!outboxEnabled()) return null;
  return (
    <Banner tone="info" action={<Link href="/dev/outbox">Open the outbox →</Link>}>
      Local mode: no email service is set up, so the link is in this site&apos;s outbox instead.
    </Banner>
  );
}

export default function CheckEmailPage() {
  return (
    <Page max="max-w-[560px]">
      <AppHeader />
      <Panel>
        <MonoLabel className="text-acc-text">Check your email</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(26px,4vw,36px)] leading-[0.95]">A sign-in link is on its way</h1>
        <p className="m-0 text-body text-mute [text-wrap:pretty]">
          Open it on this device. It works once and expires in an hour. Nothing arrived? Check spam, or{" "}
          <Link href="/signin">ask for another</Link>.
        </p>
        <Suspense fallback={null}>
          <LocalOutbox />
        </Suspense>
      </Panel>
    </Page>
  );
}
