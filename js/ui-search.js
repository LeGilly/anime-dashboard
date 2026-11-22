// Anime Dashboard, part 2 of 5: the Search tab (by name, this season, top ranked).
"use strict";
(function () {
  const MALD = window.MALD;
  const U = MALD.ui;
  const { $, A, S, cover, esc, list, owner, render, statusText, titleOf } = U;

  /* ---------- Search: all of MyAnimeList ----------
     Search by name, this season's anime, or MAL's top lists; 50 titles per MAL request, kept for this visit. */
  const RANK_LABELS = {
    anime: [["all", "Top anime"], ["airing", "Top airing"], ["upcoming", "Top upcoming"], ["tv", "Top TV series"], ["movie", "Top movies"],
      ["ova", "Top OVAs"], ["special", "Top specials"], ["bypopularity", "Most popular"], ["favorite", "Most favorited"]],
    manga: [["all", "Top overall"], ["manga", "Top manga"], ["novels", "Top light novels"], ["oneshots", "Top one-shots"],
      ["manhwa", "Top manhwa"], ["manhua", "Top manhua"], ["bypopularity", "Most popular"], ["favorite", "Most favorited"]],
  };
  const SEASON_NAMES = [["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["fall", "Fall"]];
  function currentSeason() {
    const d = new Date();
    return { year: d.getFullYear(), season: SEASON_NAMES[Math.floor(d.getMonth() / 3)][0] };
  }
  // What to ask MAL for, given the current choices (null: nothing to ask yet, e.g. an empty search box).
  function browseParams() {
    const B = S.browse;
    if (B.mode === "search") return B.q.trim().length >= 3 ? { mode: "search", q: B.q.trim() } : null;
    if (B.mode === "season") {
      if (!B.year) Object.assign(B, currentSeason());
      return { mode: "season", year: B.year, season: B.season, sort: B.sort === "score" ? "score" : "members" };
    }
    return { mode: "ranking", rank: B.rank };
  }
  async function fetchBrowse(key, params, r) {
    r.loading = true; r.error = "";
    try {
      const res = await MALD.relay("/browse", { type: S.kind, ...params, offset: r.items.length }, { priority: 0 });
      for (const node of res.items) {
        const d = MALD.detailsFromNode(node, S.kind);
        const e = MALD.makeEntry(Object.assign({ id: node.id, kind: S.kind }, d, { status: null }));
        e.rank = node.rank || 0;
        S.searchPool.set(`${S.kind}:${e.id}`, e); // anime and manga ids overlap
        if (!r.items.some((x) => x.id === e.id)) r.items.push(e);
      }
      r.more = res.more;
    } catch (err) {
      r.error = err.message;
    }
    r.loading = false;
    if (S.tab === "search" && S.browse.results.get(key) === r) render();
  }

  function renderSearch(view) {
    const B = S.browse;
    const anime = S.kind === "anime";
    if (!anime && B.mode === "season") B.mode = "ranking";
    if (!RANK_LABELS[S.kind].some(([v]) => v === B.rank)) B.rank = "all";
    const params = browseParams();
    const key = params ? `${S.kind}|${JSON.stringify(params)}` : "";
    let r = key ? B.results.get(key) : null;
    if (key && !r) { r = { items: [], more: false, loading: false, error: "" }; B.results.set(key, r); fetchBrowse(key, params, r); }

    const modes = [["search", "Search"], ...(anime ? [["season", "This season"]] : []), ["ranking", "Top ranked"]];
    const opts = (pairs, cur) => pairs.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(t)}</option>`).join("");
    const nowYear = new Date().getFullYear();
    const years = []; for (let y = nowYear + 1; y >= 1970; y--) years.push([y, y]);
    let controls = "";
    if (B.mode === "search") {
      controls = `<form class="bsearch" id="bForm" role="search">
        <input type="search" id="bq" placeholder="Search all of MyAnimeList ${anime ? "anime" : "manga"}…" value="${esc(B.q)}" aria-label="Search MyAnimeList" maxlength="64">
        <button type="submit">Search</button>
      </form>`;
    } else if (B.mode === "season") {
      controls = `<select data-b="season" aria-label="Season">${opts(SEASON_NAMES, B.season)}</select>
        <select data-b="year" aria-label="Year">${opts(years, B.year)}</select>
        <select data-b="sort" aria-label="Sort">${opts([["members", "Most members"], ["score", "Highest score"]], B.sort)}</select>`;
    } else {
      controls = `<select data-b="rank" aria-label="Ranking">${opts(RANK_LABELS[S.kind], B.rank)}</select>`;
    }

    const items = r ? r.items : [];
    const listed = new Map((list() || []).map((x) => [x.id, x]));
    const types = [...new Set(items.map((e) => e.mediaType).filter(Boolean))].sort();
    if (B.type && !types.includes(B.type) && items.length) B.type = "";
    const shown = items.filter((e) => (!B.type || e.mediaType === B.type) && !(B.hideListed && listed.has(e.id)));
    const hidden = items.length - shown.length;
    const whose = owner() === "your" ? "your" : `${esc(S.data.user)}'s`;
    const filters = items.length ? `<div class="filters bfilters">
        <select data-b="type" aria-label="Type">${opts([["", "All types"], ...types.map((t) => [t, t])], B.type)}</select>
        <label class="chk"><input type="checkbox" data-b="hideListed"${B.hideListed ? " checked" : ""}> Hide titles on ${whose} list</label>
      </div>` : "";

    const card = (e) => {
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const len = anime ? (e.mediaType === "Movie" ? "" : e.total ? plural(e.total, "ep") : "") : e.totalVol ? plural(e.totalVol, "vol") : e.total ? `${e.total} ch` : "";
      const when = MALD.isUpcoming(e) ? "Upcoming" : MALD.isOngoing(e) ? (anime ? "Airing now" : "Publishing") : "";
      const meta = [e.rank && B.mode === "ranking" ? `#${e.rank}` : "", e.mediaType, e.year, len, e.mean ? `★ ${e.mean.toFixed(2)}` : ""].filter(Boolean).join(" · ");
      const onList = listed.get(e.id);
      const mine = A.me ? A.myEntry(S.kind, e.id) : null;
      const tags = (onList ? `<span class="tag">On ${whose} list: ${esc(statusText(onList))}</span>` : `<span class="tag new">Not on ${whose} list</span>`)
        + (mine && owner() !== "your" ? ` <span class="tag mine">On my list: ${esc(statusText(mine))}</span>` : "")
        + (when ? ` <span class="tag">${esc(when)}</span>` : "");
      const html = `<button class="rcard" data-id="${e.id}">
        ${cover(e, "rthumb")}
        <span class="rc-body"><strong>${esc(titleOf(e))}</strong><small>${esc(meta)}</small><span class="rc-tags">${tags}</span></span>
      </button>`;
      return A.me && !mine
        ? `<div class="rw">${html}<button type="button" class="addplan mbtn" data-add="${e.id}">+ ${anime ? "Plan to watch" : "Plan to read"}</button></div>`
        : html;
    };

    let body;
    if (!params) body = `<p class="hint">${B.q.trim() ? "Type at least 3 characters." : `Search every ${anime ? "anime" : "manga"} on MyAnimeList by name, ${anime ? "browse a season, " : ""}or look at the top lists.`}</p>`;
    else if (r.error && !items.length) body = `<div class="notice warn" role="status"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Couldn't load these results</strong><p>${esc(r.error)}</p></div><button type="button" data-act="bretry">Try again</button></div>`;
    else if (!items.length) body = r.loading ? `<p class="hint busy">Asking MyAnimeList…</p>` : `<p class="hint">Nothing found.</p>`;
    else {
      body = `<p class="hint">${MALD.fmtNum(shown.length)} title${shown.length === 1 ? "" : "s"}${hidden ? ` · ${MALD.fmtNum(hidden)} hidden by the filters` : ""}</p>
        <div class="rgrid">${shown.map(card).join("")}</div>
        ${r.error ? `<p class="hint">${esc(r.error)}</p>` : ""}
        ${r.more ? `<button class="more ghost" data-act="bmore"${r.loading ? " disabled" : ""}>${r.loading ? "Loading…" : "Show 50 more"}</button>` : ""}`;
    }
    view.innerHTML = `
      <div class="filters">
        <div class="seg small" aria-label="Search mode">${modes.map(([v, t]) => `<button data-bmode="${v}" aria-pressed="${B.mode === v}">${t}</button>`).join("")}</div>
        ${controls}
      </div>
      ${filters}
      ${body}`;
  }
  function browseKey() { const p = browseParams(); return p ? `${S.kind}|${JSON.stringify(p)}` : ""; }


  Object.assign(U, { browseKey, browseParams, fetchBrowse, renderSearch });
})();
