// Number crunching for the Stats and Progress views. No page drawing here.
"use strict";
(function () {
  const MALD = window.MALD;

  // Episodes / chapters consumed, counting rewatches and rereads.
  // During a rewatch, progress is the rewatch's progress, so the first full watch is added.
  MALD.unitsDone = (e) => e.progress + (e.timesRepeated + (e.repeating ? 1 : 0)) * e.total;
  // Seconds spent on an entry. Anime only (manga has no length).
  MALD.secondsSpent = (e) => (e.kind === "anime" ? MALD.unitsDone(e) * e.duration : 0);
  MALD.remaining = (e) => (e.total ? Math.max(0, e.total - e.progress) : null);

  MALD.summary = function (entries) {
    const byStatus = Object.fromEntries(MALD.STATUS_ORDER.map((s) => [s, 0]));
    let units = 0, vols = 0, seconds = 0, scoreSum = 0, scored = 0, noLength = 0;
    for (const e of entries) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      units += MALD.unitsDone(e);
      vols += e.progressVol;
      seconds += MALD.secondsSpent(e);
      if (e.kind === "anime" && e.progress && !e.duration) noLength++;
      if (e.score) { scoreSum += e.score; scored++; }
    }
    return {
      count: entries.length, byStatus, units, vols, seconds, noLength,
      mean: scored ? scoreSum / scored : null, scored,
    };
  };

  // Genres or studios/authors, counted over everything except plan-to-watch.
  MALD.groupBy = function (entries, field) {
    const map = new Map();
    for (const e of entries) {
      if (e.status === "planned") continue;
      for (const name of e[field]) {
        let g = map.get(name);
        if (!g) map.set(name, (g = { name, count: 0, scoreSum: 0, scored: 0, seconds: 0, units: 0 }));
        g.count++;
        g.seconds += MALD.secondsSpent(e);
        g.units += MALD.unitsDone(e);
        if (e.score) { g.scoreSum += e.score; g.scored++; }
      }
    }
    return [...map.values()].map((g) => Object.assign(g, { mean: g.scored ? g.scoreSum / g.scored : null }));
  };

  // Completed titles by the year (and month) you finished them.
  MALD.history = function (entries) {
    const years = new Map();
    let undated = 0;
    for (const e of entries) {
      if (e.status !== "completed" && !e.repeating) continue;
      const m = /^(\d{4})(?:-(\d{2}))?/.exec(e.myFinish || "");
      if (!m) { undated++; continue; }
      const y = Number(m[1]);
      let yr = years.get(y);
      if (!yr) years.set(y, (yr = { year: y, count: 0, seconds: 0, units: 0, months: Array.from({ length: 12 }, () => ({ count: 0, seconds: 0, units: 0 })), noMonth: 0 }));
      const add = (o) => { o.count++; o.seconds += MALD.secondsSpent(e); o.units += MALD.unitsDone(e); };
      add(yr);
      if (m[2]) add(yr.months[Number(m[2]) - 1]); else yr.noMonth++;
    }
    // Fill gaps so missing years show as empty bars.
    const list = [...years.values()].sort((a, b) => a.year - b.year);
    if (list.length) {
      const filled = [];
      for (let y = list[0].year; y <= list[list.length - 1].year; y++) {
        filled.push(years.get(y) || { year: y, count: 0, seconds: 0, units: 0, months: Array.from({ length: 12 }, () => ({ count: 0, seconds: 0, units: 0 })), noMonth: 0 });
      }
      return { years: filled, undated };
    }
    return { years: [], undated };
  };

  /* ---------- formatting ---------- */

  MALD.fmtNum = (n) => Math.round(n).toLocaleString("en-US");
  MALD.fmtDur = function (seconds) {
    const h = seconds / 3600;
    if (h >= 48) return `${(h / 24).toFixed(1)} days`;
    if (h >= 1) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
    return `${Math.round(seconds / 60)} min`;
  };
  MALD.fmtAgo = function (iso) {
    const t = typeof iso === "number" ? iso : Date.parse(iso);
    if (!t) return "";
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "just now";
    const steps = [[3600, 60, "minute"], [86400, 3600, "hour"], [86400 * 30, 86400, "day"], [86400 * 365, 86400 * 30, "month"], [Infinity, 86400 * 365, "year"]];
    for (const [max, unit, name] of steps) {
      if (s < max) { const n = Math.round(s / unit); return `${n} ${name}${n === 1 ? "" : "s"} ago`; }
    }
    return "";
  };
  MALD.fmtDate = function (s) {
    if (!s) return "";
    const [y, m, d] = s.split("-").map(Number);
    if (!m) return String(y);
    const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return d ? `${d} ${month} ${y}` : `${month} ${y}`;
  };
})();
