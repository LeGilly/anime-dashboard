// Tests for the relay (worker/worker.js), run with Node: `npm run test:relay`.
// MyAnimeList and its sign-in are replaced by a fake (globalThis.fetch below): nothing leaves this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/worker.js";
const env = { MAL_CLIENT_ID: "cid", MAL_CLIENT_SECRET: "secret" };
let tokenCalls = [], malCalls = [], expiresIn = 3600, meDown = false, tokenFail = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/oauth2/token")) {
    const p = new URLSearchParams(init.body); tokenCalls.push(Object.fromEntries(p));
    if (tokenFail && p.get("grant_type") === "refresh_token") return new Response("{}", { status: tokenFail });
    if (p.get("client_secret") !== "secret") return new Response("{}", { status: 401 });
    return Response.json({ access_token: "AT" + tokenCalls.length, refresh_token: "RT", expires_in: expiresIn });
  }
  malCalls.push({ url, method: init.method || "GET", auth: init.headers && init.headers.Authorization, body: init.body && String(init.body) });
  if (url.includes("/users/@me?") && meDown) return new Response("busy", { status: 429 });
  if (url.includes("/users/@me?")) return Response.json({ id: 1, name: "LeGilly", picture: "p.jpg" });
  if (url.includes("/my_list_status") && init.method === "PATCH") return Response.json({ status: "watching", score: 8, num_episodes_watched: 5 });
  if (url.includes("/my_list_status") && init.method === "DELETE") return new Response(null, { status: 200 });
  if (url.includes("/users/@me/animelist")) return Response.json({ data: [{ node: { id: 5 }, list_status: { status: "watching" } }], paging: {} });
  return Response.json({});
};
const O = "https://anime.legilly.com", API = "https://api.legilly.com";
const req = (path, { method = "GET", origin, cookie, body, ct } = {}) => {
  const h = {}; if (origin) h.Origin = origin; if (cookie) h.Cookie = cookie; if (ct) h["Content-Type"] = ct;
  return worker.fetch(new Request(API + path, { method, headers: h, body }), env);
};
const cookies = (res) => res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("Set-Cookie")];
const val = (list, name) => (list.find((c) => c && c.startsWith(name + "=")) || "").split(";")[0];
// Each check is recorded, then reported as its own named test at the end.
const checks = [];
const ok = (cond, msg) => checks.push([!!cond, msg]);

// 1. login redirects to MAL with plain PKCE and our callback
let r = await req("/auth/login?return=" + encodeURIComponent(O + "/"));
const loc = new URL(r.headers.get("Location"));
ok(r.status === 302 && loc.origin === "https://myanimelist.net" && loc.searchParams.get("code_challenge_method") === "plain" && loc.searchParams.get("redirect_uri") === API + "/auth/callback", "login sends to MAL with plain PKCE and the right callback");
const pkce = val(cookies(r), "mald_pkce");
ok(cookies(r)[0].includes("HttpOnly") && cookies(r)[0].includes("SameSite=Lax"), "pending sign-in cookie is HttpOnly + Lax");
r = await req("/auth/login?return=" + encodeURIComponent("https://evil.example/"));
ok(r.status === 403, "login refuses to return to another site");

// 2. callback: wrong state is refused, right state signs in
r = await req(`/auth/callback?code=abc&state=WRONG`, { cookie: pkce });
ok(r.headers.get("Location").endsWith("?signin=failed"), "callback with wrong state fails");
r = await req(`/auth/callback?code=abc&state=${loc.searchParams.get("state")}`, { cookie: pkce });
const sess = val(cookies(r), "mald_sess");
ok(r.headers.get("Location") === O + "/?signin=ok" && sess.length > 40, "callback signs in and returns to the dashboard");
ok(tokenCalls.at(-1).code_verifier === loc.searchParams.get("code_challenge") && tokenCalls.at(-1).client_secret === "secret", "token exchange uses verifier + secret");
ok(!sess.includes("AT1"), "session cookie is encrypted (access key not readable)");
ok(cookies(r).some((c) => c.includes("mald_sess") && c.includes("HttpOnly") && c.includes("SameSite=Strict")), "session cookie is HttpOnly + Strict");
r = await req(`/auth/callback?error=access_denied`, { cookie: pkce });
ok(r.headers.get("Location").endsWith("?signin=cancelled"), "declining on MAL comes back as cancelled");

// 3. signed-in calls
r = await req("/me", { origin: O, cookie: sess });
ok(r.status === 200 && (await r.json()).name === "LeGilly" && r.headers.get("Access-Control-Allow-Credentials") === "true", "/me works with credentials");
ok(malCalls.at(-1).auth === "Bearer AT1", "MAL called with the access key");
r = await req("/me", { origin: O });
ok(r.status === 401, "/me without cookie -> 401");
r = await req("/me", { origin: O, cookie: "mald_sess=garbage" });
ok(r.status === 401, "tampered cookie -> 401");
r = await req("/me", { origin: "https://legilly.com", cookie: sess });
ok(r.status === 403, "account calls refused from other legilly.com pages");
r = await req("/me/list?type=anime", { origin: O, cookie: sess });
ok(r.status === 200 && malCalls.at(-1).url.includes("/users/@me/animelist"), "/me/list reads your own list");

// 4. editing
r = await req("/me/entry?type=anime&id=5", { method: "PATCH", origin: O, cookie: sess, ct: "application/json", body: JSON.stringify({ status: "watching", num_watched_episodes: 5, score: 8, start_date: "2026-11-21" }) });
ok(r.status === 200 && malCalls.at(-1).method === "PATCH" && malCalls.at(-1).body.includes("num_watched_episodes=5"), "PATCH passes changes as a form");
r = await req("/me/entry?type=anime&id=5", { method: "PATCH", origin: O, cookie: sess, ct: "application/json", body: JSON.stringify({ comments: "hi" }) });
ok(r.status === 400, "unknown fields refused");
r = await req("/me/entry?type=anime&id=5", { method: "PATCH", origin: O, cookie: sess, ct: "application/json", body: JSON.stringify({ score: 11 }) });
ok(r.status === 400, "score 11 refused");
r = await req("/me/entry?type=anime&id=5", { method: "PATCH", origin: O, cookie: sess, ct: "text/plain", body: "{}" });
ok(r.status === 415, "non-JSON PATCH refused");
r = await req("/me/entry?type=anime&id=5", { method: "PATCH", cookie: sess, ct: "application/json", body: JSON.stringify({ score: 5 }) });
ok(r.status === 403, "PATCH without Origin refused");
r = await req("/me/entry?type=anime&id=5", { method: "DELETE", origin: O, cookie: sess });
ok(r.status === 200 && malCalls.at(-1).method === "DELETE", "DELETE removes the title");

// 5. refresh when expired
expiresIn = 30; // expires within the minute
let p2 = await req("/auth/login?return=" + encodeURIComponent(O + "/")); const l2 = new URL(p2.headers.get("Location"));
let c2 = await req(`/auth/callback?code=x&state=${l2.searchParams.get("state")}`, { cookie: val(cookies(p2), "mald_pkce") });
expiresIn = 3600; const n = tokenCalls.length;
r = await req("/me", { origin: O, cookie: val(cookies(c2), "mald_sess") });
ok(r.status === 200 && tokenCalls.length === n + 1 && tokenCalls.at(-1).grant_type === "refresh_token" && (cookies(r)[0] || "").includes("mald_sess"), "expired access key is refreshed and cookie renewed");

// 5b. who you are is kept in the cookie: /me doesn't need MAL
let before = malCalls.length; meDown = true;
r = await req("/me", { origin: O, cookie: sess });
ok(r.status === 200 && (await r.json()).name === "LeGilly" && malCalls.length === before, "/me answers from the cookie, without calling MAL, even when MAL is busy");
meDown = false;
// 5c. refresh fails because MAL is busy -> still signed in; refresh refused -> signed out
const expired = val(cookies(c2), "mald_sess");
tokenFail = 503;
r = await req("/me", { origin: O, cookie: expired });
ok(r.status === 200 && (await r.json()).name === "LeGilly", "MAL busy during refresh keeps you signed in");
tokenFail = 400;
r = await req("/me", { origin: O, cookie: expired });
ok(r.status === 401, "refresh refused by MAL signs you out");
tokenFail = 0;
// 5d. sign-in while MAL can't give the name: fetched later and saved
meDown = true; expiresIn = 3600;
let p3 = await req("/auth/login?return=" + encodeURIComponent(O + "/")); const l3 = new URL(p3.headers.get("Location"));
let c3 = await req(`/auth/callback?code=y&state=${l3.searchParams.get("state")}`, { cookie: val(cookies(p3), "mald_pkce") });
ok(c3.headers.get("Location") === O + "/?signin=ok", "sign-in still works if the name can't be fetched yet");
meDown = false;
r = await req("/me", { origin: O, cookie: val(cookies(c3), "mald_sess") });
ok(r.status === 200 && (await r.json()).name === "LeGilly" && val(cookies(r), "mald_sess").length > 40, "name fetched later and saved into the cookie");

// 6. logout + public endpoints unchanged
r = await req("/auth/logout", { method: "POST", origin: O, cookie: sess });
ok(r.status === 200 && cookies(r)[0].includes("Max-Age=0"), "logout clears the cookie");
r = await req("/auth/logout", { method: "POST", origin: "https://evil.example", cookie: sess });
ok(r.status === 403, "logout from another site refused");
r = await req("/list?user=LeGilly&type=anime", { origin: O });
ok(r.status === 200, "public /list works for the dashboard");
for (const [o, what] of [[undefined, "no Origin (a script outside a browser)"], ["https://legilly.com", "legilly.com"], ["http://localhost:8000", "localhost"], ["https://evil.example", "another site"]]) {
  r = await req("/list?user=LeGilly&type=anime", { origin: o });
  ok(r.status === 403, `public /list refused for ${what}`);
}
r = await req("/auth/login?return=" + encodeURIComponent("http://localhost:8000/"));
ok(r.status === 403, "sign-in can't return to localhost any more");

// 7. request record: one log line per MAL call, no names; MAL's status passed back
const logs = []; const orig = console.log; console.log = (x) => logs.push(x);
meDown = false;
r = await req("/details?type=anime&ids=1,2", { origin: O });
const busyFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).includes("/anime/9") ? new Response("x", { status: 429, headers: { "Retry-After": "60" } }) : busyFetch(url, init);
const r9 = await req("/details?type=anime&ids=9", { origin: O });
await req("/list?user=SomeoneElse&type=anime", { origin: O });
globalThis.fetch = busyFetch; console.log = orig;
const lines = logs.map((l) => JSON.parse(l));
ok(lines.filter((l) => l.mal === "details").length === 3 && lines.some((l) => l.status === 429 && l.retryAfter === "60") && lines.some((l) => l.mal === "list"), "each MAL call logged with kind, status, Retry-After");
ok(!logs.join(" ").includes("SomeoneElse") && lines.every((l) => typeof l.ms === "number" && l.lastMin >= 1), "log has no names, has timings and a per-minute count");
ok(r9.status === 429 && (await r9.json()).mal === 429, "error tells the page what MAL answered");

// 8. browse: search, season, ranking
const seen = []; const f0 = globalThis.fetch;
globalThis.fetch = async (url, init) => { url = String(url);
  if (/\/v2\/(anime|manga)(\?|\/ranking|\/season)/.test(url)) { seen.push(url); return Response.json({ data: [{ node: { id: 1, title: "A" }, ranking: { rank: 3 } }, { node: { id: 2, title: "B" } }], paging: { next: "x" } }); }
  return f0(url, init); };
r = await req("/browse?type=anime&mode=search&q=fairy%20tail", { origin: O });
let jb = await r.json();
ok(r.status === 200 && seen.at(-1).includes("/v2/anime?q=fairy%20tail&limit=50&offset=0&nsfw=true&fields=") && jb.items.length === 2 && jb.more === true && jb.items[0].rank === 3, "search asks MAL once for 50 titles");
r = await req("/browse?type=anime&mode=search&q=ab", { origin: O });
ok(r.status === 400, "search needs 3+ characters");
r = await req("/browse?type=anime&mode=season&year=2026&season=fall&offset=50", { origin: O });
ok(r.status === 200 && seen.at(-1).includes("/anime/season/2026/fall?sort=anime_num_list_users&limit=50&offset=50"), "season, sorted by members, with paging");
r = await req("/browse?type=manga&mode=season&year=2026&season=fall", { origin: O });
ok(r.status === 400, "no seasons for manga");
r = await req("/browse?type=manga&mode=ranking&rank=manhwa", { origin: O });
ok(r.status === 200 && seen.at(-1).includes("/manga/ranking?ranking_type=manhwa"), "manga ranking");
r = await req("/browse?type=anime&mode=ranking&rank=evil", { origin: O });
ok(r.status === 400, "unknown ranking refused");
globalThis.fetch = f0;

for (const [passed, name] of checks) test(name, () => assert.ok(passed, name));
