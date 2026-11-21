// Anime Dashboard relay — a Cloudflare Worker between the dashboard and the MyAnimeList API.
//
// Why it exists:
//  - MAL's API needs a Client ID (and, for signing in, a Client Secret). Both stay here as secrets.
//  - MAL doesn't allow requests straight from a web page (no CORS); this relay adds the headers.
//  - Signing in: the relay talks to MAL and keeps the sign-in in an encrypted, HttpOnly cookie
//    on api.legilly.com. No page code can read it, not even the dashboard's.
// Nothing is stored here: no lists, no accounts. The cookie lives only in the visitor's browser.
//
// Secrets (Worker settings on Cloudflare): MAL_CLIENT_ID, MAL_CLIENT_SECRET.
//
// Public (no sign-in):
//   GET /list?user=NAME&type=anime|manga      -> { user, type, items: [ {node, list_status}, ... ] }
//   GET /details?type=anime|manga&ids=1,2,3   -> { type, items: [ node, ... ] }                    (max 25 ids)
//   GET /links?type=anime|manga&ids=1,2,3     -> { type, items: [ { id, recs, related }, ... ] }   (max 25 ids)
// Signing in (only from the dashboard's own address):
//   GET  /auth/login?return=URL   -> sends the visitor to MAL to approve access
//   GET  /auth/callback           -> MAL sends them back here; sets the cookie, returns them to the dashboard
//   POST /auth/logout             -> removes the cookie
// Signed in:
//   GET    /me                          -> { name, id, picture }
//   GET    /me/list?type=anime|manga    -> same as /list, including private entries
//   PATCH  /me/entry?type=...&id=N      -> body: JSON of list fields to change; returns MAL's list status
//   DELETE /me/entry?type=...&id=N      -> removes the title from your list

// Pages allowed to read public data from this relay.
const ALLOWED_ORIGINS = [
  "https://anime.legilly.com",
  "https://legilly.com",
  "https://www.legilly.com",
  "https://legilly.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];
// Pages allowed to sign in and change lists.
const ACCOUNT_ORIGINS = ["https://anime.legilly.com", "http://localhost:8000", "http://127.0.0.1:8000"];

const MAL = "https://api.myanimelist.net/v2";
const MAL_AUTH = "https://myanimelist.net/v1/oauth2";
const MAX_IDS = 25; // Cloudflare's free plan allows 50 outgoing requests per call; stay well under
const SESSION_DAYS = 60;

const COMMON = "id,title,main_picture,alternative_titles,start_date,mean,media_type,status,genres,nsfw,num_list_users";
// List fields are named explicitly: MAL leaves out the rewatch/reread count otherwise.
const LIST_FIELDS = {
  anime: "list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date,updated_at}",
  manga: "list_status{status,score,num_chapters_read,num_volumes_read,is_rereading,num_times_reread,start_date,finish_date,updated_at}",
};
const FIELDS = {
  anime: COMMON + ",num_episodes,start_season,average_episode_duration,studios",
  manga: COMMON + ",num_volumes,num_chapters,authors{first_name,last_name}",
};
// List fields a signed-in visitor may change, and what MAL expects.
const EDITABLE = {
  anime: {
    status: ["watching", "completed", "on_hold", "dropped", "plan_to_watch"],
    score: "0-10", num_watched_episodes: "count", is_rewatching: "bool", num_times_rewatched: "count",
    start_date: "date", finish_date: "date",
  },
  manga: {
    status: ["reading", "completed", "on_hold", "dropped", "plan_to_read"],
    score: "0-10", num_chapters_read: "count", num_volumes_read: "count", is_rereading: "bool", num_times_reread: "count",
    start_date: "date", finish_date: "date",
  },
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const account = url.pathname.startsWith("/me") || url.pathname === "/auth/logout";
    const cors = corsHeaders(origin, account);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !(account ? ACCOUNT_ORIGINS : ALLOWED_ORIGINS).includes(origin)) return json({ error: "Origin not allowed." }, 403, cors);
    if (!env.MAL_CLIENT_ID) return json({ error: "The relay has no MAL_CLIENT_ID secret yet." }, 500, cors);

    try {
      // ---------- signing in ----------
      if (url.pathname === "/auth/login" && request.method === "GET") return await login(request, env, url);
      if (url.pathname === "/auth/callback" && request.method === "GET") return await callback(request, env, url);
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        // A changing request must come from the dashboard itself (blocks other sites forging it).
        if (!ACCOUNT_ORIGINS.includes(origin)) return json({ error: "Origin not allowed." }, 403, cors);
        return json({ ok: true }, 200, { ...cors, "Set-Cookie": cookie("mald_sess", "", 0, "Strict") });
      }

      // ---------- signed in ----------
      if (url.pathname.startsWith("/me")) {
        if (request.method !== "GET" && !ACCOUNT_ORIGINS.includes(origin)) return json({ error: "Origin not allowed." }, 403, cors);
        const session = await getSession(request, env);
        if (!session) return json({ error: "You're not signed in, or your sign-in expired. Sign in again." }, 401, { ...cors, "Set-Cookie": cookie("mald_sess", "", 0, "Strict") });
        const extra = session.setCookie ? { "Set-Cookie": session.setCookie } : {};
        const h = { ...cors, ...extra, "Cache-Control": "no-store" };
        const authed = (u, init = {}) => mal(env, u, { ...init, token: session.access });

        // Who you are comes from the cookie (saved at sign-in), so checking it never needs MAL.
        if (url.pathname === "/me" && request.method === "GET") {
          if (session.me) return json(session.me, 200, h);
          const me = await fetchMe(env, session.access);
          const kept = { ...session.data, m: me };
          return json(me, 200, { ...h, "Set-Cookie": cookie("mald_sess", await seal(env, kept), SESSION_DAYS * 86400, "Strict") });
        }
        const type = url.searchParams.get("type");
        if (type !== "anime" && type !== "manga") return json({ error: "type must be anime or manga." }, 400, h);
        if (url.pathname === "/me/list" && request.method === "GET") {
          return json(await getList(env, "@me", type, session.access), 200, h);
        }
        if (url.pathname === "/me/entry") {
          const id = url.searchParams.get("id") || "";
          if (!/^\d{1,9}$/.test(id)) return json({ error: "id must be a number." }, 400, h);
          const target = `${MAL}/${type}/${id}/my_list_status`;
          if (request.method === "DELETE") {
            await authed(target, { method: "DELETE" });
            return json({ ok: true }, 200, h);
          }
          if (request.method === "PATCH") {
            if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json({ error: "Send JSON." }, 415, h);
            const form = checkChanges(type, await request.json().catch(() => null));
            if (form.error) return json({ error: form.error }, 400, h);
            const status = await authed(target, { method: "PATCH", body: form.body });
            return json(status, 200, h);
          }
        }
        return json({ error: "Unknown endpoint." }, 404, h);
      }

      // ---------- public ----------
      if (request.method !== "GET") return json({ error: "Only GET is allowed here." }, 405, cors);
      const type = url.searchParams.get("type");
      if (type !== "anime" && type !== "manga") return json({ error: "type must be anime or manga." }, 400, cors);
      if (url.pathname === "/list") {
        const user = url.searchParams.get("user") || "";
        if (!/^[A-Za-z0-9_-]{2,16}$/.test(user)) return json({ error: "That doesn't look like a MAL username." }, 400, cors);
        return json(await getList(env, user, type), 200, { ...cors, "Cache-Control": "no-store" });
      }
      if (url.pathname === "/details" || url.pathname === "/links") {
        const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
        if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => /^\d{1,9}$/.test(id))) {
          return json({ error: `ids must be 1 to ${MAX_IDS} numbers.` }, 400, cors);
        }
        const unique = [...new Set(ids)];
        const result = url.pathname === "/details"
          ? await getMany(env, type, unique, FIELDS[type], (node) => node)
          : await getMany(env, type, unique, `recommendations,related_${type}`, slimLinks(type));
        return json(result, 200, cors);
      }
      return json({ error: "Unknown endpoint." }, 404, cors);
    } catch (err) {
      const status = err.status || 502;
      // "mal": what MyAnimeList itself answered, so the page can keep an accurate record of slowdowns.
      return json({ error: err.message || "MyAnimeList could not be reached.", mal: err.mal }, status, cors);
    }
  },
};

/* ---------- reading ---------- */

async function getList(env, user, type, token) {
  const kind = type === "anime" ? "animelist" : "mangalist";
  const who = user === "@me" ? "@me" : encodeURIComponent(user);
  let next = `${MAL}/users/${who}/${kind}?limit=1000&nsfw=true&fields=${LIST_FIELDS[type]},${FIELDS[type]}`;
  const items = [];
  // A list of 1000 entries per page; 20 pages (20,000 entries) is far more than anyone has.
  for (let page = 0; next && page < 20; page++) {
    const data = await mal(env, next, { token });
    items.push(...(data.data || []));
    next = data.paging && data.paging.next;
  }
  return { user, type, items };
}

// Recommendations and related titles, trimmed to what the dashboard uses.
function slimLinks(type) {
  const pic = (n) => (n.main_picture && (n.main_picture.medium || n.main_picture.large)) || "";
  return (node) => ({
    id: node.id,
    recs: (node.recommendations || []).map((r) => [r.node.id, r.node.title, pic(r.node), r.num_recommendations || 0]),
    related: (node[`related_${type}`] || []).map((r) => [r.node.id, r.node.title, pic(r.node), r.relation_type]),
  });
}

// Looks up several titles one after another, so MAL never gets them all at once.
async function getMany(env, type, ids, fields, shape) {
  const items = [];
  for (const id of ids) {
    try {
      items.push(shape(await mal(env, `${MAL}/${type}/${id}?nsfw=true&fields=${fields}`)));
    } catch (err) {
      if (err.status === 404) { items.push({ id: Number(id), missing: true }); continue; } // removed from MAL
      throw err;
    }
  }
  return { type, items };
}

/* ---------- changing a list ---------- */

// Only known fields with sensible values are passed on to MAL (as a form, which MAL expects).
function checkChanges(type, changes) {
  if (!changes || typeof changes !== "object") return { error: "Nothing to change." };
  const rules = EDITABLE[type];
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(changes)) {
    const rule = rules[key];
    if (!rule) return { error: `${key} can't be changed here.` };
    if (Array.isArray(rule)) { if (!rule.includes(value)) return { error: `Unknown status ${value}.` }; body.set(key, value); }
    else if (rule === "0-10") { if (!Number.isInteger(value) || value < 0 || value > 10) return { error: "Scores go from 0 to 10." }; body.set(key, String(value)); }
    else if (rule === "count") { if (!Number.isInteger(value) || value < 0 || value > 100000) return { error: `${key} must be a whole number.` }; body.set(key, String(value)); }
    else if (rule === "bool") { if (typeof value !== "boolean") return { error: `${key} must be true or false.` }; body.set(key, String(value)); }
    else if (rule === "date") {
      if (value !== "" && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return { error: "Dates look like 2026-11-21." };
      body.set(key, value);
    }
  }
  if (![...body.keys()].length) return { error: "Nothing to change." };
  return { body };
}

/* ---------- signing in ---------- */

async function login(request, env, url) {
  const back = url.searchParams.get("return") || "";
  let returnTo;
  try { returnTo = new URL(back); } catch { return json({ error: "Missing return address." }, 400); }
  if (!ACCOUNT_ORIGINS.includes(returnTo.origin)) return json({ error: "That page can't sign in here." }, 403);
  if (!env.MAL_CLIENT_SECRET) return json({ error: "The relay has no MAL_CLIENT_SECRET secret yet." }, 500);
  // MAL only supports the "plain" PKCE method: the challenge is the verifier itself.
  const verifier = randomString(64);
  const state = randomString(24);
  const pending = await seal(env, { v: verifier, s: state, r: returnTo.origin + returnTo.pathname });
  const auth = new URL(`${MAL_AUTH}/authorize`);
  auth.search = new URLSearchParams({
    response_type: "code", client_id: env.MAL_CLIENT_ID, state,
    code_challenge: verifier, code_challenge_method: "plain", redirect_uri: `${url.origin}/auth/callback`,
  });
  // Lax: this cookie must come back when MAL sends the visitor to /auth/callback.
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": cookie("mald_pkce", pending, 600, "Lax", "/auth") } });
}

async function callback(request, env, url) {
  const pending = await unseal(env, readCookie(request, "mald_pkce"));
  const clearPending = cookie("mald_pkce", "", 0, "Lax", "/auth");
  const fallback = ACCOUNT_ORIGINS[0] + "/";
  const back = (to, outcome) => new Response(null, { status: 302, headers: [["Location", `${to}?signin=${outcome}`], ["Set-Cookie", clearPending]] });
  if (!pending) return back(fallback, "expired");
  if (url.searchParams.get("error")) return back(pending.r, "cancelled");
  if (url.searchParams.get("state") !== pending.s || !url.searchParams.get("code")) return back(pending.r, "failed");
  let tokens;
  try {
    tokens = await tokenRequest(env, {
      grant_type: "authorization_code", code: url.searchParams.get("code"),
      code_verifier: pending.v, redirect_uri: `${url.origin}/auth/callback`,
    });
  } catch {
    return back(pending.r, "failed");
  }
  // Remember who signed in, so later checks don't need to ask MAL.
  let me = null;
  try { me = await fetchMe(env, tokens.access_token); } catch { /* fetched later if needed */ }
  const session = await seal(env, { ...sessionFrom(tokens), m: me });
  return new Response(null, { status: 302, headers: [
    ["Location", `${pending.r}?signin=ok`], ["Set-Cookie", clearPending],
    ["Set-Cookie", cookie("mald_sess", session, SESSION_DAYS * 86400, "Strict")],
  ] });
}

// Reads the sign-in cookie; refreshes MAL's access key when it's about to expire.
async function getSession(request, env) {
  const s = await unseal(env, readCookie(request, "mald_sess"));
  if (!s || !s.a) return null;
  if (Date.now() < s.e - 60000) return { access: s.a, me: s.m || null, data: s };
  let tokens;
  try {
    tokens = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: s.r });
  } catch (err) {
    // MAL said the sign-in is no longer valid: signed out. Anything else (busy, slow): keep it and try later.
    if (err.status === 400 || err.status === 401) return null;
    return { access: s.a, me: s.m || null, data: s };
  }
  const fresh = { ...sessionFrom(tokens), m: s.m || null };
  return { access: fresh.a, me: fresh.m, data: fresh, setCookie: cookie("mald_sess", await seal(env, fresh), SESSION_DAYS * 86400, "Strict") };
}

async function tokenRequest(env, params) {
  const res = await fetch(`${MAL_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MAL_CLIENT_ID, client_secret: env.MAL_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Object.assign(new Error(`MyAnimeList refused the sign-in (${res.status}).`), { status: res.status });
  return res.json();
}

async function fetchMe(env, token) {
  const me = await mal(env, `${MAL}/users/@me?fields=id,name,picture`, { token });
  return { id: me.id, name: me.name, picture: me.picture || "" };
}

const sessionFrom = (t) => ({ a: t.access_token, r: t.refresh_token, e: Date.now() + (t.expires_in || 3600) * 1000 });

/* ---------- cookies (encrypted with a key derived from the Client Secret) ---------- */

function cookie(name, value, maxAge, sameSite, path = "/") {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}
function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
}
async function sealKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.MAL_CLIENT_SECRET}:anime-dashboard-session`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), new TextEncoder().encode(JSON.stringify(data)));
  const all = new Uint8Array(12 + enc.byteLength);
  all.set(iv); all.set(new Uint8Array(enc), 12);
  return b64url(all);
}
async function unseal(env, value) {
  if (!value || !env.MAL_CLIENT_SECRET) return null;
  try {
    const all = fromB64url(value);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await sealKey(env), all.slice(12));
    return JSON.parse(new TextDecoder().decode(dec));
  } catch {
    return null; // tampered with, or from an older key
  }
}
function randomString(n) {
  return b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n);
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/* ---------- talking to MAL ---------- */

/* ---------- request record ----------
   One log line per call to MyAnimeList (Cloudflare → the worker → Observability), to learn what makes MAL
   slow us down. Only the kind of call, MAL's answer and timings: no names, ids, tokens or addresses.
   "lastMin" counts calls made by this copy of the relay in the past minute (Cloudflare can run several copies,
   so the true total can be higher; the log's timestamps give the full picture). */
const recent = [];
function kindOf(url, method) {
  const p = new URL(url).pathname.replace(/^\/v2/, "");
  if (/^\/users\/@me$/.test(p)) return "me";
  if (/^\/users\/@me\/\w+list$/.test(p)) return "my-list";
  if (/^\/users\/[^/]+\/\w+list$/.test(p)) return "list";
  if (/\/my_list_status$/.test(p)) return method === "DELETE" ? "remove" : "edit";
  if (/^\/(anime|manga)\/\d+$/.test(p)) return /recommendations/.test(url) ? "links" : "details";
  return "other";
}
function record(url, method, status, ms, res) {
  const now = Date.now();
  recent.push(now);
  while (recent.length && now - recent[0] > 60000) recent.shift();
  const line = { mal: kindOf(url, method), status, ms, lastMin: recent.length };
  const retry = res && res.headers.get("Retry-After");
  if (retry) line.retryAfter = retry;
  console.log(JSON.stringify(line));
}

async function mal(env, url, { token, method = "GET", body } = {}) {
  let res;
  const t0 = Date.now();
  try {
    // Give up after 15 seconds instead of waiting forever when MAL stops answering.
    const headers = token ? { Authorization: `Bearer ${token}` } : { "X-MAL-CLIENT-ID": env.MAL_CLIENT_ID };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
  } catch {
    record(url, method, "timeout", Date.now() - t0);
    throw Object.assign(new Error("MyAnimeList took too long to answer. It may be busy or limiting requests; try again in a minute."), { status: 504, mal: "timeout" });
  }
  record(url, method, res.status, Date.now() - t0, res);
  if (res.ok) return method === "DELETE" ? {} : res.json();
  const messages = {
    400: "MyAnimeList rejected the request.",
    401: token ? "Your sign-in expired. Sign in again." : "The relay's MAL Client ID is not valid.",
    403: "This list is private, or MyAnimeList is limiting requests. Try the XML upload instead.",
    404: token && method !== "GET" ? "That title isn't on your list." : "No MyAnimeList user with that name.",
    429: "MyAnimeList is limiting requests. Wait a minute and try again.",
  };
  throw Object.assign(new Error(messages[res.status] || `MyAnimeList answered with error ${res.status}.`), {
    status: res.status >= 500 ? 502 : res.status,
    mal: res.status,
  });
}

function corsHeaders(origin, account) {
  if (!(account ? ACCOUNT_ORIGINS : ALLOWED_ORIGINS).includes(origin)) return { Vary: "Origin" };
  const h = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", Vary: "Origin" };
  if (account) Object.assign(h, {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  return h;
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
