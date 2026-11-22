// Start page, addresses, tabs, the privacy notice and phone layout.
import { test, expect } from "@playwright/test";
import { mockRelay, watchErrors } from "./mock-relay.mjs";

test("the plain address opens the start page when not signed in", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/");
  await expect(page.locator("#loader")).toBeVisible();
  await expect(page.locator("#signInBtn")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  expect(new URL(page.url()).search).toBe("");
});

test("signed in, the plain address opens your own Library", async ({ page }) => {
  await mockRelay(page, { signed: true });
  await page.goto("/");
  await expect(page.locator("#whoMeta")).toContainText("Your list (signed in)");
  await expect(page.locator("[data-tab=library]")).toHaveAttribute("aria-selected", "true");
  expect(page.url()).toContain("user=LeGilly");
});

test("signed in, another user's address opens their list; Change list reaches the start page", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=Friend");
  await expect(page.locator(".tile").first()).toBeVisible();
  await expect(page.locator("#whoMeta")).not.toContainText("Your list");
  expect(page.url()).toContain("user=Friend");
  // From your own list, Change list shows the start page instead of sending you back to your list.
  await page.goto("/");
  await expect(page.locator("#whoMeta")).toContainText("Your list (signed in)");
  await page.click("#changeBtn");
  await expect(page.locator("#loader")).toBeVisible();
  await expect(page.locator("#mineBox")).toBeVisible();
  await page.fill("#user", "Friend");
  await page.click("#loadBtn");
  await expect(page.locator("#whoMeta")).not.toContainText("Your list");
  expect(page.url()).toContain("user=Friend");
  expect(state.calls.some((c) => c.path === "/list")).toBe(true);
});

test("a ?user= address opens that list on Library; tabs are in the agreed order", async ({ page }) => {
  const errors = watchErrors(page);
  await mockRelay(page);
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await expect(page.locator("#tabs button")).toHaveText(["Search", "Library", "Progress", "Next up", "Stats"]);
  await expect(page.locator("[data-tab=library]")).toHaveAttribute("aria-selected", "true");
  for (const tab of ["progress", "stats", "library"]) {
    await page.click(`[data-tab=${tab}]`);
    expect(page.url()).toContain(tab === "library" ? "user=LeGilly" : `tab=${tab}`);
  }
  expect(errors).toEqual([]);
});

test("tab= in the address opens that tab; Change list clears the address", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?user=LeGilly&tab=stats");
  await expect(page.locator("[data-tab=stats]")).toHaveAttribute("aria-selected", "true");
  await page.click("#changeBtn");
  await expect(page.locator("#loader")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("an unknown user shows a clear message", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/");
  await page.fill("#user", "NoSuchUser");
  await page.click("#loadBtn");
  await expect(page.locator("#status")).toContainText("No MyAnimeList user with that name");
});

test("privacy notice links back to the dashboard (top and bottom)", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/privacy.html");
  await page.click(".back-to a");
  await expect(page.locator("#loader")).toBeVisible();
  await page.goto("/privacy.html");
  await page.click(".sub a");
  await expect(page.locator("#loader")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const tab of ["library", "search", "progress", "stats"]) {
    test(`${tab} fits the screen width`, async ({ page }) => {
      await mockRelay(page);
      await page.goto(`/?user=LeGilly&tab=${tab}`);
      await expect(page.locator("#app")).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
  test("the detail panel fits the screen width", async ({ page }) => {
    await mockRelay(page);
    await page.goto("/?user=LeGilly");
    await page.locator(".tile").first().click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    expect(await page.evaluate(() => { const d = document.querySelector("dialog"); return d.scrollWidth <= d.clientWidth; })).toBe(true);
  });
});
