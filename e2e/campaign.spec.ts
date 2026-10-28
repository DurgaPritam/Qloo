import { expect, test, type Page } from "@playwright/test";

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
  await expect(brief.getByText("to confirm").first()).toBeVisible();
  await expect(brief.locator("[data-interest]").first()).toBeVisible();
  await expect(brief.getByRole("region", { name: "Cities" }).getByText(/Qloo #1 · population #\d+/)).toBeVisible();
  await expect(brief.getByText(/^Angle 0[1-3]$/)).toHaveCount(3);

  await page.getByRole("button", { name: "Copy as text" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Late Set, spring 2027");
  expect(copied).toContain("Budget: to confirm (your data)");
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();

  await page.goto("/workspace/campaign");
  await expect(page.getByRole("region", { name: "Briefs" }).getByRole("link", { name: "Late Set, spring 2027" })).toBeVisible();
});
