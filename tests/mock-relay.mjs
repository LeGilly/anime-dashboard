// A stand-in for the relay (api.legilly.com) and MyAnimeList's images, with made-up data from
// fixtures/mal.json (invented titles, no real users). Every test gets its own copy and its own record
// of what the page asked for, in `state`.
import { readFileSync } from "node:fs";
import { sharedFiles } from "./shared.mjs";

const M = JSON.parse(readFileSync(new URL("./fixtures/mal.json", import.meta.url), "utf8"));
export const ORIGIN = "http://localhost:8000";
const ACCOUNT = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json" };
const PUBLIC = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const COLORS = ["#c94", "#49c", "#9c4", "#c49", "#4c9", "#94c"];

export const fixture = M;

/**
 * Routes the relay and cover images for a page (or a whole browser context).
 * options: signed (start signed in), plus anything else to keep in `state`.
 * state: signed, meFail (status for /me), fail ([status, message] for edits), linksFor (id → related list),
 *        tags ({ anime: { id: [[tag, votes], ...] } }: votes from other people), tagsOff (no tag database: 503),
 *        and records: patches [[id, body]], deletes [id], browse [params], calls [{path, ids}],
 *        votes [{ type, id, key, label, user }] (every vote, yours are user 1).
 */
export async function mockRelay(target, options = {}) {
  const state = { signed: false, meFail: null, fail: null, linksFor: {}, patches: [], deletes: [], browse: [], calls: [], tags: {}, tagsOff: false, votes: [], ...options };
  // Tags work like the relay's: one vote per person per tag per title, the first spelling of a tag is kept.
  const labels = new Map();
  let other = 100;
  for (const [type, titles] of Object.entries(state.tags)) for (const [id, list] of Object.entries(titles)) for (const [label, n] of list) {
    if (!labels.has(label.toLowerCase())) labels.set(label.toLowerCase(), label);
    for (let i = 0; i < n; i++) state.votes.push({ type, id: Number(id), key: label.toLowerCase(), user: other++ });
  }
  const tally = (type, id) => {
    const count = new Map();
    for (const v of state.votes) if (v.type === type && v.id === id) count.set(v.key, (count.get(v.key) || 0) + 1);
    return [...count.entries()].map(([k, n]) => [labels.get(k), n]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const minePer = (type, id) => state.votes.filter((v) => v.type === type && v.id === id && v.user === 1).map((v) => labels.get(v.key)).sort();
  const titleAnswer = (type, id) => ({ id, tags: tally(type, id), mine: minePer(type, id) });
  await sharedFiles(target);
  const mine = structuredClone({ anime: M.anime, manga: M.manga });
  const nodes = { anime: new Map(), manga: new Map() };
  for (const k of ["anime", "manga"]) for (const it of M[k]) nodes[k].set(it.node.id, it.node);
  for (const n of M.catalog) nodes.anime.set(n.id, n);
  const friend = structuredClone(M.anime.slice(0, 60));
  friend.slice(0, 30).forEach((it) => { it.list_status.status = "completed"; });
  for (const n of M.catalog.slice(0, 20)) friend.push({ node: n, list_status: { status: "completed", score: 9, num_episodes_watched: n.num_episodes || 12 } });

  const json = (route, status, body, headers = PUBLIC) => route.fulfill({ status, headers, body: JSON.stringify(body) });

  await target.route("https://api.legilly.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    const path = url.pathname;
    const ids = q.ids ? q.ids.split(",").map(Number) : [];
    state.calls.push({ path, ids, method: req.method() });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: ACCOUNT });
    if (path === "/auth/login") { state.signed = true; return route.fulfill({ status: 302, headers: { Location: ORIGIN + "/?signin=ok" } }); }
    if (path === "/auth/logout") { state.signed = false; return json(route, 200, { ok: true }, ACCOUNT); }
    if (path.startsWith("/me")) {
      if (!state.signed) return json(route, 401, { error: "You're not signed in, or your sign-in expired. Sign in again." }, ACCOUNT);
      if (path === "/me" && state.meFail) return json(route, state.meFail, { error: "MyAnimeList is busy." }, ACCOUNT);
      if (path === "/me") return json(route, 200, { id: 1, name: "LeGilly", picture: "" }, ACCOUNT);
      if (path === "/me/list") return json(route, 200, { user: "@me", items: mine[q.type] }, ACCOUNT);
      if (path.startsWith("/me/tags")) {
        if (state.tagsOff) return json(route, 503, { error: "Tags aren't switched on yet." }, ACCOUNT);
        if (path === "/me/tags/all") {
          const before = state.votes.length;
          state.votes = state.votes.filter((v) => v.user !== 1);
          return json(route, 200, { removed: before - state.votes.length }, ACCOUNT);
        }
        if (req.method() === "GET") {
          const out = {};
          for (const v of state.votes) if (v.type === q.type && v.user === 1) (out[v.id] = out[v.id] || []).push(labels.get(v.key));
          return json(route, 200, { type: q.type, mine: out }, ACCOUNT);
        }
        const id = Number(q.id);
        if (req.method() === "POST") {
          const label = JSON.parse(req.postData()).tag.trim().replace(/\s+/g, " ");
          if (state.tagFail) return json(route, state.tagFail[0], { error: state.tagFail[1] }, ACCOUNT);
          const key = label.toLowerCase();
          if (!labels.has(key)) labels.set(key, label);
          if (!state.votes.some((v) => v.type === q.type && v.id === id && v.key === key && v.user === 1)) state.votes.push({ type: q.type, id, key, user: 1 });
          return json(route, 200, titleAnswer(q.type, id), ACCOUNT);
        }
        if (req.method() === "DELETE") {
          const key = q.tag.toLowerCase();
          state.votes = state.votes.filter((v) => !(v.type === q.type && v.id === id && v.key === key && v.user === 1));
          return json(route, 200, titleAnswer(q.type, id), ACCOUNT);
        }
      }
      if (path === "/me/entry") {
        if (state.fail) return json(route, state.fail[0], { error: state.fail[1] }, ACCOUNT);
        if (req.method() === "PATCH") { state.patches.push([q.id, JSON.parse(req.postData())]); return json(route, 200, { status: "watching" }, ACCOUNT); }
        if (req.method() === "DELETE") { state.deletes.push(q.id); return json(route, 200, { ok: true }, ACCOUNT); }
      }
    }
    if (path === "/list") {
      if (q.user === "NoSuchUser") return json(route, 404, { error: "No MyAnimeList user with that name." });
      if (q.user === "Friend") return json(route, 200, { items: q.type === "anime" ? friend : [] });
      return json(route, 200, { items: M[q.type] });
    }
    if (path === "/tags") {
      if (state.tagsOff) return json(route, 503, { error: "Tags aren't switched on yet." });
      const titles = {};
      for (const id of new Set(state.votes.filter((v) => v.type === q.type).map((v) => v.id))) titles[id] = tally(q.type, id);
      return json(route, 200, { type: q.type, titles });
    }
    if (path === "/details") return json(route, 200, { items: ids.map((id) => nodes[q.type].get(id) || { id, missing: true }) });
    if (path === "/links") {
      return json(route, 200, { items: ids.map((id) => state.linksFor[id] ? { id, recs: [], related: state.linksFor[id] }
        : M.links[id] || { id, recs: [], related: [] }) });
    }
    if (path === "/browse") {
      state.browse.push(q);
      const pool = q.type === "anime" ? [...M.anime.slice(0, 30).map((it) => it.node), ...M.catalog.slice(0, 60)] : M.manga.map((it) => it.node);
      const off = Number(q.offset || 0);
      const items = pool.slice(off, off + 50).map((n, i) => (q.mode === "ranking" ? { ...n, rank: off + i + 1 } : n));
      return json(route, 200, { type: q.type, items, more: off + 50 < pool.length });
    }
    return route.fulfill({ status: 404, body: "" });
  });

  await target.route("https://cdn.myanimelist.net/**", (route) => {
    const n = Number(route.request().url().split("/").pop().replace(/\D/g, "")) || 0;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="225" height="320"><rect width="225" height="320" fill="${COLORS[n % 6]}"/></svg>`;
    return route.fulfill({ status: 200, headers: { "Content-Type": "image/svg+xml" }, body: svg });
  });
  return state;
}

/** Makes Next up run fast: no pauses between requests. */
export const fastQueue = (page) => page.evaluate(() => { MALD.REQ_PAUSE = 2; MALD.net.config.RATE = 20; localStorage.removeItem("mald:pace"); });

/** Collects page errors so a test can check there were none. */
export function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
