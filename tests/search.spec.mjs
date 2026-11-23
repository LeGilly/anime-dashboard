// The Search tab: name search, seasons, top lists, filters, adding results.
import { test, expect } from "@playwright/test";
import { mockRelay, fastQueue } from "./mock-relay.mjs";

test("name search: 3 characters, 50 results a page, filters, add a result", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?signin=ok");
  await expect(page.locator(".tile").first()).toBeVisible();
  await page.click("[data-tab=search]");
  await expect(page.locator("#bq")).toBeVisible();
  expect(state.browse).toHaveLength(0); // nothing asked until you search

  await page.fill("#bq", "ab");
  await page.press("#bq", "Enter");
  await expect(page.locator("#view")).toContainText("at least 3");
  expect(state.browse).toHaveLength(0);

  await page.fill("#bq", "kimi");
  await page.press("#bq", "Enter");
  await expect(page.locator("#view .rcard")).toHaveCount(50);
  expect(state.browse.at(-1)).toMatchObject({ mode: "search", q: "kimi" });
  await expect(page.locator("#view")).toContainText("On your list:");
  await expect(page.locator("#view")).toContainText("Not on your list");

  await page.click("[data-act=bmore]");
  await expect(page.locator("#view .rcard")).toHaveCount(90);
  expect(state.browse.at(-1).offset).toBe("50");

  await page.check("[data-b=hideListed]");
  await expect(page.locator("#view")).toContainText("hidden by the filters");
  await page.uncheck("[data-b=hideListed]");

  const type = (await page.locator("[data-b=type] option").allTextContents())[1];
  await page.selectOption("[data-b=type]", type);
  for (const meta of await page.locator("#view .rcard small").allTextContents()) expect(meta).toContain(type);
  await page.selectOption("[data-b=type]", "");

  const id = await page.evaluate(() => {
    const mine = new Set(MALD.account.mine.anime.map((e) => e.id));
    return [...document.querySelectorAll("#view .rcard")].map((c) => Number(c.dataset.id)).find((x) => !mine.has(x));
  });
  await page.click(`#view .rcard[data-id='${id}']`);
  await page.click(`dialog [data-add='${id}']`);
  await expect.poll(() => state.patches.at(-1)).toEqual([String(id), { status: "plan_to_watch" }]);
  await page.keyboard.press("Escape");
  await expect(page.locator(`#view .rcard[data-id='${id}']`)).toContainText("On your list: Plan to watch");
});

test("This season starts on the current season; top lists; nothing asked twice", async ({ page }) => {
  const state = await mockRelay(page);
  await page.goto("/?user=LeGilly&tab=search");
  await page.click("[data-bmode=season]");
  await expect(page.locator("#view .rcard").first()).toBeVisible();
  const now = new Date();
  expect(state.browse.at(-1)).toMatchObject({ mode: "season", year: String(now.getFullYear()),
    season: ["winter", "spring", "summer", "fall"][Math.floor(now.getMonth() / 3)] });
  await page.click("[data-bmode=ranking]");
  await expect(page.locator("#view .rcard small").first()).toContainText("#1");
  await page.selectOption("[data-b=rank]", "airing");
  await expect.poll(() => state.browse.at(-1).rank).toBe("airing");
  const asked = state.browse.length;
  await page.click("[data-bmode=season]");
  await expect(page.locator("#view .rcard").first()).toBeVisible();
  expect(state.browse.length).toBe(asked);
});

test("manga has no seasons", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?user=LeGilly&tab=search");
  await page.click("[data-kind=manga]");
  await expect(page.locator("[data-bmode=ranking]")).toBeVisible();
  await expect(page.locator("[data-bmode=season]")).toHaveCount(0);
});

test("a list loaded by name is worded as theirs in every tab, never by name or as yours", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?user=LeGilly&tab=search");
  await page.click("[data-bmode=ranking]");
  await expect(page.locator(".rcard").first()).toBeVisible();
  const tags = (await page.locator(".rcard .tag").allTextContents()).join(" | ");
  expect(tags).toContain("On their list:");
  expect(tags).toContain("Not on their list");
  await expect(page.locator("label.chk", { hasText: "Hide titles" })).toHaveText(/on their list/);
  await page.locator(".rcard .tag", { hasText: "On their list" }).first().click();
  await expect(page.locator("dialog[open] h3").first()).toHaveText("On their list");
  await page.keyboard.press("Escape");
  await fastQueue(page);
  await page.click("[data-tab=next]");
  await expect(page.locator(".rcard").first()).toBeVisible({ timeout: 60_000 });
  for (const tab of ["search", "library", "progress", "next", "stats"]) {
    await page.click(`[data-tab=${tab}]`);
    const text = await page.locator("#view").innerText();
    expect(text, tab).not.toMatch(/\b(you|your|you've|you're)\b/i);
    expect(text, tab).not.toContain("LeGilly's");
  }
  await page.click("[data-tab=next]");
  await expect(page.locator("#view")).toContainText("Sequels to shows they finished.");
});

test("your own list still says you and your", async ({ page }) => {
  await mockRelay(page, { signed: true });
  await page.goto("/");
  await expect(page.locator(".tile").first()).toBeVisible();
  await fastQueue(page);
  await page.click("[data-tab=next]");
  await expect(page.locator("#view")).toContainText("Sequels to shows you finished.", { timeout: 60_000 });
  await expect(page.locator("[data-rsource=new]")).toHaveText("Not on your list");
  await page.click("[data-tab=library]");
  await expect(page.locator("#fSort option").first()).toHaveText("Your score");
});
