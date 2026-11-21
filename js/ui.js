// Drawing the page and handling clicks.
"use strict";
(function () {
  const MALD = window.MALD;
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
    next: { source: "both", genres: [], matchAll: false, excludes: [], lengths: [], airing: false, shown: 12, contShown: 6, soonShown: 6 },
    openMulti: null,
    recData: {},
    recPool: new Map(),
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
    $("whoMeta").textContent = (data.source === "live" ? "Live from MAL" : "From XML export") + " · updated " + MALD.fmtAgo(data.fetchedAt);
    $("refreshBtn").textContent = data.source === "live" ? "Refresh" : "Upload newer";
    if (data.notes && data.notes.length) setStatus(data.notes.join(" "), "warn");
    else setStatus(`${MALD.fmtNum((data.anime || []).length)} anime · ${MALD.fmtNum((data.manga || []).length)} manga`);
    syncUrl();
    render();
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (S.data && S.data.source === "live") p.set("user", S.data.user);
    if (S.kind !== "anime") p.set("kind", S.kind);
    if (S.tab !== "library") p.set("tab", S.tab);
    const q = p.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
  }

  function render() {
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
    if (!entries || !entries.length) {
      const what = S.kind === "manga" ? "manga" : "anime";
      view.innerHTML = `<div class="empty"><p><strong>No ${what} on this list${entries ? " yet" : ""}.</strong></p>${
        !entries && S.data.source === "xml" ? `<p>Upload your ${what} export file to see it here.</p>` : ""}</div>`;
      return;
    }
    if (S.tab === "library") renderLibrary(view, entries);
    else if (S.tab === "progress") renderProgress(view, entries);
    else if (S.tab === "next") renderNext(view, entries);
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
    return `<button class="tile st-${e.status}" data-id="${e.id}" title="${esc(titleOf(e))}">
      <span class="cover">${cover(e, "img")}${e.score ? `<span class="badge">★ ${e.score}</span>` : ""}</span>
      <span class="t">${esc(titleOf(e))}</span>
      <span class="m">${esc(meta)}</span>
      <span class="m s"><i class="dot st-${e.status}"></i>${esc(status)}${prog}</span>
    </button>`;
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
      return `<button class="pcard" data-id="${e.id}">
        ${cover(e, "thumb")}
        <span class="p-body">
          <strong>${esc(titleOf(e))}</strong>
          <span class="p-line">${anime ? "Ep" : "Ch"} ${progressText(e)}${e.kind === "manga" && e.totalVol ? ` · Vol ${e.progressVol}/${e.totalVol}` : ""}${e.repeating ? ` <span class="tag">${anime ? "Rewatching" : "Rereading"}</span>` : ""}${airing ? ` <span class="tag">${anime ? "Airing" : "Publishing"}</span>` : ""}${note ? ` <span class="tag warn">${esc(note)}</span>` : ""}</span>
          <span class="pbar"><i data-w="${pct(e).toFixed(1)}"></i></span>
          <small>${esc(bits.join(" · "))}</small>
        </span>
      </button>`;
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
          <p class="hint">${MALD.fmtNum(queueUnits)} ${unitName(queueUnits)}${anime && queueSecs ? ` · about ${MALD.fmtDur(queueSecs)}` : ""} in your queue.</p>
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

  /* ---------- Next up ---------- */

  function resetNextPaging() { Object.assign(S.next, { shown: 12, contShown: 6, soonShown: 6 }); }

  async function loadRecs(kind, entries) {
    const st = (S.recData[kind] = { status: "loading", done: 0, total: 0 });
    if (!MALD.relayReady()) {
      Object.assign(st, { status: "ready", links: new Map(), details: new Map(), error: "Suggestions from outside your list need the relay, which isn't set up on this site." });
    } else {
      const { links, error } = await MALD.loadLinks(kind, MALD.recSeeds(entries), (done, total) => {
        st.done = done; st.total = total;
        const el = $("recProgress");
        if (el) el.textContent = `Looking at your ${kind === "anime" ? "anime" : "manga"} on MyAnimeList… ${done}/${total}`;
      });
      const el = $("recProgress");
      if (el) el.textContent = "Looking up suggested titles…";
      const det = await MALD.loadDetails(kind, MALD.recDetailIds(entries, links));
      Object.assign(st, { status: "ready", links, details: det.details, error: error || det.error });
    }
    if (S.tab === "next" && S.kind === kind && S.data && S.data[kind] === entries) render();
  }

  function renderNext(view, entries) {
    const anime = S.kind === "anime";
    const st = S.recData[S.kind];
    if (!st) { loadRecs(S.kind, entries); return renderNext(view, entries); }
    if (st.status === "loading") {
      view.innerHTML = `<div class="empty"><p class="sub busy" id="recProgress">Looking at your ${anime ? "anime" : "manga"} on MyAnimeList…${st.total ? ` ${st.done}/${st.total}` : ""}</p>
        <p class="hint">The first time takes a little while. After that it's saved in your browser for a week.</p></div>`;
      return;
    }
    const N = S.next;
    const res = MALD.recommend(entries, S.kind, st.links, st.details,
      { source: N.source, genres: N.genres, matchAll: N.matchAll, excludes: N.excludes, lengths: N.lengths, airing: N.airing, hideAdult: S.prefs.blur }, titleOf);
    S.recPool = res.pool;

    const lengthOpts = anime
      ? [["", "Any length"], ["movie", "Movies"], ["short", "Short (up to 13 eps)"], ["medium", "Medium (14 to 26 eps)"], ["long", "Long (27+ eps)"]]
      : [["", "Any length"], ["oneshot", "One-shots"], ["short", "Short (up to 5 vols)"], ["long", "Long (6+ vols)"]];
    // A button that opens a list of checkboxes, so several options can be ticked.
    const multi = (key, name, picked, options, label, extra = "") => `
      <div class="multi${picked.length ? " on" : ""}" data-multi="${key}">
        <button type="button" class="msel" aria-haspopup="true" aria-expanded="${S.openMulti === key}" aria-label="${esc(name)}">${esc(label)}</button>
        <div class="mpanel"${S.openMulti === key ? "" : " hidden"}>
          ${extra}
          <div class="mlist${options.length > 8 ? " twocol" : ""}">
            ${options.map(([v, t]) => `<label class="mopt"><input type="checkbox" data-mval="${esc(v)}"${picked.includes(v) ? " checked" : ""}> ${esc(t)}</label>`).join("")}
          </div>
          ${picked.length ? `<button type="button" class="link" data-mclear="${key}">Clear</button>` : ""}
        </div>
      </div>`;
    const plan = anime ? "Plan to watch" : "Plan to read";

    const card = (x, extra) => {
      const e = x.e;
      const when = MALD.isUpcoming(e) ? (e.season ? `Starts ${e.season}` : e.airStart ? `Starts ${MALD.fmtDate(e.airStart)}` : "Date not announced")
        : MALD.isOngoing(e) ? (anime ? "Airing now" : "Publishing") : "";
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const len = anime ? (e.mediaType === "Movie" ? "" : e.total ? plural(e.total, "ep") : "") : e.totalVol ? plural(e.totalVol, "vol") : e.total ? `${e.total} ch` : "";
      const meta = [e.mediaType, extra === "soon" ? when : e.year, extra === "soon" ? "" : len, e.mean ? `★ ${e.mean.toFixed(2)}` : ""].filter(Boolean).join(" · ");
      return `<button class="rcard" data-id="${e.id}">
        ${cover(e, "rthumb")}
        <span class="rc-body">
          <strong>${esc(titleOf(e))}</strong>
          <small>${esc(meta)}</small>
          <span class="rc-tags">${x.onList ? `<span class="tag">On your ${esc(plan.toLowerCase())}</span>` : `<span class="tag new">Not on your list</span>`}${extra !== "soon" && when ? ` <span class="tag">${esc(when)}</span>` : ""}</span>
          ${x.reasons.length ? `<ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        </span>
      </button>`;
    };
    const section = (title, sub, items, empty, opts = {}) => {
      const shown = opts.limit ? items.slice(0, opts.limit) : items;
      return `<section class="block">
        <h2>${esc(title)} <small>${MALD.fmtNum(items.length)}</small></h2>
        ${sub ? `<p class="hint">${sub}</p>` : ""}
        ${items.length ? `<div class="rgrid">${shown.map((x) => card(x, opts.extra)).join("")}</div>` : `<p class="hint">${esc(empty)}</p>`}
        ${opts.more && items.length > shown.length ? `<button class="more ghost" data-act="${opts.more}">Show more (${MALD.fmtNum(items.length - shown.length)} left)</button>` : ""}
      </section>`;
    };

    view.innerHTML = `
      <div class="filters">
        <div class="seg small" id="recSource" aria-label="Suggestions from">
          ${[["both", "Everything"], ["list", plan], ["new", "Not on my list"]].map(([v, t]) => `<button data-rsource="${v}" aria-pressed="${N.source === v}">${t}</button>`).join("")}
        </div>
        ${multi("genres", "Genres", N.genres, res.genres.map((g) => [g, g]),
          N.genres.length ? (N.genres.length <= 2 ? N.genres.join(N.matchAll ? " + " : ", ") : `${N.genres.length} genres`) : "Any genre",
          `<label class="mopt all"><input type="checkbox" data-mall${N.matchAll ? " checked" : ""}> Must have all of them</label>`)}
        ${multi("excludes", "Leave out genres", N.excludes, res.genres.map((g) => [g, g]),
          N.excludes.length ? (N.excludes.length <= 2 ? `Without ${N.excludes.join(", ")}` : `Without ${N.excludes.length} genres`) : "Leave out genres…")}
        ${multi("lengths", "Length", N.lengths, lengthOpts.filter(([v]) => v),
          N.lengths.length ? lengthOpts.filter(([v]) => N.lengths.includes(v)).map(([, t]) => t.replace(/ \(.*\)/, "")).join(", ") : "Any length")}
        <label class="check"><input type="checkbox" id="rAiring"${N.airing ? " checked" : ""}> Include ${anime ? "airing" : "ongoing"}</label>
      </div>
      ${st.error ? `<p class="sub warn">${esc(st.error)} <button class="link" data-act="rretry">Try again</button></p>` : ""}
      ${res.basis === "empty" ? `<p class="basis">There's nothing ${anime ? "watched" : "read"}, ${anime ? "watching" : "reading"} or dropped on this list yet, so these picks only use your ${plan.toLowerCase()} and MyAnimeList scores. They'll get more personal as your list grows.</p>`
        : `<p class="basis">${esc(res.basis)}</p>`}
      ${S.prefs.blur ? `<p class="hint center">18+ titles are left out while "Blur 18+ covers" is on in Settings.</p>` : ""}
      ${section("Continue a series", `Sequels to ${anime ? "shows" : "series"} you finished.`, res.cont, "No sequels waiting for you with these filters.", { limit: N.contShown, more: "cmore", extra: "" })}
      ${section("Recommended for you", "Based on what you rate highly, and what MyAnimeList users recommend from your favorites.", res.recommended, "Nothing matches these filters.", { limit: N.shown, more: "rmore" })}
      ${section("Coming up", `Related to ${anime ? "shows" : "series"} you've seen, or on your ${plan.toLowerCase()}: not out yet, or still ${anime ? "airing" : "ongoing"}.`, res.comingUp, "Nothing announced right now.", { limit: N.soonShown, more: "smore", extra: "soon" })}`;
  }

  /* ---------- detail panel ---------- */

  function openDetail(id) {
    const e = (list() || []).find((x) => String(x.id) === String(id)) || S.recPool.get(Number(id));
    if (!e) return;
    const anime = e.kind === "anime";
    const dl = (pairs) => pairs.filter((p) => p[1] !== "" && p[1] != null).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const mine = !e.status ? `<dt>Status</dt><dd>Not on your list yet</dd>` : dl([
      ["Status", `<span class="pill"><i class="dot st-${e.status}"></i>${esc(statusText(e))}</span>`],
      ["Your score", e.score ? `★ ${e.score}` : "Not scored"],
      [anime ? "Episodes" : "Chapters", `${progressText(e)}`],
      ["Volumes", !anime && e.totalVol ? `${e.progressVol}/${e.totalVol}` : ""],
      ["Started", esc(MALD.fmtDate(e.myStart))],
      ["Finished", esc(MALD.fmtDate(e.myFinish))],
      [anime ? "Rewatched" : "Reread", e.timesRepeated ? `${e.timesRepeated}×` : ""],
      ["Time spent", anime && MALD.secondsSpent(e) ? MALD.fmtDur(MALD.secondsSpent(e)) : ""],
      ["Last updated", e.updatedAt ? esc(MALD.fmtAgo(e.updatedAt)) : ""],
    ]);
    const info = dl([
      ["MAL score", e.mean ? e.mean.toFixed(2) : ""],
      ["Type", esc(e.mediaType)],
      ["Status", esc(MALD.AIR_LABELS[e.airStatus] || "")],
      ["Season", esc(e.season || (e.year || ""))],
      [anime ? "Episode length" : "", anime && e.duration ? `${Math.round(e.duration / 60)} min` : ""],
      [anime ? "Studios" : "Authors", esc(e.creators.join(", "))],
      ["Members", e.members ? MALD.fmtNum(e.members) : ""],
    ].filter((p) => p[0]));
    const img = e.imageLarge || e.image;
    $("detail").innerHTML = `
      <div class="d-wrap">
        <button class="d-close ghost" data-act="close" aria-label="Close">✕</button>
        ${img ? `<img class="d-cover${hidden18(e) ? " nsfw" : ""}" src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : ""}
        <div class="d-body">
          <h2>${esc(titleOf(e))}</h2>
          ${e.titleEn && e.titleEn !== titleOf(e) ? `<p class="sub">${esc(e.titleEn)}</p>` : e.titleEn && e.title !== titleOf(e) ? `<p class="sub">${esc(e.title)}</p>` : ""}
          ${e.genres.length ? `<ul class="tags">${e.genres.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          <h3>On your list</h3><dl>${mine}</dl>
          ${info ? `<h3>About</h3><dl>${info}</dl>` : ""}
          <p><a class="btn" href="${malUrl(e)}" target="_blank" rel="noopener">Open on MyAnimeList</a></p>
        </div>
      </div>`;
    $("detail").showModal();
  }

  /* ---------- loading ---------- */

  async function loadUser(user) {
    if (S.busy) return;
    user = user.trim();
    if (!user) return;
    S.busy = true;
    setStatus(`Loading ${user}'s lists…`, "busy");
    document.body.classList.add("loading");
    try {
      const data = await MALD.loadLive(user);
      MALD.save(data);
      show(data);
    } catch (err) {
      setStatus(err.message, "warn");
    } finally {
      S.busy = false;
      document.body.classList.remove("loading");
    }
  }

  async function loadFiles(files) {
    if (S.busy || !files.length) return;
    S.busy = true;
    setStatus("Reading your export…", "busy");
    try {
      const parsed = [];
      for (const f of files) parsed.push(await MALD.readExportFile(f));
      const user = parsed.find((p) => p.user)?.user || "";
      // Keep the other list if it's the same person's earlier upload.
      const prev = S.data && S.data.source === "xml" && S.data.user === user ? S.data : null;
      const data = { user, source: "xml", fetchedAt: Date.now(), anime: prev ? prev.anime : null, manga: prev ? prev.manga : null, notes: [] };
      for (const p of parsed) {
        if (p.anime) data.anime = p.anime;
        if (p.manga) data.manga = p.manga;
      }
      if (!data.anime && !data.manga) throw new Error("That export has no entries.");
      if (!data.anime && data.manga) S.kind = "manga";
      show(data);
      // Add covers, genres and studios through the relay, then redraw.
      for (const kind of ["anime", "manga"]) {
        if (!data[kind]) continue;
        const note = await MALD.enrich(data[kind], kind, (done, total) => {
          setStatus(`Adding covers and genres to your ${kind}… ${done}/${total}`, "busy");
          if (done % 200 === 0) render();
        });
        if (note) data.notes.push(note);
      }
      data.fetchedAt = Date.now();
      MALD.save(data);
      show(data);
    } catch (err) {
      setStatus(err.message, "warn");
    } finally {
      S.busy = false;
    }
  }

  /* ---------- events ---------- */

  function bind() {
    $("userForm").addEventListener("submit", (ev) => { ev.preventDefault(); loadUser($("user").value); });
    $("file").addEventListener("change", (ev) => { loadFiles([...ev.target.files]); ev.target.value = ""; });

    const drop = $("loader");
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); loadFiles([...ev.dataTransfer.files]); });

    $("kindSeg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-kind]");
      if (!b || b.dataset.kind === S.kind) return;
      S.kind = b.dataset.kind;
      S.lib = Object.assign(S.lib, { status: "all", type: "", genre: "", creator: "", year: "", shown: PAGE });
      Object.assign(S.next, { genres: [], matchAll: false, excludes: [], lengths: [] }); S.openMulti = null; resetNextPaging();
      syncUrl(); render();
    });
    $("tabs").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-tab]");
      if (!b) return;
      S.tab = b.dataset.tab;
      syncUrl(); render();
      window.scrollTo({ top: 0 });
    });
    $("refreshBtn").addEventListener("click", () => {
      if (S.data && S.data.source === "live") loadUser(S.data.user);
      else $("file").click();
    });
    $("changeBtn").addEventListener("click", () => {
      $("app").hidden = true;
      $("loader").hidden = false;
      $("user").value = S.data && S.data.source === "live" ? S.data.user : "";
      $("user").focus();
    });
    $("settingsBtn").addEventListener("click", () => {
      const p = $("settings");
      p.hidden = !p.hidden;
      $("settingsBtn").setAttribute("aria-expanded", String(!p.hidden));
    });
    $("forgetBtn").addEventListener("click", () => {
      MALD.forget();
      S.data = null;
      $("settings").hidden = true;
      $("settingsBtn").setAttribute("aria-expanded", "false");
      $("app").hidden = true;
      $("loader").hidden = false;
      $("user").value = "";
      history.replaceState(null, "", location.pathname);
      setStatus("The list was removed from this browser.");
    });
    $("prefEn").checked = S.prefs.english;
    $("prefBlur").checked = S.prefs.blur;
    $("prefEn").addEventListener("change", (ev) => { S.prefs.english = ev.target.checked; savePrefs(); render(); });
    $("prefBlur").addEventListener("change", (ev) => { S.prefs.blur = ev.target.checked; savePrefs(); render(); });

    const view = $("view");
    let searchTimer;
    view.addEventListener("input", (ev) => {
      if (ev.target.id !== "q") return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        S.lib.q = ev.target.value; S.lib.shown = PAGE;
        const pos = ev.target.selectionStart;
        render();
        const q = $("q"); q.focus(); q.setSelectionRange(pos, pos);
      }, 150);
    });
    view.addEventListener("change", (ev) => {
      const map = { fType: "type", fGenre: "genre", fCreator: "creator", fYear: "year", fSort: "sort" };
      if (map[ev.target.id]) { S.lib[map[ev.target.id]] = ev.target.value; S.lib.shown = PAGE; render(); }
      else if (ev.target.id === "qSort") { S.queueSort = ev.target.value; render(); }
      else if (ev.target.matches("[data-mval]")) {
        const key = ev.target.closest("[data-multi]").dataset.multi;
        const v = ev.target.dataset.mval;
        S.next[key] = ev.target.checked ? [...S.next[key], v] : S.next[key].filter((x) => x !== v);
        resetNextPaging(); render();
      }
      else if (ev.target.matches("[data-mall]")) { S.next.matchAll = ev.target.checked; resetNextPaging(); render(); }
      else if (ev.target.id === "rAiring") { S.next.airing = ev.target.checked; resetNextPaging(); render(); }
    });
    view.addEventListener("click", (ev) => {
      const t = ev.target.closest("button");
      if (!t) return;
      if (t.dataset.status) { S.lib.status = t.dataset.status; S.lib.shown = PAGE; render(); }
      else if (t.dataset.view) { S.lib.view = t.dataset.view; render(); }
      else if (t.dataset.act === "more") { S.lib.shown += PAGE; render(); }
      else if (t.dataset.act === "clear") { Object.assign(S.lib, { status: "all", q: "", type: "", genre: "", creator: "", year: "", shown: PAGE }); render(); }
      else if (t.dataset.gmode) { S.groupMode[t.dataset.field] = t.dataset.gmode; render(); }
      else if (t.classList.contains("msel")) {
        const key = t.closest("[data-multi]").dataset.multi;
        S.openMulti = S.openMulti === key ? null : key;
        view.querySelectorAll("[data-multi]").forEach((m) => {
          const open = m.dataset.multi === S.openMulti;
          m.querySelector(".mpanel").hidden = !open;
          m.querySelector(".msel").setAttribute("aria-expanded", String(open));
        });
      }
      else if (t.dataset.mclear) { S.next[t.dataset.mclear] = []; if (t.dataset.mclear === "genres") S.next.matchAll = false; resetNextPaging(); render(); }
      else if (t.dataset.rsource) { S.next.source = t.dataset.rsource; resetNextPaging(); render(); }
      else if (t.dataset.act === "rmore") { S.next.shown += 12; render(); }
      else if (t.dataset.act === "cmore") { S.next.contShown += 12; render(); }
      else if (t.dataset.act === "smore") { S.next.soonShown += 12; render(); }
      else if (t.dataset.act === "rretry") { delete S.recData[S.kind]; render(); }
      else if (t.dataset.expand) { S.expand[t.dataset.expand] = !S.expand[t.dataset.expand]; render(); }
      else if (t.dataset.gall) { S.groupAll[t.dataset.gall] = !S.groupAll[t.dataset.gall]; render(); }
      else if (t.dataset.hmetric) { S.histMetric = t.dataset.hmetric; render(); }
      else if (t.dataset.year) { S.histYear = Number(t.dataset.year); render(); }
      else if (t.dataset.id) openDetail(t.dataset.id);
    });

    const closeMulti = () => {
      if (!S.openMulti) return;
      S.openMulti = null;
      view.querySelectorAll("[data-multi]").forEach((m) => {
        m.querySelector(".mpanel").hidden = true;
        m.querySelector(".msel").setAttribute("aria-expanded", "false");
      });
    };
    document.addEventListener("click", (ev) => { if (!ev.target.closest("[data-multi]")) closeMulti(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMulti(); });

    const dlg = $("detail");
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg || ev.target.closest("[data-act=close]")) dlg.close();
    });

    // Hover and focus tooltips for charts.
    const tip = $("tip");
    const showTip = (el, x, y) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
      tip.style.top = Math.max(8, y - r.height - 12) + "px";
    };
    document.addEventListener("pointermove", (ev) => {
      const el = ev.target.closest && ev.target.closest("[data-tip]");
      if (el) showTip(el, ev.clientX, ev.clientY); else tip.hidden = true;
    });
    document.addEventListener("focusin", (ev) => {
      const el = ev.target.closest && ev.target.closest("[data-tip]");
      if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } else tip.hidden = true;
    });
    window.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  }

  function start() {
    bind();
    MALD.pruneDetails();
    const p = new URLSearchParams(location.search);
    if (p.get("kind") === "manga") S.kind = "manga";
    if (["progress", "next", "stats"].includes(p.get("tab"))) S.tab = p.get("tab");
    if (!MALD.relayReady()) {
      $("liveHint").textContent = "Live loading isn't set up on this site yet. Use the XML upload below.";
      $("user").disabled = true;
      $("loadBtn").disabled = true;
    }
    const saved = MALD.loadSaved();
    const wanted = p.get("user");
    if (wanted && MALD.relayReady()) {
      const fresh = saved && saved.source === "live" && saved.user.toLowerCase() === wanted.toLowerCase() && Date.now() - saved.fetchedAt < 10 * 60 * 1000;
      if (fresh) show(saved); else { $("user").value = wanted; loadUser(wanted); }
    } else if (saved && (saved.anime || saved.manga)) {
      show(saved);
    } else {
      setStatus("See your MyAnimeList in a cleaner way.");
    }
  }

  start();
})();
