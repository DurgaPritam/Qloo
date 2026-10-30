import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FIELD } from "@/components/account/fields";
import { AppHeader, Banner, Button, MonoLabel, Page, Panel, Skeleton } from "@/components/ui";
import { googleConfigured } from "@/lib/auth";
import { emailConfigured } from "@/lib/email/mailer";
import { currentUser } from "@/lib/workspace/session";

import { requestSignInLink, safePath, signInWithGoogle, signOutAction } from "./actions";

export const metadata: Metadata = { title: "Sign in · Takeover" };

const ERRORS: Record<string, string> = {
  "email-invalid": "Enter an email address.",
  "email-unconfigured": "Sign-in email isn't set up on this site yet, so no link was sent.",
  "too-many": "Too many sign-in emails from here this hour. Try again later.",
  Verification: "That sign-in link has expired or was already used. Ask for a new one.",
  AccessDenied: "Google sign-in was cancelled, so you're not signed in.",
  OAuthCallbackError: "Google sign-in didn't finish. Try again.",
  OAuthSignin: "Google sign-in didn't start. Try again.",
};

async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = await safePath(params.next ?? params.callbackUrl);
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? "Sign-in didn't work. Try again.") : null;
  const user = await currentUser();

  if (user) {
    return (
      <Panel>
        <MonoLabel className="text-acc-text">Signed in</MonoLabel>
        <p className="m-0 text-body">You&apos;re signed in as {user.email}.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={next} className="rounded-btn border-card border-ink bg-acc px-3 py-1.5 text-chip font-medium text-on-acc no-underline">
            Continue →
          </Link>
          <form action={signOutAction}>
            <Button type="submit">Sign out</Button>
          </form>
        </div>
      </Panel>
    );
  }

  // Each way in is offered only when it can work here: Google needs its OAuth client, email needs Resend
  // (or the local outbox).
  const google = googleConfigured();
  const email = emailConfigured();
  const how = google && email ? "Continue with Google, or we'll email you a link." : google ? "Continue with your Google account." : "We'll email you a link.";

  return (
    <Panel>
      <MonoLabel className="text-acc-text">Sign in or create an account</MonoLabel>
      <p className="m-0 text-body text-mute [text-wrap:pretty]">
        {how} No password. Your first sign-in creates your own workspace, where your team&apos;s plans and comments live.
      </p>
      {error && <Banner tone="err">{error}</Banner>}
      {!google && !email && <Banner tone="warn">Sign-in isn&apos;t set up on this site yet. The free tools and the Daily game work without an account.</Banner>}
      {google && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="primary" className="w-full px-4 py-2 text-body">
            Continue with Google
          </Button>
        </form>
      )}
      {email && (
        <form action={requestSignInLink} className="flex flex-wrap gap-2">
          <input type="hidden" name="next" value={next} />
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            aria-label="Email address"
            className={`${FIELD} min-w-0 flex-1 basis-[220px]`}
          />
          <Button type="submit" variant={google ? undefined : "primary"} className="px-4 py-2 text-body">
            Email me a link
          </Button>
        </form>
      )}
      {(google || email) && <p className="m-0 text-chip text-mute">The free tools and the Daily game work without an account.</p>}
    </Panel>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <Page max="max-w-[560px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Account</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Plan with your team</h1>
      </section>
      <Suspense fallback={<Skeleton className="h-[180px] w-full rounded-lg" />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
