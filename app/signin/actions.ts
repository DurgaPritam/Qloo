"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/lib/auth";
import { emailConfigured } from "@/lib/email/mailer";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-site paths, so a sign-in link can never bounce someone to another site. */
export async function safePath(raw: unknown, fallback = "/workspace?welcome=1"): Promise<string> {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : fallback;
}

/** Emails a magic link. Limited per visitor, so the form cannot be used to flood an inbox. */
export async function requestSignInLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = await safePath(form.get("next"));
  const back = (error: string) => redirect(`/signin?error=${error}&next=${encodeURIComponent(next)}`);
  if (!EMAIL.test(email) || email.length > 200) back("email-invalid");
  if (!emailConfigured()) back("email-unconfigured");
  const h = await headers();
  if (!isE2eRequest(h)) {
    const limit = await getLimiters().emails.check(visitorId(h));
    if (!limit.ok) back("too-many");
  }
  // Redirects to /signin/check when the link is sent.
  await signIn("resend", { email, redirectTo: next });
}

/** Sends the visitor to Google; Auth.js brings them back to `next`, signed in. */
export async function signInWithGoogle(form: FormData) {
  await signIn("google", { redirectTo: await safePath(form.get("next")) });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
