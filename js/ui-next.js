// Anime Dashboard, part 3 of 5: the Next up tab and its background checks.
"use strict";
(function () {
  const MALD = window.MALD;
  const U = MALD.ui;
  const { $, A, S, canEdit, cover, esc, list, options, owner, render, statusText, titleOf } = U;


  /* ---------- Next up ---------- */

  function resetNextPaging() { Object.assign(S.next, { shown: 12, contShown: 6, soonShown: 6 }); }
  // Redraws after a change in an open list without the list jumping back to the top.
  function keepListPosition(key, redraw) {
    const sel = `[data-multi="${key}"] .mpanel`;
    const old = document.querySelector(sel);
    const top = old ? old.scrollTop : 0;
    redraw();
    const now = document.querySelector(sel);
    if (now) now.scrollTop = top;
  }
  // The ticked values, or null when everything is ticked (no filtering).
  const ticked = (all, off) => (off.length ? all.filter((v) => !off.includes(v)) : null);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Next up: check your favorites first and show results, then check likely titles for sequels in the background,
  // at a steady pace (one title every 1.5 seconds, slower after a slowdown). Other titles aren't checked.
  // If MyAnimeList asks to slow down at any point, stop contacting it, show what's saved, and resume after a break.

  async function loadRecs(kind, entries) {
    const st = (S.recData[kind] = { status: "loading", done: 0, total: 0 });
    // This list's requests to MyAnimeList: drop any left from before, and pause them whenever you leave Next up.
    const group = `next:${kind}`;
    MALD.net.cancel(group);
    syncNet();
    const label = kind === "anime" ? "anime" : "manga";
    if (!MALD.relayReady()) {
      Object.assign(st, { status: "ready", links: new Map(), details: new Map(), error: "Suggestions from outside your list need the relay, which isn't set up on this site." });
      refreshNext(kind, entries);
      return;
    }
    const seeds = MALD.recSeeds(entries);
    const inScope = [...seeds.favs, ...seeds.auto];
    const plan = MALD.planLinks(kind, inScope);
    const scope = new Set(inScope);
    const missing = new Set(plan.missing);
    const first = seeds.favs.filter((id) => missing.has(id));
    const queue = [...inScope.filter((id) => missing.has(id) && !first.includes(id)), ...plan.stale.filter((id) => scope.has(id))];
    st.others = seeds.others.length;
    let slow = MALD.pace.coolingFor() > 0; // still on a break from last time
    let error = null;
    const stop = (err) => { if (err.cancelled) error = "cancelled"; else if (MALD.isSlowdown(err.message)) { MALD.pace.slowDown(); slow = true; } else error = err.message; };

    // First pass (quick): favorites, then details for the best suggestions.
    if (!slow && first.length) {
      st.total = first.length;
      try {
        for (let i = 0; i < first.length; i += MALD.CHUNK) {
          await MALD.fetchLinks(plan, first.slice(i, i + MALD.CHUNK), { priority: 1, group });
          st.done = Math.min(first.length, i + MALD.CHUNK);
          const el = $("recProgress");
          if (el) el.textContent = `Looking at your favorite ${label} on MyAnimeList… ${st.done}/${st.total}`;
        }
      } catch (err) { stop(err); }
    }
    if (!slow && !error) { const el = $("recProgress"); if (el) el.textContent = "Looking up suggested titles…"; }
    const wanted = MALD.recDetailIds(entries, plan.links);
    let det = await MALD.loadDetails(kind, wanted, { offline: true });
    const needed = wanted.filter((id) => !det.details.has(id));
    if (!slow && !error && needed.length) {
      const shown = needed.slice(0, MALD.FIRST_DETAILS);
      const say = (done, total) => { const el = $("recProgress"); if (el) el.textContent = `Looking up suggested titles… ${done}/${total}`; };
      say(0, shown.length);
      const more = await MALD.loadDetails(kind, shown, { priority: 1, group, progress: say });
      for (const [id, d] of more.details) det.details.set(id, d);
      if (more.error) stop({ message: more.error, cancelled: more.error === "Cancelled." });
    }
    if (S.recData[kind] !== st) return; // replaced meanwhile (another list, or tried again)
    if (error === "cancelled") error = null;
    const left = queue;
    Object.assign(st, { status: "ready", links: plan.links, details: det.details, error,
      bg: { done: 0, total: left.length, running: !slow && !error, slow } });
    refreshNext(kind, entries);
    if (st.bg.running) checkInBackground(kind, entries, st, plan, left, group);
    else if (slow) resumeLater(kind, st);
  }

  // Background: sequel checks and the details they need, a few titles at a time, at a steady pace.
  async function checkInBackground(kind, entries, st, plan, ids, group) {
    const net = { priority: 2, group };
    const paced = async (count, work) => {
      const t0 = Date.now();
      await work();
      await sleep(Math.max(0, count * MALD.pace.get().pause - (Date.now() - t0)));
    };
    const slowedDown = (msg) => {
      if (S.recData[kind] !== st) return; // replaced meanwhile: nothing to report
      st.bg.running = false;
      if (MALD.isSlowdown(msg)) { MALD.pace.slowDown(); st.bg.slow = true; resumeLater(kind, st); }
      else st.error = msg;
      st.bg.total -= st.bg.done; st.bg.done = 0;
      refreshNext(kind, entries);
    };
    // Details still missing for suggestions found so far, fetched 5 at a time.
    const fillDetails = async () => {
      const missing = MALD.recDetailIds(entries, plan.links).filter((id) => !st.details.has(id));
      st.bg.looking = missing.length ? { done: 0, total: missing.length } : null;
      updateBgNote(kind);
      for (let i = 0; i < missing.length; i += 5) {
        if (S.recData[kind] !== st) return false;
        let res;
        await paced(Math.min(5, missing.length - i), async () => { res = await MALD.loadDetails(kind, missing.slice(i, i + 5), net); });
        for (const [id, d] of res.details) st.details.set(id, d);
        if (res.error) { st.bg.looking = null; slowedDown(res.error); return false; }
        st.bg.looking.done = Math.min(missing.length, i + 5);
        if (st.bg.done) st.bg.found = (st.bg.found || 0) + Math.min(5, missing.length - i); // new titles from sequel checks
        updateBgNote(kind);
      }
      if (missing.length) { st.bg.looking = null; refreshNext(kind, entries); }
      return true;
    };
    if (!(await fillDetails())) return;
    let sinceUpdate = 0;
    for (let i = 0; i < ids.length; i += 5) {
      if (S.recData[kind] !== st) return; // another list was loaded meanwhile
      const chunk = ids.slice(i, i + 5);
      try {
        await paced(chunk.length, () => MALD.fetchLinks(plan, chunk, net));
      } catch (err) {
        slowedDown(err.message);
        return;
      }
      st.bg.done = Math.min(ids.length, i + 5);
      sinceUpdate += chunk.length;
      updateBgNote(kind);
      const last = st.bg.done >= ids.length;
      if (sinceUpdate >= 25 || last) {
        sinceUpdate = 0;
        if (!(await fillDetails())) return;
        refreshNext(kind, entries);
      }
    }
    st.bg.running = false;
    if (ids.length) MALD.pace.relax();
    refreshNext(kind, entries);
  }

  // Next up's requests only go out while you're looking at it: leaving the tab (or the browser tab) pauses them,
  // coming back picks up where they stopped. Everything found so far is saved either way.
  function syncNet() {
    for (const k of ["anime", "manga"]) {
      if (S.tab === "next" && S.kind === k && !document.hidden) MALD.net.resume(`next:${k}`);
      else MALD.net.pause(`next:${k}`);
    }
  }
  document.addEventListener("visibilitychange", syncNet);

  // After a break, start again by itself if the page is still open (saved checks are reused).
  function resumeLater(kind, st) {
    clearTimeout(st.resumeTimer);
    st.resumeTimer = setTimeout(() => {
      if (S.recData[kind] !== st) return;
      delete S.recData[kind];
      if (S.tab === "next" && S.kind === kind) render();
    }, MALD.pace.coolingFor() + 1000);
  }

  // Redraw Next up with new results, but never while a filter list is open (it would close under your finger).
  function refreshNext(kind, entries) {
    const st = S.recData[kind];
    if (!(S.tab === "next" && S.kind === kind && S.data && S.data[kind] === entries)) return;
    if (S.openMulti) { st.dirty = true; return; }
    st.dirty = false;
    render();
  }

  function bgNoteText(st) {
    const label = S.kind === "anime" ? "anime" : "manga";
    const lk = st.bg && st.bg.running && st.bg.looking;
    // The first lookups (before any sequel check) are a step of their own; later ones happen quietly
    // under the sequel count, as "new titles found".
    if (lk && !st.bg.done) return `Looking up ${MALD.fmtNum(lk.total)} suggested title${lk.total === 1 ? "" : "s"} (genres, length, airing)… ${MALD.fmtNum(lk.done)}/${MALD.fmtNum(lk.total)}. `
      + (st.bg.total ? `Then checking your ${label} for sequels (${MALD.fmtNum(st.bg.done)}/${MALD.fmtNum(st.bg.total)}).` : "");
    if (st.bg && st.bg.running && st.bg.total) {
      const found = st.bg.found ? ` ${MALD.fmtNum(st.bg.found)} new title${st.bg.found === 1 ? "" : "s"} found so far.` : "";
      return `Checking your ${label} for sequels… ${MALD.fmtNum(st.bg.done)}/${MALD.fmtNum(st.bg.total)}.${found} Results update as it goes.`;
    }
    if (st.bg && st.bg.running) return "Looking up suggested titles…";
    return "";
  }
  // One warning banner for anything that stopped the checks: a MyAnimeList slowdown, or another error.
  function pausedBanner(st) {
    const left = st.bg ? st.bg.total - st.bg.done : 0;
    let title, text;
    if (st.bg && st.bg.slow) {
      const mins = Math.max(1, Math.ceil(MALD.pace.coolingFor() / 60000));
      title = "MyAnimeList is busy or asked to slow down";
      text = `To give it a break, this page won't contact MyAnimeList for about ${mins} minute${mins === 1 ? "" : "s"}. `
        + (left ? `${MALD.fmtNum(left)} titles still need checking for sequels, so some may be missing below. ` : "Some suggestions may be missing below. ")
        + "Checking resumes by itself, and more slowly, if this page stays open.";
    } else if (st.error) {
      title = "Some suggestions couldn't be loaded";
      text = `${st.error.replace(/\.$/, "")}.${left ? ` ${MALD.fmtNum(left)} titles still need checking for sequels.` : ""}`;
    } else return "";
    return `<div class="notice warn" role="status">
      <span class="notice-icon" aria-hidden="true">!</span>
      <div><strong>${esc(title)}</strong><p>${esc(text)}</p></div>
      <button type="button" data-act="rretry">Try again now</button>
    </div>`;
  }
  // Under "Continue a series": which titles are checked for sequels (only shown when some aren't).
  function sweepNote(st) {
    if (!st.others) return "";
    return " Only your favorites, and titles you finished or updated in the last 2 years, rated above your average or rewatched, are checked.";
  }

  function updateBgNote(kind) {
    const el = $("recBg");
    const st = S.recData[kind];
    if (el && S.kind === kind) { el.textContent = bgNoteText(st); el.hidden = !el.textContent; el.classList.toggle("busy", !!(st.bg && st.bg.running)); }
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
    const allGenres = MALD.recGenres(entries, S.kind, st.links, st.details);
    const allLengths = (anime ? ["movie", "short", "medium", "long"] : ["oneshot", "short", "long"]);
    const gOn = ticked(allGenres, N.genresOff);
    const lOn = ticked(allLengths, N.lengthsOff);
    const res = MALD.recommend(entries, S.kind, st.links, st.details,
      { source: N.source, genres: ticked(allGenres, N.genresOff), matchAll: N.matchAll, excludes: N.excludes,
        lengths: ticked(allLengths, N.lengthsOff), airing: N.airing, hideAdult: S.prefs.blur }, titleOf);
    S.recPool = res.pool;

    const lengthOpts = anime
      ? [["", "Any length"], ["movie", "Movies"], ["short", "Short (up to 13 eps)"], ["medium", "Medium (14 to 26 eps)"], ["long", "Long (27+ eps)"]]
      : [["", "Any length"], ["oneshot", "One-shots"], ["short", "Short (up to 5 vols)"], ["long", "Long (6+ vols)"]];
    lengthOpts.shift(); // "Any length" is now simply every box ticked
    // A button that opens a list of checkboxes, so several options can be ticked.
    // "off" lists start with every box ticked (unticking narrows); the leave-out list starts empty.
    // The header (search, tick/untick buttons, extra option) stays pinned while the list scrolls.
    const multi = (key, name, options, isChecked, label, active, extra = "") => {
      const off = key.endsWith("Off");
      const search = options.length > 12;
      const q = search ? (S.msearch[key] || "").trim().toLowerCase() : "";
      const shown = q ? options.filter(([, t]) => t.toLowerCase().includes(q)) : options;
      const nChecked = shown.filter(([v]) => isChecked(v)).length;
      const btn = (set, text) => `<button type="button" class="mbtn" data-mset="${set}">${text}</button>`;
      const buttons = off
        ? [nChecked < shown.length ? btn("all", q ? "Tick these" : "Tick all") : "", nChecked ? btn("none", q ? "Untick these" : "Untick all") : ""].join("")
        : options.some(([v]) => isChecked(v)) ? btn("none", "Clear") : "";
      return `
      <div class="multi${active ? " on" : ""}" data-multi="${key}">
        <button type="button" class="msel" aria-haspopup="true" aria-expanded="${S.openMulti === key}" aria-label="${esc(name)}">${esc(label)}</button>
        <div class="mpanel"${S.openMulti === key ? "" : " hidden"}>
          <div class="mhead">
            ${search ? `<input type="search" class="msearch" data-msearch placeholder="Search ${esc(name.toLowerCase())}…" value="${esc(S.msearch[key] || "")}" aria-label="Search ${esc(name.toLowerCase())}">` : ""}
            ${buttons ? `<div class="mbtns">${buttons}</div>` : ""}
            ${extra}
          </div>
          <div class="mlist${shown.length > 8 ? " twocol" : ""}">
            ${shown.map(([v, t]) => `<label class="mopt"><input type="checkbox" data-mval="${esc(v)}"${isChecked(v) ? " checked" : ""}> ${esc(t)}</label>`).join("")}
            ${!shown.length ? `<p class="hint">No ${esc(name.toLowerCase())} match "${esc(S.msearch[key])}".</p>` : ""}
          </div>
        </div>
      </div>`;
    };
    const plan = anime ? "Plan to watch" : "Plan to read";

    const card = (x, extra) => {
      const e = x.e;
      const when = MALD.isUpcoming(e) ? (e.season ? `Starts ${e.season}` : e.airStart ? `Starts ${MALD.fmtDate(e.airStart)}` : "Date not announced")
        : MALD.isOngoing(e) ? (anime ? "Airing now" : "Publishing") : "";
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const len = anime ? (e.mediaType === "Movie" ? "" : e.total ? plural(e.total, "ep") : "") : e.totalVol ? plural(e.totalVol, "vol") : e.total ? `${e.total} ch` : "";
      const meta = [e.mediaType, extra === "soon" ? when : e.year, extra === "soon" ? "" : len, e.mean ? `★ ${e.mean.toFixed(2)}` : ""].filter(Boolean).join(" · ");
      // Signed in: show whether it's on YOUR list, and offer to add it if it isn't.
      const mineE = A.me ? (canEdit() ? (x.onList ? e : null) : A.myEntry(S.kind, e.id)) : null;
      const myTag = A.me && !canEdit() && mineE ? ` <span class="tag mine">On my list: ${esc(statusText(mineE))}</span>` : "";
      const html = `<button class="rcard" data-id="${e.id}">
        ${cover(e, "rthumb")}
        <span class="rc-body">
          <strong>${esc(titleOf(e))}</strong>
          <small>${esc(meta)}</small>
          <span class="rc-tags">${x.onList ? `<span class="tag">On ${owner()} ${esc(plan.toLowerCase())}</span>` : `<span class="tag new">Not on ${owner()} list</span>`}${myTag}${extra !== "soon" && when ? ` <span class="tag">${esc(when)}</span>` : ""}</span>
          ${x.reasons.length ? `<ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        </span>
      </button>`;
      return A.me && !mineE
        ? `<div class="rw">${html}<button type="button" class="addplan mbtn" data-add="${e.id}">+ ${anime ? "Plan to watch" : "Plan to read"}</button></div>`
        : html;
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
        ${multi("genresOff", "Genres", allGenres.map((g) => [g, g]), (g) => !N.genresOff.includes(g),
          !gOn ? "Any genre" : !gOn.length ? "No genre" : gOn.length <= 2 ? gOn.join(N.matchAll ? " + " : ", ") : `${gOn.length} genres`, !!gOn,
          gOn ? `<label class="mall"><input type="checkbox" data-mall${N.matchAll ? " checked" : ""}> Must have all ticked genres</label>` : "")}
        ${multi("excludes", "Leave out genres", allGenres.map((g) => [g, g]), (g) => N.excludes.includes(g),
          N.excludes.length ? (N.excludes.length <= 2 ? `Without ${N.excludes.join(", ")}` : `Without ${N.excludes.length} genres`) : "Leave out genres…", N.excludes.length > 0)}
        ${multi("lengthsOff", "Length", lengthOpts, (v) => !N.lengthsOff.includes(v),
          !lOn ? "Any length" : !lOn.length ? "No length" : lengthOpts.filter(([v]) => lOn.includes(v)).map(([, t]) => t.replace(/ \(.*\)/, "")).join(", "), !!lOn)}
        <label class="check"><input type="checkbox" id="rAiring"${N.airing ? " checked" : ""}> Include ${anime ? "airing" : "ongoing"}</label>
      </div>
      ${res.basis === "empty" ? `<p class="basis">There's nothing ${anime ? "watched" : "read"}, ${anime ? "watching" : "reading"} or dropped on this list yet, so these picks only use your ${plan.toLowerCase()} and MyAnimeList scores. They'll get more personal as your list grows.</p>`
        : `<p class="basis">${esc(res.basis)}</p>`}
      <p class="hint center${st.bg && st.bg.running ? " busy" : ""}" id="recBg"${bgNoteText(st) ? "" : " hidden"}>${esc(bgNoteText(st))}</p>
      ${pausedBanner(st)}
      ${S.prefs.blur ? `<p class="hint center">18+ titles are left out while "Blur 18+ covers" is on in Settings.</p>` : ""}
      ${section("Continue a series", `Sequels to ${anime ? "shows" : "series"} you finished.${sweepNote(st)}`, res.cont, "No sequels waiting for you with these filters.", { limit: N.contShown, more: "cmore", extra: "" })}
      ${section("Recommended for you", "Based on what you rate highly, and what MyAnimeList users recommend from your favorites.", res.recommended, "Nothing matches these filters.", { limit: N.shown, more: "rmore" })}
      ${section("Coming up", `Related to ${anime ? "shows" : "series"} you've seen, or on your ${plan.toLowerCase()}: not out yet, or still ${anime ? "airing" : "ongoing"}.`, res.comingUp, "Nothing announced right now.", { limit: N.soonShown, more: "smore", extra: "soon" })}`;
  }


  Object.assign(U, { keepListPosition, renderNext, resetNextPaging, syncNet });
})();
