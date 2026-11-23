// Signing in, editing your own list, and browsing someone else's list while signed in.
import { test, expect } from "@playwright/test";
import { mockRelay, fastQueue, watchErrors } from "./mock-relay.mjs";

// Today in local time, as the dashboard (and MyAnimeList's site) use it.
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const lastPatch = (state) => state.patches.at(-1);

test("signing in opens your own list, with a clean address", async ({ page }) => {
  const errors = watchErrors(page);
  await mockRelay(page);
  await page.goto("/");
  await expect(page.locator("#signInBtn")).toBeVisible();
  await page.click("#signInBtn");
  await expect(page.locator("#toast")).toContainText("Signed in as LeGilly");
  await expect(page.locator("#whoMeta")).toContainText("Your list (signed in)");
  expect(page.url()).toContain("user=LeGilly");
  expect(page.url()).not.toContain("signin");
  expect(errors).toEqual([]);
});

test("quick +1 is on Progress, not on Library covers", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await expect(page.locator(".plus1")).toHaveCount(0);
  await page.click("[data-tab=progress]");
  const card = page.locator(".pw").first();
  const id = await card.locator("[data-id]").first().getAttribute("data-id");
  const before = await page.evaluate((id) => MALD.account.myEntry("anime", Number(id)).progress, id);
  await card.locator(".plus1").click();
  await expect.poll(() => lastPatch(state)).toEqual([id, { num_watched_episodes: before + 1 }]);
});

test("the last episode completes a show with today's finish date", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly&tab=progress");
  await expect(page.locator(".pw").first()).toBeVisible();
  const id = await page.evaluate(() => {
    const e = MALD.account.mine.anime.find((x) => x.status === "current" && x.total && !x.repeating);
    e.progress = e.total - 1;
    return e.id;
  });
  await page.click("[data-tab=library]");
  await page.click("[data-tab=progress]");
  await page.locator(`.pw:has([data-id='${id}']) .plus1`).click();
  await expect.poll(() => lastPatch(state)?.[1].status).toBe("completed");
  expect(lastPatch(state)[1].finish_date).toBe(TODAY);
  await expect(page.locator("#toast")).toContainText("marked as completed");
});

test("editor: score, first episode, refused change undone, remove after confirming", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  const id = await page.evaluate(() => MALD.account.mine.anime.find((x) => x.status === "planned").id);
  await page.click("[data-status=planned]");
  await page.click(`.tile[data-id='${id}']`);
  await expect(page.locator("dialog[open] .editor")).toBeVisible();

  await page.selectOption("dialog [data-f=score]", "9");
  await expect.poll(() => lastPatch(state)).toEqual([String(id), { score: 9 }]);

  await page.click("dialog [data-step=progress][data-by='1']");
  await expect.poll(() => lastPatch(state)?.[1].status).toBe("watching");
  expect(lastPatch(state)[1]).toMatchObject({ start_date: TODAY, num_watched_episodes: 1 });
  await expect(page.locator("dialog .esave")).toContainText("Saved to MyAnimeList");

  state.fail = [429, "MyAnimeList is limiting requests. Wait a minute and try again."];
  const score = await page.inputValue("dialog [data-f=score]");
  await page.selectOption("dialog [data-f=score]", "3");
  await expect(page.locator("#toast")).toContainText("Couldn't save");
  await expect(page.locator("dialog [data-f=score]")).toHaveValue(score);
  state.fail = null;

  await page.click("dialog [data-act=remove]");
  await page.click("dialog [data-act=remove-yes]");
  await expect.poll(() => state.deletes.at(-1)).toBe(String(id));
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("dates typed in the editor are sent", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await page.click("[data-status=current]");
  await page.locator(".tile").first().click();
  await page.fill("dialog input[data-f=myStart]", "2024-03-31");
  await page.locator("dialog input[data-f=myStart]").dispatchEvent("change");
  await expect.poll(() => lastPatch(state)?.[1].start_date).toBe("2024-03-31");
});

test("someone else's list: read-only, your status shown, add to your plan", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=Friend");
  await expect(page.locator("#whoMeta")).toContainText("someone else");
  await expect(page.locator("#mineBtn")).toBeVisible();
  await expect(page.locator(".plus1")).toHaveCount(0);
  await page.click("[data-status=all]");
  const [both, only] = await page.evaluate(() => {
    const mine = new Set(MALD.account.mine.anime.map((x) => x.id));
    const ids = [...document.querySelectorAll(".tile")].map((t) => Number(t.dataset.id));
    return [ids.find((id) => mine.has(id)), ids.find((id) => !mine.has(id))];
  });
  await page.click(`.tile[data-id='${both}']`);
  await expect(page.locator("dialog[open]")).toContainText("On their list");
  await expect(page.locator("dialog[open]")).toContainText("On your list");
  await expect(page.locator("dialog .editor")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.click(`.tile[data-id='${only}']`);
  await page.click("dialog [data-add]");
  await expect.poll(() => lastPatch(state)).toEqual([String(only), { status: "plan_to_watch" }]);
});

test("MyAnimeList busy: you stay signed in; a real sign-out forgets you", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await expect(page.locator("#whoMeta")).toContainText("Your list");
  state.meFail = 429;
  await page.goto("/?user=LeGilly");
  await expect(page.locator("#toast")).toContainText("Couldn't reach MyAnimeList");
  await expect(page.locator("#whoMeta")).toContainText("Your list");
  state.meFail = null;
  state.signed = false;
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !MALD.account.me && !localStorage.getItem("mald:me"))).toBe(true);
});

test("Plan to watch from Next up", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await fastQueue(page);
  await page.click("[data-tab=next]");
  const add = page.locator(".rw .addplan").first();
  await expect(add).toBeVisible({ timeout: 60_000 });
  const id = await page.evaluate(() => { const b = document.querySelector(".rw .addplan"); b.click(); return b.dataset.add; });
  await expect.poll(() => lastPatch(state)).toEqual([id, { status: "plan_to_watch" }]);
});

test("signing out goes back to the start and forgets your list", async ({ page }) => {
  const state = await mockRelay(page, { signed: true });
  await page.goto("/?user=LeGilly");
  await expect(page.locator("#whoMeta")).toContainText("Your list");
  await page.click("#settingsBtn");
  await page.click("[data-acct=signout]");
  await expect(page.locator("#signInBtn")).toBeVisible();
  expect(state.signed).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("mald:mine"))).toBeNull();
});
