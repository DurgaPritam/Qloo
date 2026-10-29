import { expect, test, type Page } from "@playwright/test";

import { featureById, ROLE_PICKS, ROLES } from "@/lib/features";

import { useTier } from "./tier";

/**
 * Onboarding: the landing role picker (each role path, at 1280 and 380 px), the run tour (once,
 * skippable, restartable, keyboard, reduced motion), the help panel, /guide signed out, and the
 * getting-started checklist ticking from real data. Starts with empty storage, so the tour is unseen.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const run = Math.random().toString(36).slice(2, 8);
const WIDTHS = [1280, 380] as const;

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

for (const width of WIDTHS) {
  test(`each role path on the landing page leads somewhere real (${width}px)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // The hero and "Plan a takeover" stay first.
    const hero = page.getByRole("heading", { level: 1 });
    const input = page.getByPlaceholder("Plan a takeover for…");
    const picker = page.getByRole("region", { name: "What can I do?" });
    await expect(picker).toBeVisible();
    expect((await input.boundingBox())!.y).toBeLessThan((await picker.boundingBox())!.y);
    expect((await hero.boundingBox())!.y).toBeLessThan((await input.boundingBox())!.y);
    // Sample mode: no cached real runs, so no examples are offered.
    await expect(picker.locator("[data-example]")).toHaveCount(0);

    for (const role of ROLES) {
      await page.goto("/");
      const roles = page.getByRole("radiogroup", { name: "Your role" });
      await roles.getByRole("radio", { name: role.label }).click();
      await expect(roles.getByRole("radio", { name: role.label })).toHaveAttribute("aria-checked", "true");
      const cards = page.locator(`[data-role-tools="${role.key}"] [data-role-tool]`);
      await expect(cards).toHaveCount(3);
      const hrefs: string[] = [];
      for (const [i, id] of ROLE_PICKS[role.key].entries()) {
        const f = featureById(id);
        await expect(cards.nth(i).getByRole("heading", { name: f.name })).toBeVisible();
        hrefs.push((await cards.nth(i).getByRole("link").getAttribute("href"))!);
      }
      for (const [i, href] of hrefs.entries()) {
        const f = featureById(ROLE_PICKS[role.key][i]);
        const res = await page.goto(href);
        expect(res?.status(), href).toBeLessThan(400);
        const path = new URL(page.url()).pathname;
        // Workspace features send a signed-out visitor to sign in first, then on to the feature.
        if (f.account) expect(path === f.route || path === "/signin", `${href} → ${path}`).toBe(true);
        else expect(path, href).toBe(f.route);
        await expect(page.getByRole("main").first()).toBeVisible();
      }
    }
  });

  test(`the run tour shows once, can be skipped, and restarts from help (${width}px)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/run?q=Phoebe%20Bridgers");
    const tip = page.getByRole("dialog", { name: "The agent log" });
    await expect(tip).toBeVisible({ timeout: 45_000 });
    await expect(tip).toContainText("Tip 1 of 5");
    await expect(tip.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(tip.getByRole("button", { name: "Next" })).toBeFocused();
    // Keyboard: → next, ← back, Esc skips.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "The Qloo call behind a step" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: "The agent log" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-tour-tip]")).toHaveCount(0);

    // Seen: a reload doesn't show it again.
    await page.reload();
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1200);
    await expect(page.locator("[data-tour-tip]")).toHaveCount(0);

    // Restart from the help panel ("?"), and go through all five tips.
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help).toBeVisible();
    await help.getByRole("link", { name: /Take the run tour/ }).click();
    await expect(help).toHaveCount(0);
    for (const title of ["The agent log", "The Qloo call behind a step", "Swap the partner", "The brief", "Outreach drafts"]) {
      const d = page.getByRole("dialog", { name: title });
      await expect(d).toBeVisible();
      await d.getByRole("button", { name: title === "Outreach drafts" ? "Done" : "Next" }).click();
    }
    await expect(page.locator("[data-tour-tip]")).toHaveCount(0);
  });
}

test("the help panel opens on ?, searches feature help, links to the formulas and closes on Esc", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "Help" }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help.getByRole("textbox", { name: "Search help" })).toBeFocused();
  await help.getByRole("textbox", { name: "Search help" }).fill("CSV");
  await expect(help.getByRole("status")).toHaveText(/\d+ results?/);
  await help.getByRole("button", { name: /Your data/ }).click();
  await expect(help).toContainText("Numbers: Your columns are Your data");
  await help.getByRole("textbox", { name: "Search help" }).fill("");
  await expect(help.getByRole("link", { name: /How the numbers are made/ })).toHaveAttribute("href", "/method");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Help" })).toBeFocused();
  // "?" while typing in a field types a question mark instead.
  await page.goto("/");
  await page.getByPlaceholder("Plan a takeover for…").fill("Who?");
  await expect(page.getByRole("dialog", { name: "Help" })).toHaveCount(0);
});

test("the guide, signed out, says what needs an account or a paid plan, with a way in each time", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every feature, grouped by who uses it");
  const rosters = page.locator('[data-guide-role="manager"] [data-guide-feature="rosters"]');
  await expect(rosters.locator("[data-access]")).toHaveText("Needs an account on Team or above.");
  await expect(rosters.getByRole("link", { name: "Sign in to see it →" })).toHaveAttribute("href", "/signin?next=%2Fworkspace%2Frosters");
  await expect(page.locator('[data-guide-feature="overlap"]').first().locator("[data-access]")).toHaveText("Free, no account needed.");
  await page.getByRole("radiogroup", { name: "Filter by role" }).getByRole("radio", { name: "Venue" }).click();
  await expect(page.locator("[data-guide-role]")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search features" }).fill("zzzz");
  await expect(page.getByText("No features match “zzzz”")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("[data-guide-role]")).toHaveCount(5);
});

test("the getting-started checklist ticks from the workspace's data and can be dismissed", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, `kit.${run}@e2e.test`);
  await useTier(page, "enterprise");
  await page.goto("/workspace");
  const list = page.getByRole("region", { name: /Set up/ });
  await expect(list.locator("[data-checklist-count]")).toHaveText("0 of 5 done");

  expect((await page.request.post("/api/workspace/rosters", { data: { name: "Fall" } })).ok()).toBe(true);
  expect((await page.request.post("/api/workspace/invitations", { data: { email: `mate.${run}@e2e.test`, role: "member" } })).ok()).toBe(true);
  await page.reload();
  await expect(list.locator("[data-checklist-count]")).toHaveText("2 of 5 done");
  await expect(list.locator('[data-checklist="roster"]')).toHaveAttribute("data-done", "true");
  await expect(list.locator('[data-checklist="invite"]')).toHaveAttribute("data-done", "true");
  await expect(list.locator('[data-checklist="run"]').getByRole("link", { name: "Plan a takeover" })).toHaveAttribute("href", "/");

  await list.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("#getting-started")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plans");
  await expect(page.locator("#getting-started")).toHaveCount(0);
});
