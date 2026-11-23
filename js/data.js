// Loading MyAnimeList data: live through the relay, or from an XML export.
// Every entry, from either source, is turned into the same plain object (see makeEntry).
"use strict";
const MALD = (window.MALD = window.MALD || {});

// Order used for colors and stacked bars (checked for colorblind separation).
MALD.STATUS_ORDER = ["completed", "current", "on_hold", "planned", "dropped"];
// Order used for filters and lists.
MALD.STATUS_UI = ["current", "completed", "on_hold", "dropped", "planned"];
MALD.statusLabel = (s, kind) => ({
  current: kind === "manga" ? "Reading" : "Watching",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  planned: kind === "manga" ? "Plan to read" : "Plan to watch",
})[s] || s;

const TYPE_LABELS = {
  tv: "TV", movie: "Movie", ova: "OVA", ona: "ONA", special: "Special", tv_special: "TV Special",
  music: "Music", cm: "CM", pv: "PV", unknown: "Unknown", manga: "Manga", novel: "Novel",
  light_novel: "Light Novel", one_shot: "One-shot", doujinshi: "Doujinshi", manhwa: "Manhwa",
  manhua: "Manhua", oel: "OEL",
};
// MAL's age ratings for anime.
MALD.RATING_LABELS = {
  g: "G · All ages", pg: "PG · Children", pg_13: "PG-13 · Teens 13 or older", r: "R · 17+ (violence and profanity)",
  "r+": "R+ · Mild nudity", rx: "Rx · Hentai",
};

MALD.AIR_LABELS = {
  finished_airing: "Finished airing", currently_airing: "Airing now", not_yet_aired: "Not yet aired",
  finished: "Finished", currently_publishing: "Publishing", not_yet_published: "Not yet published",
  on_hiatus: "On hiatus", discontinued: "Discontinued",
};
const API_STATUS = {
  watching: "current", reading: "current", completed: "completed", on_hold: "on_hold",
  dropped: "dropped", plan_to_watch: "planned", plan_to_read: "planned",
};
const XML_STATUS = {
  watching: "current", reading: "current", completed: "completed", "on-hold": "on_hold", "on hold": "on_hold",
  dropped: "dropped", "plan to watch": "planned", "plan to read": "planned",
  1: "current", 2: "completed", 3: "on_hold", 4: "dropped", 6: "planned",
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// Fields that describe the title itself (same for everyone).
function detailsFromNode(n, kind) {
  const pic = n.main_picture || {};
  const alt = n.alternative_titles || {};
  const season = n.start_season;
  const year = season ? season.year : n.start_date ? Number(String(n.start_date).slice(0, 4)) : null;
  const creators = kind === "anime"
    ? (n.studios || []).map((s) => s.name)
    : (n.authors || []).map((a) => [a.node && a.node.first_name, a.node && a.node.last_name].filter(Boolean).join(" ")).filter(Boolean);
  return {
    title: n.title || "",
    titleEn: alt.en || "",
    image: pic.medium || pic.large || "",
    imageLarge: pic.large || pic.medium || "",
    mediaType: TYPE_LABELS[n.media_type] || n.media_type || "",
    genres: (n.genres || []).map((g) => g.name),
    creators,
    year: year || null,
    season: season ? `${cap(season.season)} ${season.year}` : "",
    mean: n.mean || null,
    airStatus: n.status || "",
    airStart: n.start_date || "",
    total: (kind === "anime" ? n.num_episodes : n.num_chapters) || 0,
    totalVol: kind === "manga" ? n.num_volumes || 0 : 0,
    duration: n.average_episode_duration || 0, // seconds per episode
    nsfw: n.nsfw || "white",
    rating: n.rating || "", // anime age rating: g, pg, pg_13, r, r+, rx (MAL has none for manga)
    members: n.num_list_users || 0,
  };
}

function makeEntry(base) {
  const e = Object.assign({
    id: 0, kind: "anime", title: "", titleEn: "", image: "", imageLarge: "", mediaType: "",
    genres: [], creators: [], year: null, season: "", mean: null, airStatus: "", airStart: "",
    total: 0, totalVol: 0, duration: 0, nsfw: "white", rating: "", members: 0,
    status: "planned", score: 0, progress: 0, progressVol: 0, repeating: false, timesRepeated: 0,
    myStart: "", myFinish: "", updatedAt: "", enriched: false,
  }, base);
  // MAL keeps rewatches and rereads as "completed"; show them with what you're watching, like MAL does.
  if (e.repeating && e.status === "completed") e.status = "current";
  return e;
}

function entryFromApi(item, kind) {
  const n = item.node || {};
  const ls = item.list_status || {};
  return makeEntry(Object.assign({ id: n.id, kind }, detailsFromNode(n, kind), {
    status: API_STATUS[ls.status] || "planned",
    score: ls.score || 0,
    progress: (kind === "anime" ? ls.num_episodes_watched : ls.num_chapters_read) || 0,
    progressVol: ls.num_volumes_read || 0,
    repeating: !!(ls.is_rewatching || ls.is_rereading),
    timesRepeated: ls.num_times_rewatched || ls.num_times_reread || 0,
    myStart: ls.start_date || "",
    myFinish: ls.finish_date || "",
    updatedAt: ls.updated_at || "",
    enriched: true,
  }));
}

/* ---------- relay ---------- */

MALD.RELAY_TIMEOUT = 60000; // ms before giving up on the relay

MALD.relayReady = () => !!(window.MALD_CONFIG && window.MALD_CONFIG.relay);

/* ---------- one line for MyAnimeList ----------
   Every request that reaches MyAnimeList (through the relay) waits its turn here, one at a time.
   MAL doesn't publish its limits, so this spends a budget: up to BURST requests at once, then one every RATE ms.
   Priority decides who goes first: 0 = something you did (load a list, open your list, edit), which never waits
   for the budget; 1 = Next up while you wait for it; 2 = background checks.
   A group (such as "next:anime") can be paused: its requests stay in line until it's resumed. */
// Tuned from a real slowdown: MAL stopped answering after ~80 requests in a minute (a burst of 25, then 1 per second
// after minutes at that rate). So: at most 10 at once, then one every 1.5 s (about 40 a minute), slower after a slowdown.
const net = { BURST: 10, RATE: 1500, queue: [], paused: new Set(), tokens: 10, at: Date.now(), busy: false, seq: 0, wake: null };
const BUDGET_KEY = "mald:budget"; // shared by reloads and other tabs, so none of them starts with a fresh burst
const LOG_KEY = "mald:netlog";
const LOG_MAX = 400;

// After a slowdown the whole line slows down too (the pace is set in recs.js).
const rate = () => Math.max(net.RATE, (MALD.pace && MALD.pace.get().pause) || 0);
function refill() {
  const now = Date.now();
  try {
    const b = JSON.parse(localStorage.getItem(BUDGET_KEY));
    if (b && b.at > net.at && b.at <= now) { net.tokens = b.tokens; net.at = b.at; } // another tab spent some
  } catch { /* ignore */ }
  net.tokens = Math.min(net.BURST, net.tokens + (now - net.at) / rate());
  net.at = now;
}
function spend(cost) {
  net.tokens -= cost;
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify({ tokens: net.tokens, at: net.at })); } catch { /* ignore */ }
}

async function pump() {
  if (net.busy) return;
  net.busy = true;
  try {
    for (;;) {
      const ready = net.queue.filter((j) => !net.paused.has(j.group));
      if (!ready.length) break;
      ready.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const job = ready[0];
      refill();
      const need = Math.min(job.cost, net.BURST);
      if (job.priority > 0 && net.tokens < need) {
        // Wait for the budget, but wake early if something more urgent arrives (or a group is paused/resumed).
        await new Promise((r) => { net.wake = r; setTimeout(r, Math.ceil((need - net.tokens) * rate())); });
        net.wake = null;
        continue;
      }
      net.queue.splice(net.queue.indexOf(job), 1);
      spend(job.cost);
      const t0 = Date.now();
      try {
        job.resolve(await job.work());
        logRequest(job, t0, "ok");
      } catch (err) {
        logRequest(job, t0, err.mal || err.status || "error");
        job.reject(err);
      }
    }
  } finally {
    net.busy = false;
  }
}
const nudge = () => { if (net.wake) net.wake(); pump(); };

// A short record of recent requests (kept in this browser), to see what leads up to a MAL slowdown.
function logRequest(job, t0, result) {
  if (!job.cost) return;
  const now = Date.now();
  const log = MALD.readNetLog();
  log.push([t0, job.what, job.cost, job.priority, t0 - job.queued, now - t0, result]);
  store(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
}
MALD.readNetLog = () => { try { const l = JSON.parse(localStorage.getItem(LOG_KEY)); return Array.isArray(l) ? l : []; } catch { return []; } };
MALD.netLogText = function () {
  const rows = MALD.readNetLog().map(([t, what, cost, pr, waited, ms, result]) =>
    [new Date(t).toISOString().slice(11, 19), what, cost, pr, waited, ms, result].join("\t"));
  const pace = MALD.readCache("mald:pace");
  return [`Anime Dashboard request log · ${new Date().toISOString()} · ${navigator.userAgent}`,
    MALD.storageUse(),
    `budget ${net.BURST} at once, then 1 every ${rate()} ms · background pause ${pace.pause || MALD.REQ_PAUSE} ms per title`,
    "time (UTC)\twhat\tMAL requests\tpriority\twaited ms\ttook ms\tresult", ...rows].join("\n");
};

MALD.net = {
  // Runs work() when it's its turn. cost: how many MAL requests it makes (0 = none, skips the budget).
  run(work, { cost = 1, priority = 0, group = null, what = "" } = {}) {
    return new Promise((resolve, reject) => {
      net.queue.push({ work, cost, priority, group, what, resolve, reject, seq: net.seq++, queued: Date.now() });
      nudge();
    });
  },
  pause(group) { net.paused.add(group); },
  resume(group) { if (net.paused.delete(group)) nudge(); },
  // Drops a group's waiting requests (its results are no longer wanted).
  cancel(group) {
    const gone = net.queue.filter((j) => j.group === group);
    net.queue = net.queue.filter((j) => j.group !== group);
    net.paused.delete(group);
    gone.forEach((j) => j.reject(Object.assign(new Error("Cancelled."), { cancelled: true })));
  },
  waiting: (group) => net.queue.some((j) => j.group === group),
  config: net,
};

// What a relay call costs in MAL requests: one per title looked up; a list is a page or two.
function costOf(path, params) {
  if (path === "/details" || path === "/links") return String(params.ids || "").split(",").filter(Boolean).length;
  return 1;
}

function relay(path, params, { priority = 0, group = null } = {}) {
  const what = path.slice(1) + (params.type ? `:${params.type}` : "");
  return MALD.net.run(() => relayNow(path, params), { cost: costOf(path, params), priority, group, what });
}

async function relayNow(path, params) {
  const base = ((window.MALD_CONFIG && window.MALD_CONFIG.relay) || "").replace(/\/+$/, "");
  if (!base) throw new Error("Live loading isn't set up on this site yet. You can still upload an XML export.");
  let res;
  // Give up after a minute instead of waiting forever (MAL sometimes stops answering when it's busy).
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), MALD.RELAY_TIMEOUT);
  try {
    res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { signal: stop.signal });
  } catch {
    throw Object.assign(new Error(stop.signal.aborted
      ? "MyAnimeList took too long to answer. It may be busy or limiting requests; try again in a minute."
      : "Couldn't reach the relay. Check your connection and try again."), { mal: stop.signal.aborted ? "timeout" : "offline" });
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error((body && body.error) || `The relay answered with error ${res.status}.`), { status: res.status, mal: body && body.mal });
  return body;
}

MALD.loadLive = async function (user) {
  const kinds = ["anime", "manga"];
  const results = await Promise.allSettled(kinds.map((type) => relay("/list", { user, type })));
  if (results.every((r) => r.status === "rejected")) throw results[0].reason;
  const out = { user, source: "live", fetchedAt: Date.now(), anime: null, manga: null, notes: [] };
  results.forEach((r, i) => {
    const kind = kinds[i];
    if (r.status === "fulfilled") out[kind] = r.value.items.map((it) => entryFromApi(it, kind));
    else out.notes.push(`The ${kind} list couldn't be loaded: ${r.reason.message}`);
  });
  return out;
};

/* ---------- XML export ---------- */

async function isGzip(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

MALD.readExportFile = async function (file) {
  let text;
  if (await isGzip(file)) {
    if (!("DecompressionStream" in window)) throw new Error("This browser can't open .gz files. Unzip it first, then upload the .xml.");
    text = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  } else {
    text = await file.text();
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || !root || root.nodeName !== "myanimelist") {
    throw new Error(`${file.name} isn't a MyAnimeList export.`);
  }
  const get = (el, tag) => {
    const t = el.getElementsByTagName(tag)[0];
    return t ? t.textContent.trim() : "";
  };
  const date = (s) => (!s || s.startsWith("0000") ? "" : s.replace(/-00/g, ""));
  const num = (s) => Number(s) || 0;
  const status = (s) => XML_STATUS[s.toLowerCase()] || "planned";
  const info = root.getElementsByTagName("myinfo")[0];
  const user = info ? get(info, "user_name") : "";
  const exportType = info ? get(info, "user_export_type") : "";
  const children = [...root.children];

  const anime = children.filter((e) => e.nodeName === "anime").map((el) => makeEntry({
    id: num(get(el, "series_animedb_id")), kind: "anime",
    title: get(el, "series_title"), mediaType: get(el, "series_type"),
    total: num(get(el, "series_episodes")),
    status: status(get(el, "my_status")), score: num(get(el, "my_score")),
    progress: num(get(el, "my_watched_episodes")),
    repeating: get(el, "my_rewatching") === "1", timesRepeated: num(get(el, "my_times_watched")),
    myStart: date(get(el, "my_start_date")), myFinish: date(get(el, "my_finish_date")),
  }));
  const manga = children.filter((e) => e.nodeName === "manga").map((el) => makeEntry({
    id: num(get(el, "manga_mangadb_id")), kind: "manga",
    title: get(el, "manga_title"),
    total: num(get(el, "manga_chapters")), totalVol: num(get(el, "manga_volumes")),
    status: status(get(el, "my_status")), score: num(get(el, "my_score")),
    progress: num(get(el, "my_read_chapters")), progressVol: num(get(el, "my_read_volumes")),
    repeating: get(el, "my_rereading") === "1",
    timesRepeated: num(get(el, "my_times_read")),
    myStart: date(get(el, "my_start_date")), myFinish: date(get(el, "my_finish_date")),
  }));
  return {
    user,
    anime: anime.length || exportType === "1" ? anime.filter((e) => e.id) : null,
    manga: manga.length || exportType === "2" ? manga.filter((e) => e.id) : null,
  };
};

/* ---------- adding covers, genres, etc. to XML entries ---------- */

const DETAILS_TTL = 30 * 24 * 3600 * 1000; // title details are re-checked monthly
function detailsCache(kind) {
  try { return JSON.parse(localStorage.getItem(`mald:details:${kind}`)) || {}; } catch { return {}; }
}
function saveDetailsCache(kind, cache) {
  MALD.writeCache(`mald:details:${kind}`, cache);
}

function applyDetails(e, d) {
  if (!d || d.missing) { e.enriched = true; return; }
  const keepTotal = e.total;
  Object.assign(e, d, { title: d.title || e.title, mediaType: d.mediaType || e.mediaType });
  if (!d.total) e.total = keepTotal;
  e.enriched = true;
}

// Fills in details for entries that don't have them. Calls onProgress(done, total) as it goes.
MALD.enrich = async function (entries, kind, onProgress) {
  const cache = detailsCache(kind);
  const now = Date.now();
  const todo = [];
  for (const e of entries) {
    if (e.enriched) continue;
    const hit = cache[e.id];
    if (hit && now - hit[0] < DETAILS_TTL) applyDetails(e, hit[1]);
    else todo.push(e);
  }
  if (!todo.length) return null;
  if (!MALD.relayReady()) return "Covers and genres need the relay, which isn't set up on this site yet.";
  const byId = new Map(todo.map((e) => [e.id, e]));
  const ids = [...byId.keys()];
  let done = 0;
  try {
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const res = await relay("/details", { type: kind, ids: chunk.join(",") });
      for (const node of res.items) {
        const d = node.missing ? { missing: true } : detailsFromNode(node, kind);
        cache[node.id] = [now, d];
        applyDetails(byId.get(node.id), d);
      }
      done += chunk.length;
      if (onProgress) onProgress(done, ids.length);
    }
  } catch (err) {
    saveDetailsCache(kind, cache);
    return `Some details couldn't be added: ${err.message}`;
  }
  saveDetailsCache(kind, cache);
  return null;
};

/* ---------- saving between visits ---------- */

// MAL's API terms allow keeping data in the browser only as long as reasonably needed,
// so a saved list is dropped 30 days after it was loaded, and old title details are pruned.
const KEEP_LIST = 30 * 24 * 3600 * 1000;

// The last list viewed. When it's your own (signed in), it's kept once, under "mald:mine", and only pointed to here.
MALD.save = function (data) {
  const value = data && data.source === "mine" ? { ref: "mine", fetchedAt: data.fetchedAt } : data;
  store("mald:last", JSON.stringify(value));
};
MALD.loadSaved = function () {
  let data = null;
  try { data = JSON.parse(localStorage.getItem("mald:last")); } catch { /* ignore */ }
  if (data && data.ref === "mine") return MALD.loadMine();
  if (data && !(Date.now() - data.fetchedAt < KEEP_LIST)) { try { localStorage.removeItem("mald:last"); } catch { /* ignore */ } return null; }
  return data;
};
// Your own list (signed in), kept separately so switching between yours and someone else's is instant.
MALD.saveMine = function (data) {
  try {
    if (data) store("mald:mine", JSON.stringify(data)); else localStorage.removeItem("mald:mine");
  } catch { /* storage full or blocked */ }
};
MALD.loadMine = function () {
  let data = null;
  try { data = JSON.parse(localStorage.getItem("mald:mine")); } catch { /* ignore */ }
  if (data && !(Date.now() - data.fetchedAt < KEEP_LIST)) { MALD.saveMine(null); return null; }
  return data;
};
// Removes the saved list and all cached title details from this browser.
MALD.forget = function () {
  try {
    ["mald:last", "mald:mine", "mald:me", "mald:details:anime", "mald:details:manga", "mald:links:anime", "mald:links:manga", "mald:pace", "mald:fullsweep", "mald:netlog", "mald:budget", "mald:related:anime", "mald:related:manga"].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
};
MALD.pruneDetails = function () {
  const now = Date.now();
  try { localStorage.removeItem("mald:fullsweep"); } catch { /* ignore */ }
  for (const kind of ["anime", "manga"]) {
    const cache = detailsCache(kind);
    let changed = false;
    for (const id in cache) if (!(now - cache[id][0] < 2 * DETAILS_TTL)) { delete cache[id]; changed = true; }
    if (changed) saveDetailsCache(kind, cache);
    const links = MALD.readCache(`mald:links:${kind}`);
    let linksChanged = false;
    // Checks older than a month are refreshed in the background but still used meanwhile; after 60 days they're dropped.
    for (const id in links) if (!(now - links[id][0] < 2 * MALD.LINKS_TTL)) { delete links[id]; linksChanged = true; }
    if (linksChanged) MALD.writeCache(`mald:links:${kind}`, links);
  }
};

/* ---------- shared with recs.js ---------- */

MALD.relay = relay;
MALD.relayDirect = relayNow; // for calls that never reach MAL (tags): no need to wait in its line
MALD.entryFromApi = entryFromApi;
MALD.detailsFromNode = detailsFromNode;
MALD.makeEntry = makeEntry;
MALD.DETAILS_TTL = DETAILS_TTL;
MALD.LINKS_TTL = 30 * 24 * 3600 * 1000; // sequel checks are refreshed monthly
MALD.readCache = (key) => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
// Saves a cache. If the browser's storage is still full after making room, the cache itself keeps
// its newer half (its entries are [savedAt, value]), so what's kept is the most recent.
MALD.writeCache = (key, value) => {
  if (store(key, JSON.stringify(value)) || !PRUNABLE.includes(key) || !value || typeof value !== "object") return;
  dropOldestHalf(value);
  if (store(key, JSON.stringify(value))) MALD.storageFull = false; // saved after all (its newer half)
};

/* ---------- saving to the browser without silently failing ----------
   Browsers give a site about 5 MB. A big list plus title details can get close, and a failed save used to go
   unnoticed (and then everything was fetched from MyAnimeList again). Now, when storage is full, the oldest
   half of what can be fetched again (title details, related titles, sequel checks, older log rows) is dropped,
   and the save is tried once more. Lists are never dropped this way. */
const PRUNABLE = ["mald:related:anime", "mald:related:manga", "mald:details:anime", "mald:details:manga", "mald:links:anime", "mald:links:manga"];
const isFull = (err) => err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22 || err.code === 1014);
function dropOldestHalf(obj) {
  const ids = Object.keys(obj).sort((a, b) => ((obj[a] && obj[a][0]) || 0) - ((obj[b] && obj[b][0]) || 0));
  ids.slice(0, Math.ceil(ids.length / 2)).forEach((id) => delete obj[id]);
}
function makeRoom(except) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(MALD.readNetLog().slice(-100))); } catch { /* ignore */ }
  for (const key of PRUNABLE) {
    if (key === except) continue;
    let obj = null;
    try { obj = JSON.parse(localStorage.getItem(key)); } catch { /* ignore */ }
    if (!obj || typeof obj !== "object") continue;
    dropOldestHalf(obj);
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* ignore */ }
  }
  MALD.storageTrims = (MALD.storageTrims || 0) + 1;
}
function store(key, text) {
  try { localStorage.setItem(key, text); return true; } catch (err) { if (!isFull(err)) return false; }
  makeRoom(key);
  try { localStorage.setItem(key, text); return true; } catch { MALD.storageFull = true; return false; }
}
// How much this site keeps in the browser, by kind (for the request log).
MALD.storageUse = function () {
  const groups = {};
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const bytes = (k.length + (localStorage.getItem(k) || "").length) * 2; // stored as UTF-16
      total += bytes;
      const g = k.startsWith("mald:") ? k.slice(5).split(":")[0] : "other";
      groups[g] = (groups[g] || 0) + bytes;
    }
  } catch { /* ignore */ }
  const mb = (n) => (n / 1048576).toFixed(2) + " MB";
  return `storage ${mb(total)} (` + Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${mb(n)}`).join(", ") + ")" +
    (MALD.storageTrims ? ` · made room ${MALD.storageTrims}×` : "") + (MALD.storageFull ? " · FULL" : "");
};
