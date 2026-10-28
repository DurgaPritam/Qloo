"use server";

import { redirect } from "next/navigation";

import { acceptInvitationForCurrentUser } from "@/lib/workspace/session";

export async function acceptInvitation(form: FormData) {
  const token = String(form.get("token") ?? "");
  const result = await acceptInvitationForCurrentUser(token);
  if (result.ok) redirect("/workspace");
  redirect(`/invite/${encodeURIComponent(token)}?error=${result.reason}`);
}
