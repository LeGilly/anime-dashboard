// "Next up": picks what to watch or read next from your list and MyAnimeList's public data.
// No page drawing here; ui.js shows the results.
"use strict";
(function () {
  const MALD = window.MALD;

  const ADULT = ["Hentai", "Erotica"];
  const SKIP_TYPES = ["Music", "CM", "PV"];
  const UPCOMING = ["not_yet_aired", "not_yet_published"];
  const ONGOING = ["currently_airing", "currently_publishing", "on_hiatus"];
  // Related titles worth watching out for, and how to describe them.
  const RELATION_TEXT = {
    sequel: "Sequel to", side_story: "Side story of", spin_off: "Spin-off of",
    alternative_version: "Another version of", parent_story: "Main story of", full_story: "Full story of",
  };
  const DONE = ["completed", "current", "on_hold", "dropped"]; // already started: never suggested
  MALD.REQ_PAUSE = 3000;     // background pace: about one request to MyAnimeList every 3 seconds
  MALD.MAX_PAUSE = 12000;    // slowest pace after repeated slowdowns (one request every 12 seconds)
  MALD.MAX_AUTO = 300;       // titles checked for sequels automatically (beyond favorites)
  MALD.FIRST_DETAILS = 80;   // suggested titles looked up before showing results; the rest follow in the background
  MALD.isSlowdown = (msg) => /limiting|too long|busy/i.test(msg || "");

  // Remembered between visits (not list data): when MyAnimeList last asked to slow down, and how fast to go.
  MALD.pace = {
    get() {
      const p = MALD.readCache("mald:pace");
      return { until: p.until || 0, pause: Math.max(MALD.REQ_PAUSE, p.pause || MALD.REQ_PAUSE) };
    },
    // Slowed down: wait 5 minutes (10 if it happens again soon), and halve the speed.
    slowDown() {
      const p = MALD.pace.get();
      const again = Date.now() - (p.until || 0) < 10 * 60 * 1000;
      MALD.writeCache("mald:pace", { until: Date.now() + (again ? 10 : 5) * 60 * 1000, pause: Math.min(MALD.MAX_PAUSE, p.pause * 2) });
    },
    // A full run went fine: speed back up a little.
    relax() {
      const p = MALD.pace.get();
      MALD.writeCache("mald:pace", { until: 0, pause: Math.max(MALD.REQ_PAUSE, Math.round(p.pause * 0.75)) });
    },
    // "Try again now": skip the wait, keep the slower speed.
    skipWait() {
      const p = MALD.pace.get();
      MALD.writeCache("mald:pace", { until: 0, pause: p.pause });
    },
    coolingFor() { return Math.max(0, MALD.pace.get().until - Date.now()); },
  };
  const MAX_FAVORITES = 25;  // titles whose recommendations count
  const MAX_REC_DETAILS = 60;  // recommended titles outside your list whose details are looked up

  MALD.isAdult = (e) => (e.nsfw && e.nsfw !== "white") || e.genres.some((g) => ADULT.includes(g));
  MALD.isUpcoming = (e) => UPCOMING.includes(e.airStatus);
  MALD.isOngoing = (e) => ONGOING.includes(e.airStatus);

  /* ---------- your taste ---------- */

  // How much you seem to like each title. A score always wins, compared with your own average
  // (so a strict 7 and a generous 9 can mean the same). Without a score, what you did with the
  // title stands in: rewatching it, finishing it (a long series even more), or dropping it.
  const repeated = (e) => e.repeating || e.timesRepeated > 0;
  function signals(entries) {
    const scored = entries.filter((e) => e.score && e.status !== "planned");
    const mean = scored.length ? scored.reduce((s, e) => s + e.score, 0) / scored.length : 7;
    const sd = scored.length > 1 ? Math.max(1, Math.sqrt(scored.reduce((s, e) => s + (e.score - mean) ** 2, 0) / scored.length)) : 1.5;
    const sig = new Map();
    for (const e of entries) {
      let v;
      if (e.status === "planned") continue;
      if (e.score) v = (e.score - mean) / sd;
      else if (repeated(e)) v = 1.2;
      else if (e.status === "completed") v = e.total >= 50 ? 0.6 : 0.3;
      else if (e.status === "current") v = 0.2;
      else if (e.status === "on_hold") v = -0.2;
      else if (e.status === "dropped") v = -1;
      else continue;
      sig.set(e.id, v);
    }
    return { sig, mean, scored: scored.length, total: sig.size };
  }

  // Taste per genre and studio/author: how much more you like them than your usual,
  // plus a small nudge for what you watch most. Small samples are pulled towards zero.
  function tasteProfile(entries) {
    const P = signals(entries);
    const vals = [...P.sig.values()];
    const M = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const build = (field, k) => {
      const m = new Map();
      for (const e of entries) {
        const v = P.sig.get(e.id);
        if (v === undefined) continue;
        for (const name of e[field]) {
          const g = m.get(name) || { n: 0, sum: 0, scoredN: 0, scoreSum: 0, done: 0, dropped: 0 };
          g.n++; g.sum += v;
          if (e.score) { g.scoredN++; g.scoreSum += e.score; }
          if (e.status === "completed" || repeated(e)) g.done++;
          if (e.status === "dropped") g.dropped++;
          m.set(name, g);
        }
      }
      const avgN = m.size ? [...m.values()].reduce((s, g) => s + g.n, 0) / m.size : 1;
      for (const g of m.values()) {
        const freq = Math.max(-0.3, Math.min(0.3, Math.log((g.n + 1) / (avgN + 1)) * 0.15));
        g.aff = (g.sum / g.n - M) * (g.n / (g.n + k)) + freq;
        g.avgScore = g.scoredN ? g.scoreSum / g.scoredN : null;
      }
      // Behaviour varies less than scores, so put everyone's likes and dislikes on the same scale:
      // taste then counts as much for someone who never scores as for someone who scores everything.
      const affs = [...m.values()].filter((g) => g.n >= 3).map((g) => g.aff);
      if (affs.length >= 3) {
        const avg = affs.reduce((a, b) => a + b, 0) / affs.length;
        const spread = Math.sqrt(affs.reduce((s, x) => s + (x - avg) ** 2, 0) / affs.length);
        if (spread > 0.01) for (const g of m.values()) g.aff = (g.aff / spread) * 0.5;
      }
      return m;
    };
    return Object.assign(P, { genres: build("genres", 3), creators: build("creators", 2) });
  }

  // Your strongest likes, used to gather MAL users' recommendations.
  // Ties go to what you finished most recently, as taste changes over time.
  function favorites(entries, P) {
    const recent = (e) => e.myFinish || e.updatedAt || "";
    return entries.filter((e) => (P.sig.get(e.id) ?? -9) > 0.25)
      .sort((a, b) => P.sig.get(b.id) - P.sig.get(a.id) || recent(b).localeCompare(recent(a)) || (b.mean || 0) - (a.mean || 0))
      .slice(0, MAX_FAVORITES);
  }

  // Titles whose MAL recommendations and related titles we look up, in three groups:
  //  favs:   your top favorites (their MAL recommendations feed "Recommended for you"); checked first
  //  auto:   titles likely to matter for sequels, checked automatically in the background (up to MAX_AUTO):
  //          finished or updated in the last 2 years, rated above your average, or rewatched
  //  others: everything else you've finished or are watching; not checked (only counted)
  MALD.recSeeds = function (entries) {
    const P = signals(entries);
    const favs = favorites(entries, P).map((e) => e.id);
    const favSet = new Set(favs);
    const since = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const recent = (e) => (e.myFinish || e.updatedAt || "").slice(0, 10) >= since;
    const likely = (e) => recent(e) || (e.score && e.score > P.mean) || repeated(e);
    const order = (a, b) => b.score - a.score || (b.myFinish || b.updatedAt || "").localeCompare(a.myFinish || a.updatedAt || "");
    const rest = entries.filter((e) => (e.status === "completed" || e.status === "current") && !favSet.has(e.id)).sort(order);
    const auto = rest.filter(likely).slice(0, MALD.MAX_AUTO).map((e) => e.id);
    const autoSet = new Set(auto);
    const others = rest.filter((e) => !autoSet.has(e.id)).map((e) => e.id);
    return { favs, auto, others };
  };

  /* ---------- fetching (cached in the browser) ---------- */

  // Saved per title: only the numbers needed ([id, recommenders] and [id, relation]),
  // so even a list of thousands fits in the browser. Names and covers come from the details.
  const slimLinks = (l) => ({
    id: l.id,
    recs: (l.recs || []).map((r) => (r.length > 2 ? [r[0], r[3]] : r)),
    related: (l.related || []).map((r) => (r.length > 2 ? [r[0], r[3]] : r)),
  });

  // What's already saved, and what still needs checking: missing titles first, then ones saved over a week ago.
  // Old saved data is still used until it's refreshed.
  MALD.planLinks = function (kind, seeds) {
    const key = `mald:links:${kind}`;
    const cache = MALD.readCache(key);
    const now = Date.now();
    const links = new Map();
    const missing = [];
    const stale = [];
    let resave = false;
    for (const id of seeds) {
      const hit = cache[id];
      if (!hit) { missing.push(id); continue; }
      const v = slimLinks(hit[1]);
      if (v.recs.some((r, i) => hit[1].recs[i].length > 2) || v.related.some((r, i) => hit[1].related[i].length > 2)) { cache[id] = [hit[0], v]; resave = true; }
      links.set(id, v);
      if (!(now - hit[0] < MALD.LINKS_TTL)) stale.push(id);
    }
    if (resave) MALD.writeCache(key, cache);
    return { kind, key, cache, links, missing, stale };
  };

  // Checks up to 25 titles (one relay call) and saves the results.
  MALD.fetchLinks = async function (plan, ids) {
    const res = await MALD.relay("/links", { type: plan.kind, ids: ids.join(",") });
    const now = Date.now();
    for (const it of res.items) {
      const v = it.missing ? { id: it.id, recs: [], related: [] } : slimLinks(it);
      plan.cache[it.id] = [now, v];
      plan.links.set(it.id, v);
    }
    MALD.writeCache(plan.key, plan.cache);
  };

  // offline: only use what's saved (while MyAnimeList needs a break). pause: wait between calls.
  MALD.loadDetails = async function (kind, ids, { offline = false, pause = 0 } = {}) {
    const key = `mald:details:${kind}`;
    const cache = MALD.readCache(key);
    const now = Date.now();
    const details = new Map();
    const todo = [];
    for (const id of ids) {
      const hit = cache[id];
      if (hit && (offline || now - hit[0] < MALD.DETAILS_TTL)) details.set(id, hit[1]); else if (!offline) todo.push(id);
    }
    let error = null;
    try {
      for (let i = 0; i < todo.length; i += 25) {
        if (i && pause) await new Promise((r) => setTimeout(r, pause));
        const res = await MALD.relay("/details", { type: kind, ids: todo.slice(i, i + 25).join(",") });
        for (const node of res.items) {
          const d = node.missing ? { missing: true } : MALD.detailsFromNode(node, kind);
          cache[node.id] = [now, d];
          details.set(node.id, d);
        }
      }
    } catch (err) {
      error = err.message;
    }
    MALD.writeCache(key, cache);
    return { details, error };
  };

  /* ---------- gathering candidates ---------- */

  function gather(entries, links) {
    const profile = tasteProfile(entries);
    const favs = favorites(entries, profile);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const cands = new Map();
    const cand = (id) => {
      let c = cands.get(id);
      if (!c) cands.set(id, (c = { id, recPts: 0, recBy: [], seqOf: [], relOf: [] }));
      return c;
    };
    // MAL users' recommendations from your favorites.
    for (const f of favs) {
      const l = links.get(f.id);
      if (!l) continue;
      const w = Math.max(0.3, profile.sig.get(f.id) + 1);
      for (const [id, num] of l.recs) {
        const pts = w * Math.log2(1 + num);
        const c = cand(id);
        c.recPts += pts;
        c.recBy.push({ e: f, pts });
      }
    }
    // Sequels and other related titles of what you've finished or are watching.
    for (const e of entries) {
      if (e.status !== "completed" && e.status !== "current") continue;
      const l = links.get(e.id);
      if (!l) continue;
      for (const [id, rel] of l.related) {
        if (!RELATION_TEXT[rel]) continue;
        const c = cand(id);
        if (rel === "sequel" && e.status === "completed") c.seqOf.push(e);
        c.relOf.push({ e, rel });
      }
    }
    // Plan-to-watch titles are always candidates.
    for (const e of entries) if (e.status === "planned") cand(e.id);
    // Drop anything you've already started.
    for (const [id] of cands) {
      const mine = byId.get(id);
      if (mine && DONE.includes(mine.status)) cands.delete(id);
    }
    return { profile, cands, byId, favs };
  }

  // Titles outside your list that need details (genres, status, length) before they can be judged.
  MALD.recDetailIds = function (entries, links) {
    const { cands, byId } = gather(entries, links);
    const off = [...cands.values()].filter((c) => !byId.has(c.id));
    const linked = off.filter((c) => c.seqOf.length || c.relOf.length);
    const recs = off.filter((c) => !c.seqOf.length && !c.relOf.length).sort((a, b) => b.recPts - a.recPts);
    // Every sequel or related title is needed (for "Continue a series" and "Coming up"); recommendations only the strongest.
    return [...linked, ...recs.slice(0, MAX_REC_DETAILS)].map((c) => c.id);
  };

  /* ---------- scoring ---------- */

  // Every genre among the possible picks, for the genre lists.
  MALD.recGenres = function (entries, kind, links, details) {
    const { cands, byId } = gather(entries, links);
    const names = new Set();
    for (const c of cands.values()) {
      const e = byId.get(c.id) || details.get(c.id);
      if (e && e.genres) e.genres.forEach((g) => names.add(g));
    }
    return [...names].sort();
  };

  MALD.recommend = function (entries, kind, links, details, opts, titleOf) {
    const { profile, cands, byId, favs } = gather(entries, links);
    const sigOf = (e) => profile.sig.get(e.id) ?? 0;
    const why = (e) => (e.score ? ` (you rated it ${e.score})` : repeated(e) ? ` (you ${kind === "manga" ? "reread" : "rewatched"} it)` : "");
    const unit = kind === "manga" ? "manga" : "titles";
    // A genre/studio reason: their average score if you've scored enough of them, otherwise what you finished.
    const tasteReason = (name, g, isCreator) => {
      if (g.scoredN >= 3) return `You rate ${name} ${g.avgScore.toFixed(1)} on average`;
      if (g.done >= 3) return isCreator
        ? `You've finished ${g.done} ${unit} ${kind === "manga" ? "by" : "from"} ${name}`
        : `You've finished ${g.done} ${name} ${unit}${g.dropped ? "" : ", and dropped none"}`;
      return null;
    };
    const maxRec = Math.max(1, ...[...cands.values()].map((c) => c.recPts));
    const anime = kind === "anime";
    const out = [];

    for (const c of cands.values()) {
      let e = byId.get(c.id);
      const onList = !!e;
      if (!e) {
        const d = details.get(c.id);
        if (!d || d.missing) continue; // can't judge a title we know nothing about
        e = MALD.makeEntry(Object.assign({ id: c.id, kind }, d, { status: null }));
      }
      if (SKIP_TYPES.includes(e.mediaType)) continue;

      // Taste: average affinity of its genres, plus half of its studios/authors.
      const affs = e.genres.map((g) => (profile.genres.get(g) || { aff: 0 }).aff);
      const cAffs = e.creators.map((s) => (profile.creators.get(s) || { aff: 0 }).aff);
      const taste = (affs.length ? affs.reduce((a, b) => a + b, 0) / affs.length : 0)
        + 0.5 * (cAffs.length ? Math.max(...cAffs) : 0);
      const rec = (c.recPts / maxRec) * 2.5;
      const bestPrev = c.seqOf.reduce((b, p) => (!b || sigOf(p) > sigOf(b) ? p : b), null);
      const seq = bestPrev ? 1.5 + Math.max(0, sigOf(bestPrev)) * 0.6 : 0;
      const mal = e.mean ? (e.mean - 7.5) * 0.6 : 0;
      const score = taste + rec + seq + mal;

      // Why it was picked, strongest reasons first.
      const reasons = [];
      if (bestPrev) reasons.push(`Sequel to ${titleOf(bestPrev)}${why(bestPrev)}`);
      else if (c.relOf.length) {
        const r = c.relOf[0];
        reasons.push(`${RELATION_TEXT[r.rel]} ${titleOf(r.e)}`);
      }
      if (c.recBy.length) {
        const by = c.recBy.sort((a, b) => b.pts - a.pts).map((r) => r.e);
        const names = by.slice(0, 2).map((x, i) => titleOf(x) + (i === 0 && !x.score && repeated(x) ? why(x) : ""));
        const more = by.length - 2;
        reasons.push(`Recommended from ${names.join(" and ")}${more > 0 ? ` and ${more} more` : ""}`);
      }
      const bestGenre = e.genres.map((g) => [g, profile.genres.get(g)]).filter(([g, p]) => p && p.aff > 0.15 && tasteReason(g, p))
        .sort((a, b) => b[1].aff - a[1].aff)[0];
      if (bestGenre) reasons.push(tasteReason(bestGenre[0], bestGenre[1]));
      const bestCreator = e.creators.map((s) => [s, profile.creators.get(s)]).filter(([s, p]) => p && p.aff > 0.3 && tasteReason(s, p, true))
        .sort((a, b) => b[1].aff - a[1].aff)[0];
      if (bestCreator) reasons.push(tasteReason(bestCreator[0], bestCreator[1], true));
      if (e.mean && e.mean >= 8.5) reasons.push(`MAL score ${e.mean.toFixed(2)}`);

      out.push({ e, onList, score, reasons: reasons.slice(0, 3), isSequel: !!bestPrev, related: c.relOf.length > 0, recommended: c.recPts > 0 });
    }

    // Filters.
    // Several lengths can be ticked: a title passes if it matches any of them.
    // null means every length is ticked: no filtering (titles of unknown length stay in).
    const lengthOk = (e) => !opts.lengths || opts.lengths.some((L) => oneLength(e, L));
    const oneLength = (e, L) => {
      if (anime) {
        if (L === "movie") return e.mediaType === "Movie";
        if (e.mediaType === "Movie" || !e.total) return false;
        if (L === "short") return e.total <= 13;
        if (L === "medium") return e.total >= 14 && e.total <= 26;
        return e.total > 26;
      }
      if (L === "oneshot") return e.mediaType === "One-shot";
      if (L === "short") return e.totalVol > 0 && e.totalVol <= 5;
      return e.totalVol > 5;
    };
    // Ticked genres: any of them (or all of them with "must have all"); null means every genre is ticked.
    // Left-out genres: none of them.
    const genreOk = (x) => {
      const g = x.e.genres;
      const want = opts.genres;
      if (want && !(opts.matchAll ? want.length && want.every((w) => g.includes(w)) : want.some((w) => g.includes(w)))) return false;
      if (opts.excludes.some((w) => g.includes(w))) return false;
      return !(opts.hideAdult && MALD.isAdult(x.e));
    };
    const released = (x) => !MALD.isUpcoming(x.e) && (opts.airing || !MALD.isOngoing(x.e));
    const sourceOk = (x) => opts.source === "both" || (opts.source === "list" ? x.onList : !x.onList);
    const byScore = (a, b) => b.score - a.score;

    const pool = out.filter(genreOk);
    // The source filter (everything / plan to watch / not on my list) applies to every section.
    const cont = pool.filter((x) => x.isSequel && released(x) && lengthOk(x.e) && sourceOk(x)).sort(byScore);
    const contIds = new Set(cont.map((x) => x.e.id));
    const recommended = pool.filter((x) => !contIds.has(x.e.id) && released(x) && lengthOk(x.e) && sourceOk(x)
      && (x.onList || x.recommended)).sort(byScore);
    const shown = new Set([...contIds, ...recommended.map((x) => x.e.id)]);
    const comingUp = pool.filter((x) => !shown.has(x.e.id) && sourceOk(x) && (MALD.isUpcoming(x.e) || MALD.isOngoing(x.e)) && (x.related || x.onList))
      .sort((a, b) => (MALD.isOngoing(b.e) - MALD.isOngoing(a.e)) || (a.e.airStart || "9999").localeCompare(b.e.airStart || "9999"));
    const genres = [...new Set(out.flatMap((x) => x.e.genres))].sort();
    // What the picks are based on, so the page can say so.
    const done = anime ? "finished, rewatched or dropped" : "finished, reread or dropped";
    const basis = !profile.total ? "empty"
      : !profile.scored ? `Based on what you ${done}, since you haven't scored anything yet. Scoring titles makes these picks more personal.`
      : profile.scored / profile.total >= 0.8 ? "Based mainly on your scores."
      : `Based on your scores, and on what you ${done} for titles you haven't scored.`;
    return { cont, recommended, comingUp, genres, pool: new Map(out.map((x) => [x.e.id, x.e])), profile, basis, favorites: favs.length };
  };
})();
