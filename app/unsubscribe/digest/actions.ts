"use server";

import { redirect } from "next/navigation";

import { unsubscribeDigest } from "@/lib/workspace/session";

export async function unsubscribeAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  const ok = await unsubscribeDigest(token);
  redirect(ok ? "/unsubscribe/digest?done=1" : "/unsubscribe/digest?invalid=1");
}
