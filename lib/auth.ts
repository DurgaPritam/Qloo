import "server-only";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

import { getDb } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { linkEmail, sendEmail } from "@/lib/email/mailer";

type Env = Record<string, string | undefined>;

/** Google sign-in is offered when its OAuth client is set (AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET). */
export const googleConfigured = (env: Env = process.env) => Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim());

/**
 * Auth.js: Google sign-in and email magic links, database sessions (revocable), and a personal workspace on first
 * sign-in. Links are sent through lib/email/mailer.ts (Resend, or the local outbox).
 * The sign-in link is built from the request host: Vercel sets it, and local runs are trusted.
 * Hosting anywhere else needs AUTH_URL, so a forged Host header cannot redirect the link.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const db = await getDb();
  return {
    adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    trustHost: true,
    // No newUser page: a first sign-in from an invitation must return to that invitation.
    pages: { signIn: "/signin", verifyRequest: "/signin/check", error: "/signin" },
    providers: [
      ...(googleConfigured()
        ? [
            Google({
              clientId: process.env.AUTH_GOOGLE_ID,
              clientSecret: process.env.AUTH_GOOGLE_SECRET,
              // Google verifies the address, so an account first made with an email link is the same person.
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
      Resend({
        // The key is read by lib/email/mailer.ts; the provider only needs a value to load.
        apiKey: "unused",
        from: process.env.EMAIL_FROM ?? "Takeover <sign-in@localhost>",
        maxAge: 60 * 60,
        async sendVerificationRequest({ identifier, url }) {
          await sendEmail(
            linkEmail({
              to: identifier,
              subject: "Your Takeover sign-in link",
              intro: "Use this link to sign in to Takeover. It works once and expires in an hour.",
              button: "Sign in to Takeover",
              url,
              outro: "If you didn't ask for this, ignore this email; nobody can sign in without the link.",
            }),
          );
        },
      }),
    ],
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      async createUser({ user }) {
        if (user.id) await unscopedEnsurePersonalWorkspace(db, { id: user.id, name: user.name, email: user.email });
      },
    },
  };
});
