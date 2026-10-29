import { expect, test, type Page } from "@playwright/test";

import { useTier } from "./tier";

/**
 * Market watch: watch a fanbase and a city, see that one snapshot never alerts, run next Monday's
 * check through the job queue (locally, with the e2e token), turn the digest on, get a test,
 * and unsubscribe from its link without signing in.
 */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `wren.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/workspace/);
}

test("watch a fanbase and a city, first snapshot, weekly check, digest test and unsubscribe", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  await useTier(page, "enterprise");

  await test.step("empty state, then watch a fanbase: first snapshot, no alert", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Watchlists" }).click();
    await expect(page.getByRole("heading", { name: "No watchlists yet" })).toBeVisible();
    await page.getByLabel("Watch a fanbase").fill("Phoebe Bridgers");
    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await expect(page.getByText("Phoebe Bridgers: First snapshot taken; changes appear next week.")).toBeVisible();
    const row = page.locator('[data-watch="Phoebe Bridgers"]');
    await expect(row.locator("[data-watch-status]")).toHaveText("1st snapshot");
    await expect(page.locator("[data-no-alerts]")).toBeVisible();
    await row.getByRole("button", { name: /Phoebe Bridgers fans/ }).click();
    await expect(row.getByText("Where the fans are")).toBeVisible();
    await expect(row.getByText("Top crossover partners")).toBeVisible();
  });

  await test.step("watch a city, picking between namesakes", async () => {
    await page.getByRole("tab", { name: "Cities" }).click();
    await page.getByLabel("Watch a city").fill("Springfield");
    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await page.getByRole("button", { name: /Springfield, Missouri/ }).click();
    await expect(page.locator('[data-watch="Springfield"] [data-watch-status]')).toHaveText("1st snapshot");
  });

  await test.step("next Monday's check runs through the job queue and compares two snapshots", async () => {
    // The tick only queues a workspace during its Monday 07:xx (UTC here: no time zone set), at
    // least a week on, so the item's next check is due.
    const at = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    at.setUTCDate(at.getUTCDate() + ((8 - at.getUTCDay()) % 7));
    at.setUTCHours(7, 30, 0, 0);
    const nextWeek = at.toISOString();
    const tick = await request.post("/api/jobs/watch-tick", { data: { now: nextWeek } });
    expect(tick.ok()).toBe(true);
    expect((await tick.json()).queued).toBeGreaterThanOrEqual(1);
    await expect(async () => {
      await page.reload();
      await page.getByRole("tab", { name: "Fanbases" }).click();
      // Sample data is the same every week, so two snapshots compare to no changes.
      await expect(page.locator('[data-watch="Phoebe Bridgers"] [data-watch-status]')).toHaveText("No changes", { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText("No changes since last week.").first()).toBeVisible();
  });

  await test.step("a seeded second snapshot produces alerts with before and after values", async () => {
    const watch = (await (await page.request.get("/api/workspace/watch")).json()) as { items: { id: string; name: string }[] };
    const phoebe = watch.items.find((i) => i.name === "Phoebe Bridgers")!;
    const seeded = await page.request.post("/api/dev/watch-seed", { data: { itemId: phoebe.id } });
    expect(seeded.ok()).toBe(true);
    expect((await seeded.json()).changes).toBeGreaterThanOrEqual(2);
    await page.reload();
    const alerts = page.getByRole("list", { name: "Alerts" });
    await expect(alerts.locator('[data-alert="rank_up"]').first()).toContainText(/up 3 places in the top (cities|crossover partners) for Phoebe Bridgers/);
    await expect(alerts.locator('[data-alert="rank_up"]').first()).toContainText(/Rank #4 → #1; Qloo value \d+ → \d+ among Phoebe Bridgers fans\./);
    await expect(alerts.locator('[data-alert="value_down"]').first()).toContainText(/Down 8 points, \d+ → \d+; rank #2 → #3/);
  });

  await test.step("the digest previews in all three looks, as the email itself", async () => {
    const digest = page.getByRole("region", { name: "Weekly digest" });
    for (const [label, bg] of [["Dark", "#161826"], ["Gen Z", "#f4eee0"], ["Light", "#f3f5fe"]] as const) {
      await digest.getByRole("tab", { name: label }).click();
      const frame = page.frameLocator(`iframe[title="Digest email preview, ${label}"]`);
      await expect(frame.getByText(/up 3 places/).first()).toBeVisible();
      expect(await frame.locator("body").getAttribute("bgcolor")).toBe(bg);
    }
  });

  await test.step("turn the digest on and send a test; only this person is a recipient", async () => {
    const digest = page.getByRole("region", { name: "Weekly digest" });
    await expect(digest.getByText("Off")).toBeVisible();
    await digest.getByRole("switch", { name: "Email me the weekly digest" }).click();
    await expect(digest.getByText("On · every Monday")).toBeVisible();
    await expect(digest.getByText(EMAIL)).toBeVisible();
    await digest.getByRole("button", { name: "Send me a test" }).click();
    await expect(page.getByText(`Test digest sent to ${EMAIL}.`)).toBeVisible();
  });

  await test.step("unsubscribe from the email's link, without signing in", async () => {
    await page.goto("/dev/outbox");
    const mail = page.locator(`[data-outbox-to="${EMAIL}"]`).filter({ hasText: "Test · Market watch" }).first();
    // The message body only (the outbox shows the first link as a button after it).
    const text = await mail.locator("p").first().innerText();
    const link = text.match(/https?:\/\/\S+\/unsubscribe\/digest\?token=\S+/)?.[0];
    expect(link).toBeTruthy();
    const stranger = await page.context().browser()!.newContext();
    const anon = await stranger.newPage();
    await anon.goto(new URL(link!).pathname + new URL(link!).search);
    await anon.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(anon.getByText(/You are unsubscribed/)).toBeVisible();
    await stranger.close();
    await page.goto("/workspace/watch");
    await expect(page.getByRole("region", { name: "Weekly digest" }).getByText("Off")).toBeVisible();
  });
});
