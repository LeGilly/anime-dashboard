// Signing in with MyAnimeList, and changing your own list.
// The sign-in itself is held by the relay in a locked cookie on api.legilly.com: this code never sees it.
// No page drawing here; ui.js shows the results.
"use strict";
(function () {
  const MALD = window.MALD;

  // Sign-in is only offered on the dashboard's own address (and on this computer, for testing).
  const SIGNIN_HOSTS = ["anime.legilly.com", "localhost", "127.0.0.1"];
  const base = () => ((window.MALD_CONFIG && window.MALD_CONFIG.relay) || "").replace(/\/+$/, "");

  const A = (MALD.account = {
    me: null,    // { id, name, picture } when signed in
    mine: null,  // your own list (same shape as a loaded list, source "mine")
    available: () => MALD.relayReady() && SIGNIN_HOSTS.includes(location.hostname),
  });

  /* ---------- talking to the relay with the sign-in cookie ---------- */

  // One account request at a time: MAL's refresh keys can only be used once, so two requests
  // refreshing at the same moment could sign you out.
  let queue = Promise.resolve();
  function call(method, path, params, body) {
    const run = () => send(method, path, params, body);
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  async function send(method, path, params, body) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), MALD.RELAY_TIMEOUT);
    let res;
    try {
      res = await fetch(`${base()}${path}${params ? "?" + new URLSearchParams(params) : ""}`, {
        method, credentials: "include", signal: stop.signal,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(stop.signal.aborted
        ? "MyAnimeList took too long to answer. It may be busy or limiting requests; try again in a minute."
        : "Couldn't reach the relay. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401) {
      A.me = null;
      throw Object.assign(new Error((data && data.error) || "Your sign-in expired. Sign in again."), { status: 401 });
    }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `The relay answered with error ${res.status}.`), { status: res.status });
    return data;
  }

  /* ---------- signing in and out ---------- */

  A.check = async function () {
    if (!A.available()) return null;
    try { A.me = await call("GET", "/me"); } catch { A.me = null; }
    if (A.me) {
      const saved = MALD.loadMine();
      A.mine = saved && saved.user.toLowerCase() === A.me.name.toLowerCase() ? saved : null;
    } else A.mine = null;
    return A.me;
  };

  A.signIn = function () {
    location.href = `${base()}/auth/login?${new URLSearchParams({ return: location.origin + location.pathname })}`;
  };

  A.signOut = async function () {
    try { await call("POST", "/auth/logout"); } catch { /* the cookie may already be gone */ }
    A.me = null;
    A.mine = null;
    MALD.saveMine(null);
  };

  // Your own list, private entries included.
  A.loadMine = async function () {
    const kinds = ["anime", "manga"];
    const results = await Promise.allSettled(kinds.map((type) => call("GET", "/me/list", { type })));
    if (results.every((r) => r.status === "rejected")) throw results[0].reason;
    const data = { user: A.me.name, source: "mine", fetchedAt: Date.now(), anime: null, manga: null, notes: [] };
    results.forEach((r, i) => {
      if (r.status === "fulfilled") data[kinds[i]] = r.value.items.map((it) => MALD.entryFromApi(it, kinds[i]));
      else data.notes.push(`Your ${kinds[i]} list couldn't be loaded: ${r.reason.message}`);
    });
    A.mine = data;
    MALD.saveMine(data);
    return data;
  };

  // Your entry for a title, if it's on your list.
  A.myEntry = function (kind, id) {
    const l = A.mine && A.mine[kind];
    return l ? l.find((x) => x.id === Number(id)) || null : null;
  };

  /* ---------- changing your list ---------- */

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const FIELDS = ["status", "score", "progress", "progressVol", "repeating", "timesRepeated", "myStart", "myFinish"];
  const API_STATUS = {
    anime: { current: "watching", completed: "completed", on_hold: "on_hold", dropped: "dropped", planned: "plan_to_watch" },
    manga: { current: "reading", completed: "completed", on_hold: "on_hold", dropped: "dropped", planned: "plan_to_read" },
  };

  // Works out the full result of a change, filling things in like MAL's website does:
  //  - first episode: Watching, with today as the start date (if empty)
  //  - last episode: Completed, with today as the finish date; during a rewatch, it ends the rewatch instead
  //  - marking Completed fills in every episode (and volume)
  //  - starting a rewatch starts again from episode 0
  A.plan = function (e, change) {
    const was = Object.fromEntries(FIELDS.map((k) => [k, e[k]]));
    const n = Object.assign({}, was, change);
    const finish = () => {
      if (e.total) n.progress = e.total;
      if (e.totalVol) n.progressVol = e.totalVol;
      if (n.repeating) { n.repeating = false; n.timesRepeated = (n.timesRepeated || 0) + 1; }
      else if (!n.myFinish) n.myFinish = today();
      n.status = "completed";
    };
    if ("repeating" in change && change.repeating && !was.repeating) { n.status = "current"; n.progress = 0; n.progressVol = 0; }
    if ("repeating" in change && !change.repeating && was.repeating) n.status = "completed";
    if ("progress" in change) {
      n.progress = Math.max(0, Math.min(n.progress, e.total || Infinity));
      if (n.progress > 0 && (!was.status || was.status === "planned")) { n.status = "current"; if (!n.myStart) n.myStart = today(); }
      if (e.total && n.progress >= e.total && (n.repeating || n.status !== "completed")) finish();
    }
    if ("progressVol" in change) n.progressVol = Math.max(0, Math.min(n.progressVol, e.totalVol || Infinity));
    if ("status" in change) {
      if (change.status === "completed" && (was.status !== "completed" || was.repeating)) finish();
      if (change.status === "current" && !n.myStart) n.myStart = today();
      if (change.status !== "current" && change.status !== "completed") n.repeating = false;
    }
    return n;
  };

  // What MAL needs to hear, for everything that differs from before.
  function toApi(kind, was, n) {
    const anime = kind === "anime";
    const body = {};
    const changed = (k) => n[k] !== was[k];
    if (changed("status") || changed("repeating")) {
      body.status = n.repeating ? "completed" : API_STATUS[kind][n.status];
      body[anime ? "is_rewatching" : "is_rereading"] = !!n.repeating;
    }
    if (changed("score")) body.score = n.score || 0;
    if (changed("progress")) body[anime ? "num_watched_episodes" : "num_chapters_read"] = n.progress || 0;
    if (!anime && changed("progressVol")) body.num_volumes_read = n.progressVol || 0;
    if (changed("timesRepeated")) body[anime ? "num_times_rewatched" : "num_times_reread"] = n.timesRepeated || 0;
    if (changed("myStart") && n.myStart) body.start_date = n.myStart;
    if (changed("myFinish") && n.myFinish) body.finish_date = n.myFinish;
    return body;
  }

  // Applies a change straight away, sends it to MAL, and puts things back if MAL refuses.
  // onDone(error) is called when MAL has answered.
  A.edit = async function (e, change) {
    const was = Object.fromEntries(FIELDS.map((k) => [k, e[k]]));
    const n = A.plan(e, change);
    const body = toApi(e.kind, was, n);
    if (!Object.keys(body).length) return { e, unchanged: true };
    Object.assign(e, n, { updatedAt: new Date().toISOString() });
    MALD.saveMine(A.mine);
    try {
      await call("PATCH", "/me/entry", { type: e.kind, id: e.id }, body);
      return { e };
    } catch (err) {
      Object.assign(e, was);
      MALD.saveMine(A.mine);
      throw err;
    }
  };

  // Adds a title to your plan-to-watch (or plan-to-read).
  A.addPlanned = async function (source) {
    const kind = source.kind;
    if (A.myEntry(kind, source.id)) return A.myEntry(kind, source.id);
    const entry = MALD.makeEntry(Object.assign({}, source, {
      status: "planned", score: 0, progress: 0, progressVol: 0, repeating: false, timesRepeated: 0,
      myStart: "", myFinish: "", updatedAt: new Date().toISOString(), enriched: true,
    }));
    const listOf = A.mine && (A.mine[kind] || (A.mine[kind] = []));
    if (listOf) { listOf.push(entry); MALD.saveMine(A.mine); }
    try {
      await call("PATCH", "/me/entry", { type: kind, id: source.id }, { status: API_STATUS[kind].planned });
      return entry;
    } catch (err) {
      if (listOf) { listOf.splice(listOf.indexOf(entry), 1); MALD.saveMine(A.mine); }
      throw err;
    }
  };

  // Removes a title from your list.
  A.remove = async function (e) {
    await call("DELETE", "/me/entry", { type: e.kind, id: e.id });
    const listOf = A.mine && A.mine[e.kind];
    if (listOf) {
      const i = listOf.findIndex((x) => x.id === e.id);
      if (i >= 0) listOf.splice(i, 1);
      MALD.saveMine(A.mine);
    }
  };
})();
