import { expect, test, type Page } from "@playwright/test";

import { useTier } from "./tier";

/** The App Shell: sidebar navigation, workspace search, notifications, settings tabs and the phone drawer. */

const run = Math.random().toString(36).slice(2, 8);

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

test("the sidebar, search, bell and settings tabs", async ({ page }) => {
  await signIn(page, `shel.${run}@e2e.test`);
  await useTier(page, "enterprise");
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(page.getByRole("button", { name: /^Workspace: shel\./ })).toContainText("1 member");
  await nav.getByRole("link", { name: "Rosters" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rosters" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Rosters" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("textbox", { name: "Roster name" }).fill(`Shell comedy ${run}`);
  await page.getByRole("button", { name: "Create roster" }).click();
  await expect(page).toHaveURL(/\/workspace\/rosters\/[0-9a-f-]{36}$/);
  const rosterUrl = page.url();

  // Search finds it from anywhere in the workspace.
  await nav.getByRole("link", { name: "Data" }).click();
  await page.getByRole("textbox", { name: "Search this workspace" }).fill("Shell com");
  const results = page.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option", { name: /Roster\s*Shell comedy/ })).toBeVisible();
  await results.getByRole("option", { name: /Roster\s*Shell comedy/ }).click();
  await expect(page).toHaveURL(rosterUrl);

  await page.getByRole("button", { name: /^Notifications, 0 unread$/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText("No mentions yet.")).toBeVisible();

  await nav.getByRole("link", { name: "Settings" }).click();
  const tabs = page.getByRole("navigation", { name: "Settings" });
  await tabs.getByRole("link", { name: "Branded decks" }).click();
  await expect(page.getByRole("heading", { name: "Branded decks" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
});

test("@mobile the sidebar becomes a drawer behind the menu button", async ({ page }) => {
  await signIn(page, `mob.${run}@e2e.test`);
  await useTier(page, "enterprise");
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("complementary", { name: "Menu" });
  await drawer.getByRole("link", { name: "Watchlists" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Market watch" })).toBeVisible();
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
