// Community tags: shown on a title's details, voted for while signed in, used to filter and browse.
import { test, expect } from "@playwright/test";
import { mockRelay, fixture, watchErrors, fastQueue } from "./mock-relay.mjs";

const A1 = fixture.anime[0].node, A2 = fixture.anime[1].node, A3 = fixture.anime[2].node;
const C1 = fixture.catalog[0]; // not on the list
const many = Array.from({ length: 14 }, (_, i) => [`Tag ${String(i + 1).padStart(2, "0")}`, 20 - i]);
const TAGS = { anime: {
  [A1.id]: [["Found family", 3], ["Slow burn", 1], ...many],
  [A2.id]: [["Found family", 1], ["Mecha", 2]],
  [C1.id]: [["Found family", 5]],
} };

async function open(page, id) {
  await page.evaluate((id) => MALD.ui.openDetail(id), id);
  await expect(page.locator("#dTags")).toBeVisible();
}
const chips = (page) => page.locator("#dTags .ctag-go").evaluateAll((bs) => bs.map((b) => b.textContent.replace(/\s+/g, " ").trim()));

test("signed out: tags show with their votes, most first; no voting", async ({ page }) => {
  const errors = watchErrors(page);
  await mockRelay(page, { tags: TAGS });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A1.id);
  await expect(page.locator("#dTags .ctag")).toHaveCount(10);
  expect((await chips(page)).slice(0, 3)).toEqual(["Tag 01 20", "Tag 02 19", "Tag 03 18"]);
  await page.click("#dTags [data-act=tagsmore]");
  await expect(page.locator("#dTags .ctag")).toHaveCount(16);
  expect(await chips(page)).toContain("Found family 3");
  await expect(page.locator("#dTags .ctag-vote")).toHaveCount(0);
  await expect(page.locator("#tagInput")).toHaveCount(0);
  await expect(page.locator("#dTags")).toContainText("Sign in to add tags.");
  await page.keyboard.press("Escape");
  await open(page, A3.id);
  await expect(page.locator("#dTags")).toContainText("No tags yet.");
  expect(errors).toEqual([]);
});

test("signed in: add a tag with suggestions, vote for one, take a vote back", async ({ page }) => {
  const state = await mockRelay(page, { signed: true, tags: TAGS });
  await page.goto("/");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A2.id);
  await expect(page.locator("#dTags .ctag-vote")).toHaveCount(2);
  // Suggestions: typing "slo" offers "Slow burn" (used on another title); Escape closes them, not the panel.
  await page.fill("#tagInput", "slo");
  await expect(page.locator("#tagSuggest li")).toHaveText(["Slow burn"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#tagSuggest")).toBeHidden();
  await expect(page.locator("#detail")).toBeVisible();
  await page.fill("#tagInput", "slo");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#dTags .ctag.mine")).toHaveText(/Slow burn\s*1/);
  expect(state.votes.some((v) => v.id === A2.id && v.key === "slow burn" && v.user === 1)).toBe(true);
  await expect(page.locator("#tagMsg")).toHaveText('Voted for "Slow burn".');
  // A brand new tag, typed out.
  await page.fill("#tagInput", "  Robot   pilots ");
  await page.click("#tagForm button[type=submit]");
  await expect(page.locator("#dTags .ctag.mine")).toHaveCount(2);
  expect(await chips(page)).toContain("Robot pilots 1");
  // + on someone else's tag, then take it back.
  await page.click("#dTags [data-tagon='Mecha']");
  await expect(page.locator("#dTags .ctag", { hasText: "Mecha" })).toHaveText(/Mecha\s*3/);
  await page.click("#dTags [data-tagoff='Mecha']");
  await expect(page.locator("#dTags .ctag", { hasText: "Mecha" })).toHaveText(/Mecha\s*2/);
  await expect(page.locator("#dTags .ctag", { hasText: "Mecha" })).not.toHaveClass(/mine/);
  // Your votes are remembered after a reload.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A2.id);
  await expect(page.locator("#dTags .ctag.mine")).toHaveCount(2);
});

test("mistakes are explained, and nothing is sent", async ({ page }) => {
  const state = await mockRelay(page, { signed: true, tags: TAGS });
  await page.goto("/");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A3.id);
  const posts = () => state.calls.filter((c) => c.path === "/me/tags" && c.method === "POST").length;
  for (const [bad, says] of [["x", "2 to 24"], ["<b>hi</b>", "letters, numbers"]]) {
    await page.fill("#tagInput", bad);
    await page.keyboard.press("Enter");
    await expect(page.locator("#tagMsg")).toContainText(says);
  }
  expect(posts()).toBe(0);
  state.tagFail = [429, "That's a lot of tags in an hour. Try again later."];
  await page.fill("#tagInput", "Fine tag");
  await page.keyboard.press("Enter");
  await expect(page.locator("#tagMsg")).toHaveText("That's a lot of tags in an hour. Try again later.");
  await expect(page.locator("#tagInput")).toBeEnabled();
});

test("a tag's name is shown as text, never as page code", async ({ page }) => {
  const errors = watchErrors(page);
  await mockRelay(page, { tags: { anime: { [A1.id]: [['<img src=x onerror="window.hacked=1">', 1]] } } });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A1.id);
  await expect(page.locator("#dTags .ctag-go")).toContainText("<img");
  await expect(page.locator("#dTags img")).toHaveCount(0);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("clicking a tag lists every title with it, most votes first", async ({ page }) => {
  const state = await mockRelay(page, { tags: TAGS });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A1.id);
  await page.click("#dTags [data-act=tagsmore]");
  await page.click("#dTags [data-tagbrowse='Found family']");
  await expect(page.locator("#detail")).toBeHidden();
  await expect(page.locator("[data-tab=search]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bmode=tag]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rcard")).toHaveCount(3);
  const names = await page.locator(".rcard strong").allTextContents();
  expect(names[0]).toBe(C1.title);            // 5 votes, not on the list: looked up on MAL
  expect(names.slice(1).sort()).toEqual([A1.title, A2.title].sort());
  await expect(page.locator(".rcard").first()).toContainText("5 votes");
  expect(state.calls.filter((c) => c.path === "/details").flatMap((c) => c.ids)).toEqual([C1.id]);
  // The tag menu switches tags.
  await page.selectOption("[data-b=tag]", "Mecha");
  await expect(page.locator(".rcard")).toHaveCount(1);
  await expect(page.locator(".rcard strong")).toHaveText(A2.title);
});

test("filters: Library and Search results by tag", async ({ page }) => {
  await mockRelay(page, { tags: TAGS });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await expect(page.locator("#fTag option").nth(1)).toHaveText("Found family");
  await page.selectOption("#fTag", "Found family");
  await expect(page.locator(".tile")).toHaveCount(2);
  await page.selectOption("#fTag", "Mecha");
  await expect(page.locator(".tile")).toHaveCount(1);
  await page.selectOption("#fTag", "");
  // Search results: a tag menu appears when results carry tags.
  await page.click("[data-tab=search]");
  await page.click("[data-bmode=ranking]");
  await expect(page.locator(".rcard").first()).toBeVisible();
  const total = await page.locator(".rcard").count();
  await page.selectOption("[data-b=tagF]", "Found family");
  await expect(page.locator(".rcard")).not.toHaveCount(total);
  for (const card of await page.locator(".rcard").all()) {
    const id = Number(await card.getAttribute("data-id"));
    expect([A1.id, A2.id, C1.id]).toContain(id);
  }
});

test("tags switched off on the relay: nothing about tags shows", async ({ page }) => {
  const errors = watchErrors(page);
  await mockRelay(page, { signed: true, tagsOff: true });
  await page.goto("/");
  await expect(page.locator(".tile").first()).toBeVisible();
  await expect(page.locator("#fTag")).toHaveCount(0);
  await page.evaluate((id) => MALD.ui.openDetail(id), A1.id);
  await expect(page.locator("#detail h2")).toBeVisible();
  await expect(page.locator("#dTags")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.click("[data-tab=search]");
  await expect(page.locator("[data-bmode=search]")).toBeVisible();
  await expect(page.locator("[data-bmode=tag]")).toHaveCount(0);
  await page.click("#settingsBtn");
  await expect(page.locator("[data-acct=signout]")).toBeVisible();
  await expect(page.locator("[data-acct=untag]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Settings: remove all my tags, after a confirmation", async ({ page }) => {
  const state = await mockRelay(page, { signed: true, tags: TAGS });
  await page.goto("/");
  await expect(page.locator(".tile").first()).toBeVisible();
  await open(page, A1.id);
  await page.click("#dTags [data-tagon='Tag 01']");
  await expect(page.locator("#dTags .ctag.mine")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.click("#settingsBtn");
  await page.click("[data-acct=untag]");
  await expect(page.locator(".untag-ask")).toContainText("Remove every tag vote");
  await page.click("[data-acct=untag-no]");
  expect(state.votes.some((v) => v.user === 1)).toBe(true);
  await page.click("[data-acct=untag]");
  await page.click("[data-acct=untag-yes]");
  await expect(page.locator("#toast, .toast").first()).toContainText("Removed your 1 tag vote.");
  expect(state.votes.some((v) => v.user === 1)).toBe(false);
  await open(page, A1.id);
  await expect(page.locator("#dTags .ctag.mine")).toHaveCount(0);
});

test("filters: Next up by tag", async ({ page }) => {
  const state = await mockRelay(page, { tags: TAGS });
  await page.goto("/?user=LeGilly");
  await expect(page.locator(".tile").first()).toBeVisible();
  await fastQueue(page);
  await page.click("[data-tab=next]");
  await expect(page.locator(".rcard").first()).toBeVisible({ timeout: 60_000 });
  // Tag two of the suggestions on screen, then reload the tags.
  const ids = (await page.locator(".rcard").evaluateAll((cs) => cs.map((c) => Number(c.dataset.id)))).slice(0, 2);
  for (const id of ids) state.votes.push({ type: "anime", id, key: "found family", user: 500 });
  await page.evaluate(() => { MALD.tags.titles.anime = null; MALD.tags.ensure("anime"); });
  await expect(page.locator("#rTag option", { hasText: "Found family" })).toHaveCount(1);
  await page.selectOption("#rTag", "Found family");
  const shown = await page.locator(".rcard").evaluateAll((cs) => cs.map((c) => Number(c.dataset.id)));
  expect(shown.length).toBeGreaterThanOrEqual(2);
  const tagged = new Set([...ids, A1.id, A2.id, C1.id]);
  expect(shown.every((id) => tagged.has(id))).toBe(true);
});
