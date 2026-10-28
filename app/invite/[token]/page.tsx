import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppHeader, Banner, Button, MonoLabel, Page, Panel, Skeleton } from "@/components/ui";
import { signOutAction } from "@/app/signin/actions";
import { ROLE_LABEL } from "@/lib/workspace/permissions";
import { currentUser, invitationForToken } from "@/lib/workspace/session";

import { acceptInvitation } from "./actions";

export const metadata: Metadata = { title: "Invitation · Takeover", robots: { index: false } };

const STATE: Record<string, string> = {
  accepted: "This invitation has already been used.",
  revoked: "This invitation was cancelled or replaced by a newer one. Ask for a new invite.",
  expired: "This invitation has expired. Ask for a new invite.",
};

async function Invitation({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const error = (await searchParams).error;
  const [invite, user] = await Promise.all([invitationForToken(token), currentUser()]);

  if (!invite) {
    return (
      <Banner tone="err" action={<Link href="/">Go to Takeover →</Link>}>
        This invitation link isn&apos;t valid. Check you copied all of it.
      </Banner>
    );
  }

  const here = `/invite/${encodeURIComponent(token)}`;
  const wrongEmail = Boolean(user?.email && user.email.toLowerCase() !== invite.email);

  return (
    <Panel>
      <MonoLabel className="text-acc-text">Invitation</MonoLabel>
      <h1 className="t-display m-0 text-[clamp(26px,4vw,36px)] leading-[0.95] [overflow-wrap:anywhere]">Join {invite.workspaceName}</h1>
      <p className="m-0 text-body text-mute [text-wrap:pretty]">
        {invite.inviter ?? "A teammate"} invited {invite.email} as {ROLE_LABEL[invite.role].toLowerCase()}.
      </p>
      {invite.state !== "pending" && invite.state !== "accepted" && <Banner tone="warn">{STATE[invite.state]}</Banner>}
      {invite.state === "accepted" && <Banner tone="neutral" action={<Link href="/workspace">Open the workspace →</Link>}>{STATE.accepted}</Banner>}
      {invite.state === "pending" && !user && (
        <Link
          href={`/signin?next=${encodeURIComponent(here)}`}
          className="self-start rounded-btn border-card border-ink bg-acc px-3 py-1.5 text-chip font-medium text-on-acc no-underline"
        >
          Sign in as {invite.email} to accept
        </Link>
      )}
      {invite.state === "pending" && user && wrongEmail && (
        <>
          <Banner tone="warn">
            You&apos;re signed in as {user.email}, but this invitation is for {invite.email}. Sign out, then sign in as {invite.email}.
          </Banner>
          <form action={signOutAction}>
            <Button type="submit">Sign out</Button>
          </form>
        </>
      )}
      {invite.state === "pending" && user && !wrongEmail && (
        <form action={acceptInvitation}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="primary" className="px-4 py-2 text-body">
            Accept and join
          </Button>
        </form>
      )}
      {typeof error === "string" && error !== "wrong-email" && <Banner tone="err">That didn&apos;t work ({error}). Try the link again.</Banner>}
    </Panel>
  );
}

export default function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  return (
    <Page max="max-w-[560px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Invitation params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
