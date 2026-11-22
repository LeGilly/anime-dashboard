// Next up and the queue that every MyAnimeList request goes through.
import { test, expect } from "@playwright/test";
import { mockRelay, fastQueue } from "./mock-relay.mjs";

test("the queue: what you do goes first, budget spaces requests, groups pause and cancel", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  const r = await page.evaluate(async () => {
    MALD.REQ_PAUSE = 1; localStorage.removeItem("mald:pace");
    const N = MALD.net, c = N.config; c.BURST = 3; c.RATE = 200; c.tokens = 0; c.at = Date.now();
    const order = []; const job = (name, opts) => N.run(async () => { order.push(name); }, opts);
    const t0 = Date.now();
    await Promise.all([job("bg1", { priority: 2 }), job("bg2", { priority: 2 }), job("first", { priority: 1 }), job("click", { priority: 0 })]);
    const took = Date.now() - t0;
    N.pause("g"); let done = false; const paused = N.run(async () => { done = true; }, { priority: 2, group: "g", cost: 0 });
    await new Promise((res) => setTimeout(res, 300)); const whilePaused = done;
    N.resume("g"); await paused;
    N.pause("h"); const cancelled = N.run(async () => 1, { group: "h" }).catch((e) => e.cancelled); N.cancel("h");
    return { order, took, whilePaused, done, cancelled: await cancelled };
  });
  expect(r.order).toEqual(["click", "first", "bg1", "bg2"]);
  expect(r.took).toBeGreaterThanOrEqual(350);
  expect(r).toMatchObject({ whilePaused: false, done: true, cancelled: true });
});

test("Next up: small requests, paused away from the tab, resumed on return", async ({ page }) => {
  const state = await mockRelay(page);
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await page.evaluate(() => { for (const k of ["mald:links:anime", "mald:details:anime"]) localStorage.removeItem(k); });
  await page.evaluate(() => { MALD.REQ_PAUSE = 300; MALD.net.config.RATE = 50; localStorage.removeItem("mald:pace"); });
  await page.click("[data-tab=next]");
  await expect(page.locator("#recBg")).toBeVisible({ timeout: 60_000 });
  const lookups = () => state.calls.filter((c) => c.path === "/links" || c.path === "/details");
  expect(lookups().every((c) => c.ids.length <= 5)).toBe(true);
  await page.click("[data-tab=library]");
  await page.waitForTimeout(1500);
  const before = lookups().length;
  await page.waitForTimeout(3000);
  expect(lookups().length).toBe(before);
  await page.click("[data-tab=next]");
  await expect.poll(() => lookups().length, { timeout: 15_000 }).toBeGreaterThan(before);
});

test("Next up shows results and a progress line while it looks things up", async ({ page }) => {
  await mockRelay(page);
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await page.evaluate(() => { for (const k of ["mald:links:anime", "mald:details:anime"]) localStorage.removeItem(k); });
  await fastQueue(page);
  await page.evaluate(() => { MALD.FIRST_DETAILS = 5; });
  const seen = new Set();
  page.on("console", () => {});
  await page.click("[data-tab=next]");
  for (let i = 0; i < 100 && !(await page.locator(".rcard").count()); i++) {
    const t = await page.evaluate(() => (document.getElementById("recProgress") || {}).textContent || "");
    if (t) seen.add(t.replace(/\d+\/\d+/, "n/n"));
    await page.waitForTimeout(100);
  }
  await expect(page.locator(".rcard").first()).toBeVisible();
  expect([...seen].some((t) => t.includes("Looking up suggested titles… n/n"))).toBe(true);
});
