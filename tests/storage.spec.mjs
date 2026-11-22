// When the browser's storage is full, old cached details make room; lists are kept.
import { test, expect } from "@playwright/test";
import { mockRelay, fastQueue } from "./mock-relay.mjs";

test("storage full: oldest cached details are dropped, the list survives, the log shows it", async ({ page }) => {
  // A smaller storage limit than a real browser's, so it fills up with test data.
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      let total = 0;
      for (let i = 0; i < this.length; i++) { const key = this.key(i); if (key !== k) total += key.length + (this.getItem(key) || "").length; }
      if (total + k.length + String(v).length > (window.__LIMIT || 1e9)) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      return real.call(this, k, v);
    };
  });
  await mockRelay(page);
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  const size = await page.evaluate(() => (localStorage.getItem("mald:last") || "").length);
  await page.addInitScript((limit) => { window.__LIMIT = limit; }, size + 160_000);
  await page.evaluate((limit) => { window.__LIMIT = limit; }, size + 160_000);
  await page.evaluate(() => {
    const c = {}, old = Date.now() - 20 * 86400000;
    for (let i = 0; i < 1500; i++) c[900000 + i] = [old + i, { title: "Filler title number " + i, genres: ["Action", "Drama"], image: "https://cdn.myanimelist.net/images/anime/1/" + i + ".jpg" }];
    MALD.writeCache("mald:details:anime", c);
  });
  await fastQueue(page);
  await page.click("[data-tab=next]");
  await expect(page.locator(".rcard").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const use = await page.evaluate(() => MALD.storageUse());
  expect(use).toContain("made room");
  expect(use).not.toContain("FULL");
  expect(await page.evaluate(() => !!localStorage.getItem("mald:last"))).toBe(true);
  expect(await page.evaluate(() => Object.keys(MALD.readCache("mald:links:anime")).length)).toBeGreaterThan(0);
  const fillersLeft = await page.evaluate(() => Object.keys(MALD.readCache("mald:details:anime")).filter((id) => Number(id) >= 900000).length);
  expect(fillersLeft).toBeLessThan(1500);
  expect((await page.evaluate(() => MALD.netLogText())).split("\n")[1]).toMatch(/^storage /);
});
