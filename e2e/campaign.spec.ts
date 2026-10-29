import { expect, test, type Page } from "@playwright/test";

import { useTier } from "./tier";

/** Campaign brief: empty state, a brief from a plan, read it, and its print and copy actions. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `cora.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("make a campaign brief from a plan and read it", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, EMAIL);
  await useTier(page, "enterprise");

  await page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: "Campaign brief" }).click();
  await expect(page.getByRole("heading", { name: "No campaign briefs yet" })).toBeVisible();

  await page.goto("/run?q=Phoebe%20Bridgers");
  await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
  await page.goto("/workspace/campaign");
  await page.getByRole("textbox", { name: "Campaign name" }).fill("Late Set, spring 2027");
  await page.getByRole("textbox", { name: "Flight" }).fill("March 2027");
  await page.getByRole("button", { name: "Make the brief" }).click();
  await expect(page).toHaveURL(/\/workspace\/campaign\/[0-9a-f-]{36}$/);

  const brief = page.getByRole("article", { name: "Brief" });
  await expect(brief.getByRole("heading", { name: "Late Set, spring 2027" })).toBeVisible();
  await expect(brief.getByText("Flight: March 2027")).toBeVisible();
  await expect(brief.locator("[data-interest-group]").first()).toBeVisible();
  await expect(brief.locator('[data-keywords="Locations"]')).toBeVisible();
  await expect(brief.getByRole("region", { name: "Cities" }).getByText(/Qloo #1 · population #\d+/)).toBeVisible();
  await expect(brief.getByText(/^Angle 0[1-3]/)).toHaveCount(3);
  await expect(brief.getByRole("list", { name: "Facts" }).getByRole("listitem").first()).toBeVisible();
  // The only mention of commercial figures is the line saying there are none.
  expect(((await brief.innerText()).match(/impressions|CPM/g) ?? []).length).toBe(2);
  await expect(brief.getByText(/there are no reach, impressions, CPM or budget figures/)).toBeVisible();

  await page.getByRole("button", { name: "Copy as text" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Interest keywords for ad platforms");

  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Keywords and cities CSV" }).click();
  const file = await csv;
  expect(file.suggestedFilename()).toBe("late-set-spring-2027-keywords-cities.csv");
  const deck = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download deck" }).click();
  expect((await deck).suggestedFilename()).toBe("late-set-spring-2027.pptx");

  await test.step("a fanbase alone", async () => {
    await page.goto("/workspace/campaign");
    await page.getByRole("tab", { name: "A fanbase alone" }).click();
    await page.getByRole("textbox", { name: "Fanbase" }).fill("John Mulaney");
    await page.getByRole("button", { name: "Make the brief" }).click();
    await expect(page).toHaveURL(/\/workspace\/campaign\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("article", { name: "Brief" }).getByText(/Targeting brief for John Mulaney fans\./)).toBeVisible();
  });

  await page.goto("/workspace/campaign");
  await expect(page.getByRole("region", { name: "Briefs" }).getByRole("link", { name: "Late Set, spring 2027" })).toBeVisible();
});
