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
    members: n.num_list_users || 0,
  };
}

function makeEntry(base) {
  const e = Object.assign({
    id: 0, kind: "anime", title: "", titleEn: "", image: "", imageLarge: "", mediaType: "",
    genres: [], creators: [], year: null, season: "", mean: null, airStatus: "", airStart: "",
    total: 0, totalVol: 0, duration: 0, nsfw: "white", members: 0,
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

MALD.relayReady = () => !!(window.MALD_CONFIG && window.MALD_CONFIG.relay);

async function relay(path, params) {
  const base = ((window.MALD_CONFIG && window.MALD_CONFIG.relay) || "").replace(/\/+$/, "");
  if (!base) throw new Error("Live loading isn't set up on this site yet. You can still upload an XML export.");
  let res;
  try {
    res = await fetch(`${base}${path}?${new URLSearchParams(params)}`);
  } catch {
    throw new Error("Couldn't reach the relay. Check your connection and try again.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error((body && body.error) || `The relay answered with error ${res.status}.`);
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

const DETAILS_TTL = 14 * 24 * 3600 * 1000;
function detailsCache(kind) {
  try { return JSON.parse(localStorage.getItem(`mald:details:${kind}`)) || {}; } catch { return {}; }
}
function saveDetailsCache(kind, cache) {
  try { localStorage.setItem(`mald:details:${kind}`, JSON.stringify(cache)); } catch { /* storage full or blocked */ }
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
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
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

MALD.save = function (data) {
  try { localStorage.setItem("mald:last", JSON.stringify(data)); } catch { /* storage full or blocked */ }
};
MALD.loadSaved = function () {
  let data = null;
  try { data = JSON.parse(localStorage.getItem("mald:last")); } catch { /* ignore */ }
  if (data && !(Date.now() - data.fetchedAt < KEEP_LIST)) { MALD.forget(); return null; }
  return data;
};
// Removes the saved list and all cached title details from this browser.
MALD.forget = function () {
  try {
    ["mald:last", "mald:details:anime", "mald:details:manga", "mald:links:anime", "mald:links:manga"].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
};
MALD.pruneDetails = function () {
  const now = Date.now();
  for (const kind of ["anime", "manga"]) {
    const cache = detailsCache(kind);
    let changed = false;
    for (const id in cache) if (!(now - cache[id][0] < DETAILS_TTL)) { delete cache[id]; changed = true; }
    if (changed) saveDetailsCache(kind, cache);
    const links = MALD.readCache(`mald:links:${kind}`);
    let linksChanged = false;
    for (const id in links) if (!(now - links[id][0] < MALD.LINKS_TTL)) { delete links[id]; linksChanged = true; }
    if (linksChanged) MALD.writeCache(`mald:links:${kind}`, links);
  }
};

/* ---------- shared with recs.js ---------- */

MALD.relay = relay;
MALD.detailsFromNode = detailsFromNode;
MALD.makeEntry = makeEntry;
MALD.DETAILS_TTL = DETAILS_TTL;
MALD.LINKS_TTL = 7 * 24 * 3600 * 1000;
MALD.readCache = (key) => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
MALD.writeCache = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } };
