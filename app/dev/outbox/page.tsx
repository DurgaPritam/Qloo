import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AppHeader, Banner, MonoLabel, Page, Panel, Skeleton } from "@/components/ui";
import { outboxEnabled, readOutbox } from "@/lib/email/mailer";

export const metadata: Metadata = { title: "Outbox (local) · Takeover", robots: { index: false } };

/** Local and e2e only: the emails this server would have sent. 404 on Vercel or with Resend set up. */
async function Messages() {
  await connection();
  if (!outboxEnabled()) notFound();
  const messages = readOutbox();
  if (!messages.length) return <Banner tone="neutral">No emails yet.</Banner>;
  return (
    <>
      {messages.map((m, i) => {
        const link = m.text.match(/https?:\/\/\S+/)?.[0];
        return (
          <div key={`${m.at}-${i}`} data-outbox-to={m.to.toLowerCase()}>
          <Panel>
            <MonoLabel>
              To {m.to} · {new Date(m.at).toLocaleTimeString("en-GB")}
            </MonoLabel>
            <div className="text-body font-medium">{m.subject}</div>
            <p className="m-0 whitespace-pre-line text-chip text-mute">{m.text.replace(link ?? "", "").trim()}</p>
            {link && (
              <a href={link} className="text-chip font-medium" data-outbox-link>
                Open the link →
              </a>
            )}
          </Panel>
          </div>
        );
      })}
    </>
  );
}

export default function OutboxPage() {
  return (
    <Page>
      <AppHeader context="Local outbox" />
      <Banner tone="warn">Local mode only. On a real deployment, these go out through Resend and this page does not exist.</Banner>
      <Suspense fallback={<Skeleton className="h-[120px] w-full rounded-lg" />}>
        <Messages />
      </Suspense>
    </Page>
  );
}
