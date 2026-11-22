// Related titles in the detail panel.
import { test, expect } from "@playwright/test";
import { mockRelay } from "./mock-relay.mjs";

const FAIRY = [[9015, "Fairy Tail (2014)", "", "sequel"], [9016, "Fairy Tail OVA", "", "side_story"],
  [9017, "Fairy Tail Movie 1: Houou no Miko", "", "side_story"], [9018, "Fairy Tail Movie 1: Houou no Miko - Hajimari no Asa", "", "side_story"],
  [9019, "Fairy Tail x Rave", "", "spin_off"], [9020, "Groove Adventure Rave", "", "character"],
  [9021, "Towa no Kizuna", "", "other"], [9022, "Fairy Tail x Mameshiba", "", "other"]];

async function openTitle(page, id) {
  const name = await page.evaluate((id) => MALD.account.mine.anime.find((e) => e.id === id).title, id);
  await page.fill("#q", name);
  await page.click(`.tile[data-id='${id}']`);
  await expect(page.locator("dialog[open] .rels")).toBeVisible();
}

test("main relations first, the rest behind a button; asked once, then saved", async ({ page }) => {
  const state = await mockRelay(page, { signed: true, linksFor: { 2: FAIRY } });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await openTitle(page, 2);
  await expect(page.locator(".rel")).toHaveCount(4);
  await expect(page.locator("#dRelated")).toContainText("Show 4 more");
  await page.click("[data-act=relmore]");
  await expect(page.locator(".rel")).toHaveCount(8);
  await page.click("[data-act=relless]");
  await expect(page.locator(".rel")).toHaveCount(4);
  expect(await page.evaluate(() => { const d = document.querySelector("dialog"); return d.scrollWidth <= d.clientWidth; })).toBe(true);
  await page.keyboard.press("Escape");
  await openTitle(page, 2);
  expect(state.calls.filter((c) => c.path === "/links" && c.ids.join() === "2")).toHaveLength(1);
});

test("open a sequel, come back, and add it to your plan", async ({ page }) => {
  const state = await mockRelay(page, { signed: true, linksFor: { 2: FAIRY } });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await openTitle(page, 2);
  const title = await page.textContent("dialog h2");
  await page.click("dialog [data-rel='9015']");
  await expect(page.locator("dialog [data-act=relback]")).toContainText("Back to");
  const box = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { coverLeft: r("dialog .d-cover").left < r("dialog h2").left, backAboveTitle: r("dialog .d-back").bottom <= r("dialog h2").top + 2 };
  });
  expect(box).toEqual({ coverLeft: true, backAboveTitle: true });
  await page.click("dialog [data-act=relback]");
  await expect(page.locator("dialog h2")).toHaveText(title);
  await page.click("dialog .rel-add[data-add='9015']");
  await expect.poll(() => state.patches.at(-1)).toEqual(["9015", { status: "plan_to_watch" }]);
  await expect(page.locator("dialog h2")).toHaveText(title);
  await expect(page.locator("dialog .rel-add[data-add='9015']")).toHaveCount(0);
});
