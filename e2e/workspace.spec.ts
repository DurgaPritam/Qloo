import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The team flow, signed in through the local outbox (no email service in e2e): sign up, plan,
 * invite, accept, comment with a mention, resolve, and private vs public share links.
 */

const run = Math.random().toString(36).slice(2, 8);
const ALICE = `alice.${run}@e2e.test`;
const BOB = `bob.${run}@e2e.test`;

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
  return context.newPage();
}

/** Follows the newest outbox email to `to` whose subject matches. */
async function openEmail(page: Page, to: string, subject: RegExp) {
  await page.goto("/dev/outbox");
  // Newest first, so the first match is the latest email.
  const message = page.locator(`[data-outbox-to="${to.toLowerCase()}"]`).filter({ hasText: subject }).first();
  const href = await message.locator("[data-outbox-link]").first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);
}

async function signIn(page: Page, email: string, next?: string) {
  await page.goto(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await openEmail(page, email, /sign-in link/);
}

test("sign up, plan, invite, comment with a mention, resolve, and share", async ({ browser }) => {
  test.setTimeout(180_000);
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  const stranger = await newPage(browser);
  let planUrl = "";

  await test.step("Alice signs up and gets a personal workspace", async () => {
    await signIn(alice, ALICE);
    await expect(alice).toHaveURL(/\/workspace\?welcome=1/);
    await expect(alice.getByRole("heading", { level: 1 })).toHaveText("Plans");
    await expect(alice.getByRole("button", { name: `Workspace: alice.${run}'s workspace` })).toBeVisible();
    await expect(alice.getByText("You're signed in.")).toBeVisible();
  });

  await test.step("a signed-in run saves to the workspace, private by default", async () => {
    await alice.goto("/run?q=Phoebe%20Bridgers");
    await expect(alice.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    const saved = alice.getByRole("link", { name: `Saved to alice.${run}'s workspace` });
    await expect(saved).toBeVisible();
    await saved.click();
    await alice.getByRole("main").getByRole("link", { name: /Phoebe Bridgers ×/ }).first().click();
    await expect(alice).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
    planUrl = alice.url();
    await expect(alice.getByText("Only its members can open this link.")).toBeVisible();
  });

  await test.step("a stranger cannot open the private link", async () => {
    // A 404 page, not "forbidden", so a private plan's existence is not revealed.
    await stranger.goto(planUrl);
    await expect(stranger.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(stranger.getByText("Phoebe Bridgers")).toHaveCount(0);
  });

  await test.step("Alice invites Bob as a member", async () => {
    await alice.goto("/workspace/members");
    await alice.getByRole("textbox", { name: "Email to invite" }).fill(BOB);
    await alice.getByRole("combobox", { name: "Role for the invitation" }).selectOption("member");
    await alice.getByRole("button", { name: "Send invite" }).click();
    await expect(alice.getByText(`Invitation sent to ${BOB}.`)).toBeVisible();
    await expect(alice.getByText("Pending invitations · 1")).toBeVisible();
  });

  await test.step("Bob accepts through the email link and signs in on the way", async () => {
    await openEmail(bob, BOB, /invited you/);
    await expect(bob.getByRole("heading", { name: `Join alice.${run}'s workspace` })).toBeVisible();
    const invite = bob.url();
    await bob.getByRole("link", { name: `Sign in as ${BOB} to accept` }).click();
    await bob.getByRole("textbox", { name: "Email address" }).fill(BOB);
    await bob.getByRole("button", { name: "Email me a link" }).click();
    await openEmail(bob, BOB, /sign-in link/);
    await expect(bob).toHaveURL(invite);
    await bob.getByRole("button", { name: "Accept and join" }).click();
    await expect(bob).toHaveURL(/\/workspace$/);
    await expect(bob.getByRole("heading", { level: 1 })).toHaveText("Plans");
    await expect(bob.getByRole("button", { name: `Workspace: alice.${run}'s workspace` })).toBeVisible();
    await expect(bob.getByRole("main").getByRole("link", { name: /Phoebe Bridgers ×/ })).toBeVisible();
  });

  await test.step("Bob comments on the city and mentions Alice", async () => {
    await bob.goto(planUrl);
    const city = bob.locator('details[data-target="city"]');
    await city.locator("summary").click();
    await city.getByRole("textbox").fill(`@alice.${run} is this the right city?`);
    await city.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(city.locator("[data-thread]")).toContainText("is this the right city?");
    await expect(city.locator("[data-thread]").getByText(`@alice.${run}`)).toBeVisible();
  });

  await test.step("Alice sees the mention, replies and resolves the thread", async () => {
    await alice.goto("/workspace/inbox");
    const mention = alice.getByRole("link", { name: /mentioned you/ });
    await expect(mention).toContainText("is this the right city?");
    await mention.click();
    const thread = alice.locator('details[data-target="city"] [data-thread]');
    await thread.getByRole("button", { name: "Reply" }).click();
    await thread.getByRole("textbox", { name: "Reply" }).fill("Yes: Qloo has it first for both audiences.");
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(thread).toContainText("Qloo has it first");
    await thread.getByRole("button", { name: "Resolve" }).click();
    await expect(thread.getByText("Resolved")).toBeVisible();
    await expect(thread.getByRole("button", { name: "Reopen" })).toBeVisible();
  });

  await test.step("made public, the link opens for anyone, without the comments", async () => {
    await alice.goto(planUrl);
    await alice.getByRole("tab", { name: "Anyone with the link" }).click();
    await expect(alice.getByText(/Anyone with the link can view it/)).toBeVisible();
    await stranger.goto(planUrl);
    await expect(stranger.getByText(/Phoebe Bridgers × .+ · Shared plan/)).toBeVisible();
    await expect(stranger.getByText("Team comments")).toHaveCount(0);
    await expect(stranger.getByText("is this the right city?")).toHaveCount(0);
  });
});

test("free tools and the Daily game still work signed out", async ({ page }) => {
  await page.goto("/overlap?a=Phoebe%20Bridgers&b=PEN15");
  await expect(page.getByText(/among Phoebe Bridgers fans/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/daily");
  await expect(page.getByText(/puzzle isn't ready yet|Round 1/).first()).toBeVisible({ timeout: 15_000 });
});
