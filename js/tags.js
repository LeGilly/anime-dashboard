// Community tags, like Steam's: anyone signed in can vote for tags on any title, and everyone sees them,
// ordered by votes. The relay keeps them in its database (worker.js, "tags"); this file loads and sends them.
// No page drawing here: the ui-*.js files show them.
"use strict";
(function () {
  const MALD = window.MALD;
  const RETRY = 60000; // after a failed load, wait this long before trying again

  const T = (MALD.tags = {
    off: false,                      // the relay has no tag database: tags are hidden everywhere
    titles: { anime: null, manga: null }, // id -> [[label, votes], ...], most votes first (null until loaded)
    mine: { anime: null, manga: null },   // id -> [label, ...]: your votes, while signed in
    mineOf: null,                    // whose votes "mine" holds (a MAL user id)
    error: { anime: 0, manga: 0 },   // when loading last failed
    onChange: () => {},              // set by the page: redraw after something loads
    version: 0,                      // goes up whenever tags change, so lists built from them are rebuilt
  });
  const loading = new Map();

  // Starts loading a kind's tags if needed; the page redraws when they arrive. Safe to call on every draw.
  T.ensure = function (kind) {
    if (T.off || !MALD.relayReady()) return;
    if (!T.titles[kind] && !loading.has(kind) && Date.now() - T.error[kind] > RETRY) {
      loading.set(kind, MALD.relayDirect("/tags", { type: kind }).then((res) => {
        T.titles[kind] = res.titles || {};
        T.version++;
      }).catch((err) => {
        if (err.status === 503) T.off = true; else T.error[kind] = Date.now();
      }).finally(() => { loading.delete(kind); T.onChange(); }));
    }
    const A = MALD.account;
    if (A.me && T.mineOf !== A.me.id) { T.mine = { anime: null, manga: null }; T.mineOf = A.me.id; }
    if (A.me && !T.mine[kind] && !loading.has("mine:" + kind) && Date.now() - T.error[kind] > RETRY) {
      loading.set("mine:" + kind, A.request("GET", "/me/tags", { type: kind }).then((res) => {
        T.mine[kind] = res.mine || {};
      }).catch((err) => {
        if (err.status === 503) T.off = true; else T.error[kind] = Date.now();
      }).finally(() => { loading.delete("mine:" + kind); T.onChange(); }));
    }
  };
  T.ready = (kind) => !!T.titles[kind];
  T.forTitle = (kind, id) => (T.titles[kind] && T.titles[kind][id]) || [];
  T.mineFor = (kind, id) => (MALD.account.me && T.mine[kind] && T.mine[kind][id]) || [];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  T.has = (kind, id, label) => T.forTitle(kind, id).some(([l]) => same(l, label));
  // Every tag in use for this kind, with how many titles carry it: most used first.
  T.all = function (kind) {
    const count = new Map();
    for (const tags of Object.values(T.titles[kind] || {})) for (const [l] of tags) count.set(l, (count.get(l) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  // Titles carrying a tag, most votes for it first: [[id, votes], ...]
  T.titlesWith = function (kind, label) {
    const out = [];
    for (const [id, tags] of Object.entries(T.titles[kind] || {})) {
      const hit = tags.find(([l]) => same(l, label));
      if (hit) out.push([Number(id), hit[1]]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  };

  // The relay answers with the title's tags after any change: keep both lists in step with it.
  function apply(kind, res) {
    T.version++;
    if (!T.titles[kind]) T.titles[kind] = {};
    if (res.tags.length) T.titles[kind][res.id] = res.tags; else delete T.titles[kind][res.id];
    if (!T.mine[kind]) T.mine[kind] = {};
    if (res.mine.length) T.mine[kind][res.id] = res.mine; else delete T.mine[kind][res.id];
    return res;
  }
  T.vote = async (kind, id, label) => apply(kind, await MALD.account.request("POST", "/me/tags", { type: kind, id }, { tag: label }));
  T.unvote = async (kind, id, label) => apply(kind, await MALD.account.request("DELETE", "/me/tags", { type: kind, id, tag: label }));
  T.removeAll = async function () {
    const res = await MALD.account.request("DELETE", "/me/tags/all");
    T.titles = { anime: null, manga: null }; // counts changed everywhere: reload when next needed
    T.version++;
    T.mine = { anime: {}, manga: {} };
    return res.removed;
  };

  // Same rules as the relay, so mistakes show before anything is sent.
  T.check = function (raw) {
    const label = String(raw || "").normalize("NFC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    if (label.length < 2 || label.length > 24) return { error: "Tags are 2 to 24 characters." };
    if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}' -]*[\p{L}\p{N}])?$/u.test(label)) return { error: "Tags can only use letters, numbers, spaces, hyphens and apostrophes." };
    return { label };
  };
})();
