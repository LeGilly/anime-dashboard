// Anime Dashboard, part 1 of 5: shared state and helpers, and the Library, Progress and Stats views.
// The other ui-*.js files add their parts to MALD.ui; ui-main.js starts everything. Load order: see index.html.
"use strict";
(function () {
  const MALD = window.MALD;
  const U = (MALD.ui = {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PAGE = 120;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const S = {
    data: null,
    kind: "anime",
    tab: "library",
    lib: { status: "all", q: "", type: "", genre: "", creator: "", year: "", sort: "score", view: "grid", shown: PAGE },
    queueSort: "mean",
    groupMode: { genres: "count", creators: "count" },
    expand: { quiet: false, hold: false, queue: false },
    groupAll: { genres: false, creators: false },
    histMetric: "count",
    histYear: null,
    // Genres and lengths remember what's unticked, so everything starts ticked.
    next: { source: "both", genresOff: [], matchAll: false, excludes: [], lengthsOff: [], airing: false, shown: 12, contShown: 6, soonShown: 6 },
    openMulti: null,
    msearch: {},
    recData: {},
    recPool: new Map(),
    relPool: new Map(),   // related titles opened from a detail panel (not on the list being viewed)
    searchPool: new Map(), // titles found with Search, by "kind:id"
    browse: { mode: "search", q: "", rank: "all", year: 0, season: "", sort: "members", type: "", hideListed: false, results: new Map() },
    detailId: null,       // title shown in the detail panel
    detailTrail: [],      // titles you came from, through "Related", for the Back button
    prefs: { english: false, blur: true },
    busy: false,
  };
  try { Object.assign(S.prefs, JSON.parse(localStorage.getItem("mald:prefs")) || {}); } catch { /* ignore */ }
  const savePrefs = () => { try { localStorage.setItem("mald:prefs", JSON.stringify(S.prefs)); } catch { /* ignore */ } };

  /* ---------- helpers ---------- */

  const list = () => (S.data && S.data[S.kind]) || null;
  const titleOf = (e) => (S.prefs.english && e.titleEn ? e.titleEn : e.title);
  const unitName = (n) => (S.kind === "manga" ? (n === 1 ? "chapter" : "chapters") : n === 1 ? "episode" : "episodes");
  const malUrl = (e) => `https://myanimelist.net/${e.kind}/${e.id}`;
  // MAL marks hentai as "gray" (not only "black"), so blur anything not marked safe, plus Hentai or Erotica genres.
  const hidden18 = (e) => S.prefs.blur && MALD.isAdult(e);
  const A = MALD.account;
  // Editing only on your own list, while signed in.
  const canEdit = () => !!(A.me && S.data && S.data.source === "mine");
  // Whose list is on screen, for wording: "your" unless you're signed in and browsing someone else's.
  const owner = () => (A.me && S.data && S.data.source !== "mine" ? "their" : "your");
  let toastTimer;
  function toast(text, kind) {
    const t = $("toast");
    t.textContent = text;
    t.className = kind || "";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind === "warn" ? 6000 : 2500);
  }
  const plusBtn = (e) => `<button type="button" class="plus1" data-plus="${e.id}" title="+1 ${e.kind === "manga" ? "chapter" : "episode"}" aria-label="+1 ${e.kind === "manga" ? "chapter" : "episode"} for ${esc(titleOf(e))}">+1</button>`;
  const statusText = (e) => (e.repeating ? (e.kind === "manga" ? "Rereading" : "Rewatching") : MALD.statusLabel(e.status, e.kind));

  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = "sub" + (kind ? " " + kind : "");
  }

  // The page's security rules forbid inline styles, so sizes are set here after drawing.
  function applySizes(root) {
    root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = el.dataset.w + "%"; });
    root.querySelectorAll("[data-h]").forEach((el) => { el.style.height = el.dataset.h + "%"; });
  }

  function cover(e, cls) {
    if (!e.image) return `<span class="${cls} noimg" aria-hidden="true">${esc(titleOf(e).slice(0, 1))}</span>`;
    return `<img class="${cls}${hidden18(e) ? " nsfw" : ""}" src="${esc(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }

  function progressText(e) {
    const total = e.total || "?";
    return `${e.progress}/${total}`;
  }

  function pct(e) {
    if (!e.total) return e.status === "completed" ? 100 : 0;
    return Math.min(100, (e.progress / e.total) * 100);
  }

  /* ---------- top-level ---------- */

  function show(data) {
    S.data = data;
    S.recData = {};
    if (!data[S.kind] && data[S.kind === "anime" ? "manga" : "anime"]) S.kind = S.kind === "anime" ? "manga" : "anime";
    S.lib.shown = PAGE;
    $("loader").hidden = true;
    $("app").hidden = false;
    $("who").textContent = data.user || "Your list";
    const from = data.source === "mine" ? "Your list (signed in)" : data.source === "live" ? (A.me ? "Viewing someone else's list" : "Live from MAL") : "From XML export";
    $("whoMeta").textContent = from + " · updated " + MALD.fmtAgo(data.fetchedAt);
    $("refreshBtn").textContent = data.source === "xml" ? "Upload newer" : "Refresh";
    $("mineBtn").hidden = !(A.me && data.source !== "mine");
    U.updateAccount();
    if (data.notes && data.notes.length) setStatus(data.notes.join(" "), "warn");
    else setStatus(`${MALD.fmtNum((data.anime || []).length)} anime · ${MALD.fmtNum((data.manga || []).length)} manga`);
    syncUrl();
    render();
  }

  // The address mirrors what you're looking at (user, manga, tab), so a link or a reload lands on the same view.
  // Opening the plain address starts on the Library.
  function syncUrl() {
    const p = new URLSearchParams();
    if (S.data && S.data.source !== "xml") p.set("user", S.data.user);
    if (S.kind !== "anime") p.set("kind", S.kind);
    if (S.tab !== "library") p.set("tab", S.tab);
    const q = p.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
  }

  function render() {
    U.syncNet();
    const seg = $("kindSeg");
    seg.querySelectorAll("button").forEach((b) => {
      const k = b.dataset.kind;
      const n = S.data[k] ? S.data[k].length : 0;
      b.setAttribute("aria-pressed", String(k === S.kind));
      b.querySelector("small").textContent = S.data[k] ? MALD.fmtNum(n) : "–";
    });
    $("tabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    const view = $("view");
    const entries = list();
    if (S.tab === "search") { U.renderSearch(view); return; } // works even when this list is empty
    if (!entries || !entries.length) {
      const what = S.kind === "manga" ? "manga" : "anime";
      view.innerHTML = `<div class="empty"><p><strong>No ${what} on this list${entries ? " yet" : ""}.</strong></p>${
        !entries && S.data.source === "xml" ? `<p>Upload your ${what} export file to see it here.</p>` : ""}</div>`;
      return;
    }
    if (S.tab === "library") renderLibrary(view, entries);
    else if (S.tab === "progress") renderProgress(view, entries);
    else if (S.tab === "next") U.renderNext(view, entries);
    else renderStats(view, entries);
    applySizes(view);
  }

  /* ---------- Library ---------- */

  function options(values, current, allLabel) {
    return `<option value="">${esc(allLabel)}</option>` + values.map((v) =>
      `<option value="${esc(v)}"${String(v) === String(current) ? " selected" : ""}>${esc(v)}</option>`).join("");
  }
  function countSorted(entries, pick) {
    const m = new Map();
    for (const e of entries) for (const v of pick(e)) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map((x) => x[0]);
  }

  function filtered(entries) {
    const L = S.lib;
    const q = L.q.trim().toLowerCase();
    const out = entries.filter((e) =>
      (L.status === "all" || e.status === L.status) &&
      (!L.type || e.mediaType === L.type) &&
      (!L.genre || e.genres.includes(L.genre)) &&
      (!L.creator || e.creators.includes(L.creator)) &&
      (!L.year || String(e.year) === L.year) &&
      (!q || e.title.toLowerCase().includes(q) || e.titleEn.toLowerCase().includes(q)));
    const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b));
    const sorts = {
      score: (a, b) => b.score - a.score || (b.mean || 0) - (a.mean || 0) || byTitle(a, b),
      updated: (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || byTitle(a, b),
      title: byTitle,
      mean: (a, b) => (b.mean || 0) - (a.mean || 0) || byTitle(a, b),
      year: (a, b) => (b.airStart || String(b.year || "")).localeCompare(a.airStart || String(a.year || "")) || byTitle(a, b),
      members: (a, b) => b.members - a.members || byTitle(a, b),
    };
    return out.sort(sorts[L.sort] || sorts.score);
  }

  function renderLibrary(view, entries) {
    const L = S.lib;
    const counts = MALD.summary(entries).byStatus;
    const hasUpdated = entries.some((e) => e.updatedAt);
    const hasDetails = entries.some((e) => e.genres.length);
    const items = filtered(entries);
    const shown = items.slice(0, L.shown);
    const creatorLabel = S.kind === "anime" ? "All studios" : "All authors";
    const years = [...new Set(entries.map((e) => e.year).filter(Boolean))].sort((a, b) => b - a);

    const chips = [`<button class="chip" data-status="all" aria-pressed="${L.status === "all"}">All <small>${MALD.fmtNum(entries.length)}</small></button>`]
      .concat(MALD.STATUS_UI.map((s) => `<button class="chip" data-status="${s}" aria-pressed="${L.status === s}"><i class="dot st-${s}"></i>${esc(MALD.statusLabel(s, S.kind))} <small>${MALD.fmtNum(counts[s] || 0)}</small></button>`))
      .join("");

    const sortOpts = [["score", "Your score"], ["mean", "MAL score"], ["title", "Title"], ["year", "Newest"], ["members", "Most popular"]]
      .concat(hasUpdated ? [["updated", "Last updated"]] : [])
      .map(([v, t]) => `<option value="${v}"${L.sort === v ? " selected" : ""}>${t}</option>`).join("");

    let body;
    if (!items.length) body = `<div class="empty"><p>Nothing matches these filters.</p><button class="ghost" data-act="clear">Clear filters</button></div>`;
    else if (L.view === "grid") body = `<div class="grid">${shown.map(tile).join("")}</div>`;
    else body = `<div class="rows" role="table">${shown.map(row).join("")}</div>`;

    view.innerHTML = `
      <div class="chips" id="statusChips">${chips}</div>
      <div class="filters">
        <input type="search" id="q" placeholder="Search titles…" value="${esc(L.q)}" aria-label="Search titles">
        <select id="fType" aria-label="Type">${options(countSorted(entries, (e) => [e.mediaType]), L.type, "All types")}</select>
        ${hasDetails ? `<select id="fGenre" aria-label="Genre">${options(countSorted(entries, (e) => e.genres), L.genre, "All genres")}</select>
        <select id="fCreator" aria-label="${S.kind === "anime" ? "Studio" : "Author"}">${options(countSorted(entries, (e) => e.creators), L.creator, creatorLabel)}</select>` : ""}
        ${years.length ? `<select id="fYear" aria-label="Year">${options(years, L.year, "All years")}</select>` : ""}
        <label class="sortby">Sort <select id="fSort">${sortOpts}</select></label>
        <div class="seg small" id="viewSeg">
          <button data-view="grid" aria-pressed="${L.view === "grid"}" title="Cover grid">Grid</button>
          <button data-view="list" aria-pressed="${L.view === "list"}" title="Compact list">List</button>
        </div>
      </div>
      <p class="count">${MALD.fmtNum(items.length)} title${items.length === 1 ? "" : "s"}</p>
      ${body}
      ${items.length > shown.length ? `<button class="more ghost" data-act="more">Show more (${MALD.fmtNum(items.length - shown.length)} left)</button>` : ""}`;
  }

  function tile(e) {
    const status = statusText(e);
    const meta = [e.mediaType, e.year].filter(Boolean).join(" · ");
    const prog = e.status === "completed" || e.status === "planned" ? "" : ` · ${progressText(e)}`;
    const tileHtml = `<button class="tile st-${e.status}" data-id="${e.id}" title="${esc(titleOf(e))}">
      <span class="cover">${cover(e, "img")}${e.score ? `<span class="badge">★ ${e.score}</span>` : ""}</span>
      <span class="t">${esc(titleOf(e))}</span>
      <span class="m">${esc(meta)}</span>
      <span class="m s"><i class="dot st-${e.status}"></i>${esc(status)}${prog}</span>
    </button>`;
    return tileHtml;
  }

  function row(e) {
    return `<button class="row" data-id="${e.id}" role="row">
      ${cover(e, "thumb")}
      <span class="r-title"><strong>${esc(titleOf(e))}</strong><small>${esc([e.mediaType, e.year, e.creators.slice(0, 2).join(", ")].filter(Boolean).join(" · "))}</small></span>
      <span class="pill"><i class="dot st-${e.status}"></i>${esc(statusText(e))}</span>
      <span class="r-prog">${progressText(e)}<span class="pbar"><i data-w="${pct(e).toFixed(1)}"></i></span></span>
      <span class="r-score" title="Your score">${e.score ? "★ " + e.score : "–"}</span>
      <span class="r-mean" title="MAL score">${e.mean ? e.mean.toFixed(2) : ""}</span>
    </button>`;
  }

  /* ---------- Progress ---------- */

  function renderProgress(view, entries) {
    const anime = S.kind === "anime";
    const current = entries.filter((e) => e.status === "current");
    const hasUpdated = entries.some((e) => e.updatedAt);
    const STALE = 90 * 86400 * 1000;
    const stale = hasUpdated ? entries.filter((e) => (e.status === "current" || e.status === "on_hold") && e.updatedAt && Date.now() - Date.parse(e.updatedAt) > STALE) : [];
    const staleIds = new Set(stale.map((e) => e.id));
    const active = current.filter((e) => !staleIds.has(e.id))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || pct(b) - pct(a));
    const onHold = entries.filter((e) => e.status === "on_hold" && !staleIds.has(e.id));
    const queue = entries.filter((e) => e.status === "planned");
    const qs = {
      mean: (a, b) => (b.mean || 0) - (a.mean || 0),
      short: (a, b) => (a.total || 9999) * (a.duration || 1) - (b.total || 9999) * (b.duration || 1),
      popular: (a, b) => b.members - a.members,
      title: (a, b) => titleOf(a).localeCompare(titleOf(b)),
    };
    queue.sort(qs[S.queueSort] || qs.mean);
    const queueUnits = queue.reduce((s, e) => s + (e.total || 0), 0);
    const queueSecs = queue.reduce((s, e) => s + (e.total || 0) * e.duration, 0);
    const leftSecs = active.reduce((s, e) => s + (MALD.remaining(e) || 0) * e.duration, 0);

    const card = (e, note) => {
      const left = MALD.remaining(e);
      const bits = [];
      if (left != null) bits.push(`${left} ${unitName(left)} left`);
      if (anime && left && e.duration) bits.push(`~${MALD.fmtDur(left * e.duration)}`);
      if (e.updatedAt) bits.push(`updated ${MALD.fmtAgo(e.updatedAt)}`);
      const airing = e.airStatus === "currently_airing" || e.airStatus === "currently_publishing";
      const html = `<button class="pcard" data-id="${e.id}">
        ${cover(e, "thumb")}
        <span class="p-body">
          <strong>${esc(titleOf(e))}</strong>
          <span class="p-line">${anime ? "Ep" : "Ch"} ${progressText(e)}${e.kind === "manga" && e.totalVol ? ` · Vol ${e.progressVol}/${e.totalVol}` : ""}${e.repeating ? ` <span class="tag">${anime ? "Rewatching" : "Rereading"}</span>` : ""}${airing ? ` <span class="tag">${anime ? "Airing" : "Publishing"}</span>` : ""}${note ? ` <span class="tag warn">${esc(note)}</span>` : ""}</span>
          <span class="pbar"><i data-w="${pct(e).toFixed(1)}"></i></span>
          <small>${esc(bits.join(" · "))}</small>
        </span>
      </button>`;
      return canEdit() && e.status === "current" ? `<div class="pw">${html}${plusBtn(e)}</div>` : html;
    };

    const LIMIT = 9;
    const moreBtn = (key, n, limit) => (n > limit ? `<button class="link" data-expand="${key}">${S.expand[key] ? "Show fewer" : `Show all ${MALD.fmtNum(n)}`}</button>` : "");
    const section = (title, sub, items, fn, emptyText, key) => {
      const shown = key && !S.expand[key] ? items.slice(0, LIMIT) : items;
      return `
      <section class="block">
        <h2>${esc(title)} <small>${MALD.fmtNum(items.length)}</small></h2>
        ${sub ? `<p class="hint">${sub}</p>` : ""}
        ${items.length ? `<div class="pgrid">${shown.map(fn).join("")}</div>${key ? moreBtn(key, items.length, LIMIT) : ""}` : `<p class="hint">${esc(emptyText)}</p>`}
      </section>`;
    };
    const QLIMIT = 25;
    const queueShown = S.expand.queue ? queue : queue.slice(0, QLIMIT);

    view.innerHTML = `
      ${section(MALD.statusLabel("current", S.kind), active.length && anime && leftSecs ? `About ${MALD.fmtDur(leftSecs)} left to finish everything you're watching.` : "", active, (e) => card(e), `Nothing in progress.`)}
      ${stale.length ? section("Gone quiet", `Watching or on hold, but not touched in over 3 months.`, stale, (e) => card(e, MALD.statusLabel(e.status, e.kind)), "", "quiet") : ""}
      ${onHold.length ? section("On hold", "", onHold, (e) => card(e), "", "hold") : ""}
      ${!hasUpdated ? `<p class="hint">XML exports don't say when entries were last changed, so the "gone quiet" list only appears for live lists.</p>` : ""}
      <section class="block">
        <h2>${esc(MALD.statusLabel("planned", S.kind))} <small>${MALD.fmtNum(queue.length)}</small></h2>
        <div class="qhead">
          <p class="hint">${MALD.fmtNum(queueUnits)} ${unitName(queueUnits)}${anime && queueSecs ? ` · about ${MALD.fmtDur(queueSecs)}` : ""} in ${owner()} queue.</p>
          <label class="sortby">Sort <select id="qSort">
            ${[["mean", "MAL score"], ["popular", "Most popular"], ["short", "Shortest first"], ["title", "Title"]].map(([v, t]) => `<option value="${v}"${S.queueSort === v ? " selected" : ""}>${t}</option>`).join("")}
          </select></label>
        </div>
        ${queue.length ? `<ol class="queue">${queueShown.map((e) => `<li><button class="qrow" data-id="${e.id}">
          ${cover(e, "thumb sm")}
          <span class="r-title"><strong>${esc(titleOf(e))}</strong><small>${esc([e.mediaType, e.year, e.total ? `${e.total} ${unitName(e.total)}` : "", e.airStatus === "not_yet_aired" ? "Not aired yet" : ""].filter(Boolean).join(" · "))}</small></span>
          <span class="r-mean" title="MAL score">${e.mean ? e.mean.toFixed(2) : ""}</span>
        </button></li>`).join("")}</ol>${moreBtn("queue", queue.length, QLIMIT)}` : `<p class="hint">Your queue is empty.</p>`}
      </section>`;
  }

  /* ---------- Stats ---------- */

  function renderStats(view, entries) {
    const anime = S.kind === "anime";
    const sum = MALD.summary(entries);
    const unit = anime ? "Episodes" : "Chapters";
    const tiles = [
      ["Titles", MALD.fmtNum(sum.count), ""],
      ["Completed", MALD.fmtNum(sum.byStatus.completed), sum.count ? `${Math.round((sum.byStatus.completed / sum.count) * 100)}% of the list` : ""],
      [unit, MALD.fmtNum(sum.units), anime ? "including rewatches" : sum.vols ? `${MALD.fmtNum(sum.vols)} volumes` : "including rereads"],
    ];
    if (anime) tiles.push(["Time watched", MALD.fmtDur(sum.seconds), `${MALD.fmtNum(sum.seconds / 3600)} hours`]);
    tiles.push(["Mean score", sum.mean ? sum.mean.toFixed(2) : "–", `${MALD.fmtNum(sum.scored)} scored`]);

    const total = sum.count || 1;
    const stack = MALD.STATUS_ORDER.filter((s) => sum.byStatus[s]).map((s) =>
      `<i class="st-${s}" data-w="${((sum.byStatus[s] / total) * 100).toFixed(2)}" data-tip="${esc(MALD.statusLabel(s, S.kind))}: ${sum.byStatus[s]} (${Math.round((sum.byStatus[s] / total) * 100)}%)"></i>`).join("");
    const legend = MALD.STATUS_ORDER.map((s) =>
      `<span><i class="dot st-${s}"></i>${esc(MALD.statusLabel(s, S.kind))} <strong>${MALD.fmtNum(sum.byStatus[s])}</strong></span>`).join("");

    const hasDetails = entries.some((e) => e.genres.length);
    view.innerHTML = `
      <div class="tiles">${tiles.map(([k, v, s]) => `<div class="stat"><small>${k}</small><span>${v}</span>${s ? `<em>${s}</em>` : ""}</div>`).join("")}</div>
      ${anime && sum.noLength ? `<p class="hint">${sum.noLength} titles have no episode length yet, so the time watched is a little low.</p>` : ""}
      <section class="block">
        <h2>Status</h2>
        <div class="stack" role="img" aria-label="Titles by status">${stack}</div>
        <div class="legend">${legend}</div>
      </section>
      <div class="two">
        ${hasDetails ? groupBlock(entries, "genres", "Genres") + groupBlock(entries, "creators", anime ? "Studios" : "Authors")
        : `<section class="block"><h2>Genres & ${anime ? "studios" : "authors"}</h2><p class="hint">These need the extra details from MyAnimeList, which weren't added to this list.</p></section>`}
      </div>
      ${historyBlock(entries)}`;
  }

  function groupBlock(entries, field, title) {
    const anime = S.kind === "anime";
    let groups = MALD.groupBy(entries, field);
    const MIN = 3;
    const modes = [["count", anime ? "Most watched" : "Most read"], ["mean", "Highest rated"]].concat(anime ? [["seconds", "Most time"]] : [["units", "Most chapters"]]);
    const mode = modes.some((m) => m[0] === S.groupMode[field]) ? S.groupMode[field] : "count";
    if (mode === "mean") groups = groups.filter((g) => g.scored >= MIN);
    groups.sort((a, b) => (b[mode] || 0) - (a[mode] || 0) || b.count - a.count);
    const all = S.groupAll[field];
    const shown = all ? groups : groups.slice(0, 12);
    const max = Math.max(...shown.map((g) => g[mode] || 0), mode === "mean" ? 10 : 1);
    const val = (g) => mode === "mean" ? g.mean.toFixed(2) : mode === "seconds" ? MALD.fmtDur(g.seconds) : MALD.fmtNum(g[mode]);
    const rows = shown.map((g) => {
      const tip = `${g.name}: ${g.count} title${g.count === 1 ? "" : "s"}${g.mean ? ` · mean score ${g.mean.toFixed(2)}` : ""}${anime ? ` · ${MALD.fmtDur(g.seconds)}` : ` · ${MALD.fmtNum(g.units)} chapters`}`;
      return `<li data-tip="${esc(tip)}" tabindex="0">
        <span class="g-name">${esc(g.name)}</span>
        <span class="g-bar"><i data-w="${(((g[mode] || 0) / max) * 100).toFixed(1)}"></i></span>
        <span class="g-val">${val(g)}</span>
        <span class="g-sub">${mode === "count" ? (g.mean ? "★ " + g.mean.toFixed(1) : "") : `${g.count}×`}</span>
      </li>`;
    }).join("");
    return `<section class="block">
      <div class="bhead"><h2>${title}</h2>
        <div class="seg small" data-group-modes>${modes.map(([v, t]) => `<button data-gmode="${v}" data-field="${field}" aria-pressed="${mode === v}">${t}</button>`).join("")}</div>
      </div>
      ${mode === "mean" ? `<p class="hint">Only ${title.toLowerCase()} with at least ${MIN} scored titles.</p>` : ""}
      ${shown.length ? `<ol class="gbars">${rows}</ol>` : `<p class="hint">Not enough data yet.</p>`}
      ${groups.length > 12 ? `<button class="link" data-gall="${field}">${all ? "Show top 12" : `Show all ${groups.length}`}</button>` : ""}
    </section>`;
  }

  function historyBlock(entries) {
    const anime = S.kind === "anime";
    const h = MALD.history(entries);
    if (!h.years.length) {
      return `<section class="block"><h2>History</h2><p class="hint">None of your completed titles have a finish date on MyAnimeList, so there's no history to show.</p></section>`;
    }
    const metrics = [["count", "Titles completed"], [anime ? "seconds" : "units", anime ? "Time watched" : "Chapters read"]];
    const metric = metrics.some((m) => m[0] === S.histMetric) ? S.histMetric : "count";
    const fmt = (v) => (metric === "seconds" ? MALD.fmtDur(v) : MALD.fmtNum(v));
    const label = metric === "count" ? "completed" : metric === "seconds" ? "watched" : "chapters";
    const years = h.years;
    if (!years.some((y) => y.year === S.histYear)) S.histYear = [...years].reverse().find((y) => y.months.some((m) => m.count))?.year || years[years.length - 1].year;
    const sel = years.find((y) => y.year === S.histYear);

    const columns = (items, keyFn, labelFn, tipFn, selectedKey, attr) => {
      const max = Math.max(...items.map((i) => i[metric]), 1);
      return `<div class="cols" role="list">${items.map((it, i) => `
        <button class="col${keyFn(it, i) === selectedKey ? " on" : ""}" role="listitem" ${attr ? `${attr}="${keyFn(it, i)}"` : "tabindex=\"-1\""} data-tip="${esc(tipFn(it, i))}" aria-label="${esc(tipFn(it, i))}">
          <span class="bar-area"><i data-h="${((it[metric] / max) * 100).toFixed(1)}"${it[metric] ? "" : ' class="zero"'}></i></span>
          <span class="col-l">${labelFn(it, i)}</span>
        </button>`).join("")}</div>
        <div class="axis-note">Tallest bar: ${fmt(max)}</div>`;
    };

    const best = sel.months.reduce((b, m, i) => (m[metric] > (b ? sel.months[b.i][metric] : 0) ? { i } : b), null);
    return `<section class="block">
      <div class="bhead"><h2>History</h2>
        <div class="seg small" data-hist-metrics>${metrics.map(([v, t]) => `<button data-hmetric="${v}" aria-pressed="${metric === v}">${t}</button>`).join("")}</div>
      </div>
      <p class="hint">By the finish date you set on MyAnimeList. Click a year to see its months.</p>
      <h3>By year</h3>
      ${columns(years, (y) => y.year, (y) => (years.length > 14 ? `'${String(y.year).slice(2)}` : y.year), (y) => `${y.year}: ${fmt(y[metric])} ${label}`, S.histYear, "data-year")}
      <h3>${sel.year} by month</h3>
      ${columns(sel.months, (m, i) => i, (m, i) => MONTHS[i], (m, i) => `${MONTHS[i]} ${sel.year}: ${fmt(m[metric])} ${label}`, -1, "")}
      <p class="hint">${[
        best ? `Busiest month in ${sel.year}: ${MONTHS[best.i]} (${fmt(sel.months[best.i][metric])}).` : "",
        sel.noMonth ? `${sel.noMonth} title${sel.noMonth === 1 ? "" : "s"} in ${sel.year} ${sel.noMonth === 1 ? "has" : "have"} a finish year but no month.` : "",
        h.undated ? `${h.undated} completed title${h.undated === 1 ? " has" : "s have"} no finish date and ${h.undated === 1 ? "isn't" : "aren't"} counted.` : "",
      ].filter(Boolean).join(" ")}</p>
    </section>`;
  }

  Object.assign(U, { $, A, PAGE, S, canEdit, cover, esc, hidden18, list, malUrl, options, owner, progressText, render, savePrefs, setStatus, show, statusText, syncUrl, titleOf, toast });
})();
