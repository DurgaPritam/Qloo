import { expect, test, type Page } from "@playwright/test";

import { useTier } from "./tier";

/**
 * Plans & billing without Stripe keys (e2e never reaches Stripe): the tiers from the entitlement
 * map, prices "to confirm" rather than invented, upgrade prompts that lead here, the Enterprise
 * contact form, the usage page, and the legal pages. Webhooks are covered by unit tests.
 */
const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `bill.${run}@e2e.test`;

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

test("a Free workspace meets an upgrade prompt, sees the plans and its usage, and contacts us about Enterprise", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, EMAIL);

  // A Team feature on Free: what Team unlocks, and the way there.
  await page.goto("/workspace/rosters");
  const prompt = page.getByRole("region", { name: "Upgrade" });
  await expect(prompt).toContainText("Team unlocks");
  await expect(prompt).toContainText("Roster intelligence");
  await prompt.getByRole("link", { name: "Upgrade to Team" }).click();
  await expect(page).toHaveURL(/\/workspace\/settings\/billing\?tier=team/);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plans & billing");
  const plans = page.getByRole("list", { name: "Plans" });
  await expect(plans.locator("article[data-tier]")).toHaveCount(4);
  await expect(plans.locator('[data-tier="free"]')).toContainText("Current");
  // No Stripe here: no price is made up, and nothing can be bought.
  await expect(page.getByText("Billing isn't set up yet")).toBeVisible();
  await expect(plans.locator('[data-tier="pro"] [data-price]')).toHaveText("Price to confirm");
  await expect(plans.locator('[data-tier="enterprise"] [data-price]')).toHaveText("Custom");
  await expect(plans.getByRole("button", { name: "Upgrade to Team" })).toBeDisabled();
  await page.getByRole("tab", { name: "Annual" }).click();
  await expect(page.getByRole("tab", { name: "Annual" })).toHaveAttribute("aria-selected", "true");

  const usage = page.locator('[data-usage="qlooMonthly"]');
  await expect(usage).toContainText(/Qloo calls this month\s*\d[\d,]* of 200/);

  // Enterprise: the contact form emails Takeover, only on Send.
  await plans.getByRole("link", { name: "Talk to us" }).click();
  const contact = page.getByRole("region", { name: "Contact us about Enterprise" });
  await contact.getByLabel("Your name").fill("Bill Example");
  await contact.getByLabel("Company").fill("Example Live");
  await contact.getByLabel("Message").fill("Our venues want market watch.");
  await contact.getByRole("button", { name: "Send" }).click();
  await expect(contact.getByText(`Sent. We'll reply to ${EMAIL}.`)).toBeVisible();
  await page.goto("/dev/outbox");
  await expect(page.locator('[data-outbox-to="enterprise@takeover.local"]').filter({ hasText: "Enterprise enquiry from Example Live" }).first()).toBeVisible();

  // Usage, with the tier's limits.
  await useTier(page, "team");
  await page.goto("/workspace/settings/usage");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Usage");
  await expect(page.locator('[data-usage="seats"]')).toContainText("1 of 3");
  await expect(page.locator('[data-usage="plansPerMonth"]')).toContainText("0 of 200");
});

test("terms and privacy are linked from every page and flagged as placeholders", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.getByRole("main").locator("[data-legal-placeholder]")).toContainText("not yet reviewed by a lawyer");
  await expect(page.getByText("There are no analytics or advertising cookies")).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  await expect(page.getByRole("main").locator("[data-legal-placeholder]")).toBeVisible();
});
