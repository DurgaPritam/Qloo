"use server";

import { redirect } from "next/navigation";

import { unsubscribeReminders } from "@/lib/workspace/session";

export async function unsubscribeRemindersAction(form: FormData) {
  const ok = await unsubscribeReminders(String(form.get("token") ?? ""));
  redirect(ok ? "/unsubscribe/reminders?done=1" : "/unsubscribe/reminders?invalid=1");
}
