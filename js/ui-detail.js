// Anime Dashboard, part 4 of 5: the detail panel, the editor, Related titles, and changes to your list.
"use strict";
(function () {
  const MALD = window.MALD;
  const U = MALD.ui;
  const { $, A, S, canEdit, esc, hidden18, list, malUrl, owner, progressText, render, statusText, titleOf, toast } = U;

  /* ---------- detail panel ---------- */

  // While the panel is open, the page behind it must not scroll (phones ignore overflow: hidden alone),
  // so the page is pinned where it was and put back exactly there when the panel closes.
  let lockedAt = null;
  function lockPage() {
    if (lockedAt !== null) return;
    lockedAt = window.scrollY;
    document.body.style.top = `-${lockedAt}px`;
    document.body.classList.add("locked");
  }
  function unlockPage() {
    if (lockedAt === null) return;
    document.body.classList.remove("locked");
    document.body.style.top = "";
    window.scrollTo(0, lockedAt);
    lockedAt = null;
  }

  // The "on your list" part of the panel: an editor on your own list (signed in); on someone else's list,
  // their entry plus your own status for that title; otherwise, as before.
  function listSection(e, theirs) {
    const anime = e.kind === "anime";
    if (canEdit()) return e.status ? `<h3>On your list</h3>${editor(e)}` : `<h3>On your list</h3><p>Not on your list yet.</p>${addButton(e)}`;
    const whose = A.me ? `On ${esc(S.data.user)}'s list` : "On your list";
    let html = `<h3>${whose}</h3><dl>${theirs}</dl>`;
    if (A.me) {
      const m = A.myEntry(e.kind, e.id);
      html += `<h3>On your list</h3>` + (m
        ? `<p class="mystat"><span class="pill"><i class="dot st-${m.status}"></i>${esc(statusText(m))}</span>${m.score ? ` · ★ ${m.score}` : ""}${m.status === "current" || m.status === "on_hold" ? ` · ${anime ? "Ep" : "Ch"} ${progressText(m)}` : ""}</p>`
        : `<p>Not on your list.</p>${addButton(e)}`);
    }
    return html;
  }
  const addButton = (e) => `<p><button type="button" class="mbtn" data-add="${e.id}">+ Add to my ${e.kind === "manga" ? "plan to read" : "plan to watch"}</button></p>`;

  // Editor for your own entry; every change is sent to MAL straight away.
  function editor(e) {
    const anime = e.kind === "anime";
    const statusOpts = MALD.STATUS_UI.map((s) => `<option value="${s}"${e.status === s ? " selected" : ""}>${esc(MALD.statusLabel(s, e.kind))}</option>`).join("");
    const SCORES = ["", "Appalling", "Horrible", "Very bad", "Bad", "Average", "Fine", "Good", "Very good", "Great", "Masterpiece"];
    const scoreOpts = `<option value="0">No score</option>` + [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}"${e.score === n ? " selected" : ""}>${n} · ${SCORES[n]}</option>`).join("");
    const full = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "");
    const stepper = (field, label, value, total) => `
      <div class="step">
        <span class="step-l">${label}</span>
        <button type="button" class="ghost" data-step="${field}" data-by="-1" aria-label="One less"${value <= 0 ? " disabled" : ""}>−</button>
        <input type="number" inputmode="numeric" min="0"${total ? ` max="${total}"` : ""} value="${value}" data-f="${field}" aria-label="${label}">
        <span class="step-t">/ ${total || "?"}</span>
        <button type="button" class="ghost" data-step="${field}" data-by="1" aria-label="One more"${total && value >= total ? " disabled" : ""}>+</button>
      </div>`;
    return `<div class="editor" data-edit="${e.id}">
      <div class="erow">
        <label>Status <select data-f="status">${statusOpts}</select></label>
        <label>Score <select data-f="score">${scoreOpts}</select></label>
      </div>
      ${stepper("progress", anime ? "Episodes" : "Chapters", e.progress, e.total)}
      ${!anime ? stepper("progressVol", "Volumes", e.progressVol, e.totalVol) : ""}
      <div class="erow">
        <label class="chk"><input type="checkbox" data-f="repeating"${e.repeating ? " checked" : ""}> ${anime ? "Rewatching" : "Rereading"}</label>
        <label>${anime ? "Times rewatched" : "Times reread"} <input type="number" inputmode="numeric" min="0" value="${e.timesRepeated || 0}" data-f="timesRepeated" class="small"></label>
      </div>
      <div class="erow">
        <label>Started <input type="date" value="${full(e.myStart)}" data-f="myStart"></label>
        <label>Finished <input type="date" value="${full(e.myFinish)}" data-f="myFinish"></label>
      </div>
      <p class="esave" aria-live="polite">${e.updatedAt ? `Last updated ${esc(MALD.fmtAgo(e.updatedAt))}` : ""}</p>
      <p class="eremove"><button type="button" class="link danger" data-act="remove">Remove from list</button></p>
    </div>`;
  }

  function findEntry(id) {
    return (list() || []).find((x) => String(x.id) === String(id)) || S.recPool.get(Number(id)) || S.relPool.get(Number(id)) || S.searchPool.get(`${S.kind}:${Number(id)}`);
  }

  function openDetail(id) {
    const e = findEntry(id);
    if (!e) return;
    S.detailTrail = [];
    fillDetail(e);
    lockPage();
    $("detail").showModal();
    $("detail").scrollTop = 0;
  }

  function fillDetail(e) {
    const anime = e.kind === "anime";
    const dl = (pairs) => pairs.filter((p) => p[1] !== "" && p[1] != null).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const theirs = !e.status ? `<dt>Status</dt><dd>Not on ${owner()} list yet</dd>` : dl([
      ["Status", `<span class="pill"><i class="dot st-${e.status}"></i>${esc(statusText(e))}</span>`],
      [owner() === "your" ? "Your score" : "Score", e.score ? `★ ${e.score}` : "Not scored"],
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
    S.detailId = e.id;
    const back = S.detailTrail.length ? findEntry(S.detailTrail[S.detailTrail.length - 1]) : null;
    $("detail").innerHTML = `
      <div class="d-wrap">
        <button class="d-close ghost" data-act="close" aria-label="Close">✕</button>
        ${img ? `<img class="d-cover${hidden18(e) ? " nsfw" : ""}" src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : ""}
        <div class="d-body">
          ${back ? `<button type="button" class="link d-back" data-act="relback">&larr; Back to ${esc(titleOf(back))}</button>` : ""}
          <h2>${esc(titleOf(e))}</h2>
          ${e.titleEn && e.titleEn !== titleOf(e) ? `<p class="sub">${esc(e.titleEn)}</p>` : e.titleEn && e.title !== titleOf(e) ? `<p class="sub">${esc(e.title)}</p>` : ""}
          ${e.genres.length ? `<ul class="tags">${e.genres.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          ${listSection(e, theirs)}
          ${info ? `<h3>About</h3><dl>${info}</dl>` : ""}
          ${relatedSection(e)}
          <p><a class="btn" href="${malUrl(e)}" target="_blank" rel="noopener">Open on MyAnimeList</a></p>
        </div>
      </div>`;
  }

  /* ---------- related titles in the detail panel ----------
     Sequels, prequels, movies… as MAL lists them. One MyAnimeList request per title the first time
     (names, covers and how they're related come together), then saved for 30 days. */
  const REL_ORDER = ["prequel", "sequel", "parent_story", "full_story", "side_story", "spin_off",
    "alternative_setting", "alternative_version", "summary", "adaptation", "character", "other"];
  const REL_LABEL = {
    prequel: "Prequel", sequel: "Sequel", parent_story: "Main story", full_story: "Full story", side_story: "Side story",
    spin_off: "Spin-off", alternative_setting: "Alternative setting", alternative_version: "Alternative version",
    summary: "Summary", adaptation: "Adaptation", character: "Same characters", other: "Other",
  };
  const REL_MAIN = ["prequel", "sequel", "parent_story", "side_story"]; // shown straight away; the rest behind a button
  const REL_MAX = 300; // titles whose related list is kept
  const relLoading = new Map();
  const relKey = (kind) => `mald:related:${kind}`;
  function relatedSaved(e) {
    const hit = MALD.readCache(relKey(e.kind))[e.id];
    return hit && Date.now() - hit[0] < MALD.LINKS_TTL ? hit[1] : null;
  }
  function loadRelated(e) {
    const k = `${e.kind}:${e.id}`;
    if (!relLoading.has(k)) {
      relLoading.set(k, MALD.relay("/links", { type: e.kind, ids: String(e.id) }, { priority: 0 }).then((res) => {
        const it = res.items[0] || {};
        const rel = it.missing ? [] : (it.related || []).map(([id, title, pic, how]) => [id, title, pic, how]);
        const cache = MALD.readCache(relKey(e.kind));
        cache[e.id] = [Date.now(), rel];
        const ids = Object.keys(cache);
        if (ids.length > REL_MAX) ids.sort((a, b) => cache[a][0] - cache[b][0]).slice(0, ids.length - REL_MAX).forEach((id) => delete cache[id]);
        MALD.writeCache(relKey(e.kind), cache);
        return rel;
      }).finally(() => relLoading.delete(k)));
    }
    return relLoading.get(k);
  }
  function relatedSection(e) {
    if (!MALD.relayReady()) return "";
    const rel = relatedSaved(e);
    if (rel) return relatedHtml(e, rel);
    loadRelated(e).then(() => {
      if (S.detailId === e.id && $("detail").open) { const box = $("dRelated"); if (box) box.outerHTML = relatedHtml(e, relatedSaved(e) || []); }
    }).catch((err) => {
      const box = $("dRelated");
      if (S.detailId === e.id && box) box.innerHTML = `<h3>Related</h3><p class="muted">Couldn't load related titles: ${esc(err.message)}</p>`;
    });
    return `<div id="dRelated"><h3>Related</h3><p class="muted">Looking up related titles…</p></div>`;
  }
  function relatedHtml(e, rel) {
    if (!rel.length) return `<div id="dRelated"></div>`;
    const anime = e.kind === "anime";
    const sorted = rel.slice().sort((a, b) => (REL_ORDER.indexOf(a[3]) + 99) % 99 - (REL_ORDER.indexOf(b[3]) + 99) % 99);
    const main = sorted.filter((r) => REL_MAIN.includes(r[3]));
    const more = sorted.length - main.length;
    const all = S.relAll === e.id || !main.length && more <= 2; // a couple of extras alone aren't worth a click
    const rows = (all ? sorted : main).map(([id, title, pic, how]) => {
      const known = findEntry(id) || (A.me && A.myEntry(e.kind, id));
      const name = known ? titleOf(known) : title;
      const blur = known && hidden18(known);
      // Where it stands: your status (signed in), else theirs, else a quick add.
      const mine = A.me && A.myEntry(e.kind, id);
      const seen = mine || (!A.me && known && known.status ? known : null);
      const side = seen
        ? `<span class="pill"><i class="dot st-${seen.status}"></i>${esc(statusText(seen))}</span>`
        : A.me ? `<button type="button" class="mbtn rel-add" data-add="${id}">+ ${anime ? "Plan to watch" : "Plan to read"}</button>` : "";
      return `<li class="rel">
        <button type="button" class="rel-open" data-rel="${id}" title="${esc(name)}">
          ${pic ? `<img src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer"${blur ? ' class="nsfw"' : ""}>` : `<span class="rel-noimg"></span>`}
          <span class="rel-txt"><span class="rel-t">${esc(name)}</span><span class="rel-k">${esc(REL_LABEL[how] || how.replace(/_/g, " "))}</span></span>
        </button>
        ${side}
      </li>`;
    }).join("");
    const btn = !more ? ""
      : all ? (main.length ? `<button type="button" class="link relmore" data-act="relless">Show fewer</button>` : "")
      : `<button type="button" class="link relmore" data-act="relmore">Show ${more} more (spin-offs, other versions…)</button>`;
    return `<div id="dRelated"><h3>Related</h3>${rows ? `<ul class="rels">${rows}</ul>` : ""}${btn}</div>`;
  }
  // A related title as a full entry: from a list if it's there, otherwise its details (saved, or one request).
  async function relatedEntry(id, kind) {
    const known = findEntry(id) || (A.me && A.myEntry(kind, id));
    if (known) return known;
    const { details, error } = await MALD.loadDetails(kind, [Number(id)], { priority: 0 });
    const d = details.get(Number(id));
    if (!d || d.missing) throw new Error(error || "MyAnimeList doesn't have this title anymore.");
    const entry = MALD.makeEntry(Object.assign({ id: Number(id), kind }, d, { status: null }));
    S.relPool.set(Number(id), entry);
    return entry;
  }
  async function openRelated(id) {
    const from = S.detailId;
    const kind = (findEntry(from) || {}).kind || S.kind;
    try {
      const e = await relatedEntry(id, kind);
      S.detailTrail.push(from);
      fillDetail(e);
      $("detail").scrollTop = 0;
    } catch (err) {
      toast(`Couldn't open it: ${err.message}`, "warn");
    }
  }
  function relatedBack() {
    const id = S.detailTrail.pop();
    const e = findEntry(id) || (A.me && A.myEntry(S.kind, id));
    if (e) { fillDetail(e); $("detail").scrollTop = 0; }
  }

  // Applies a change to your own entry: shown straight away, sent to MAL, undone if MAL refuses.
  async function doEdit(e, change, quick) {
    const before = e.status;
    const pending = A.edit(e, change);
    afterChange(e, "Saving…");
    try {
      const res = await pending;
      if (res.unchanged) { afterChange(e, ""); return; }
      afterChange(e, "Saved to MyAnimeList");
      const unit = e.kind === "manga" ? "Ch" : "Ep";
      if (e.status === "completed" && before !== "completed") toast(`${titleOf(e)}: marked as completed.`);
      else if (quick) toast(`${titleOf(e)}: ${unit} ${progressText(e)}`);
    } catch (err) {
      afterChange(e, "");
      if (err.status === 401) U.signedOut(err.message);
      toast(`Couldn't save: ${err.message}`, "warn");
    }
  }
  function afterChange(e, note) {
    render();
    const dlg = $("detail");
    if (dlg.open && dlg.querySelector(`[data-edit="${e.id}"]`)) {
      const top = dlg.scrollTop;
      fillDetail(e);
      dlg.scrollTop = top;
      const label = dlg.querySelector(".esave");
      if (label && note) label.textContent = note;
    }
  }

  async function addToMine(id) {
    let src = findEntry(id) || (A.mine && A.myEntry(S.kind, id));
    if (!src) { try { src = await relatedEntry(id, S.kind); } catch (err) { toast(`Couldn't add it: ${err.message}`, "warn"); return; } }
    const word = src.kind === "manga" ? "plan to read" : "plan to watch";
    try {
      const pending = A.addPlanned(src);
      refreshAfterAdd(src.id);
      await pending;
      toast(`Added ${titleOf(src)} to your ${word}.`);
    } catch (err) {
      if (err.status === 401) U.signedOut(err.message);
      toast(`Couldn't add it: ${err.message}`, "warn");
    }
    refreshAfterAdd(src.id);
  }
  function refreshAfterAdd(id) {
    render();
    const dlg = $("detail");
    // Redraw whatever the panel shows (it may be the title that has the added one among its related titles).
    const shown = dlg.open ? S.detailId : null;
    if (shown != null) { const e = findEntry(shown) || A.myEntry(S.kind, shown); if (e) { const top = dlg.scrollTop; fillDetail(e); dlg.scrollTop = top; } }
  }

  async function removeFromMine(id) {
    const e = findEntry(id);
    if (!e) return;
    try {
      await A.remove(e);
      $("detail").close();
      toast(`Removed ${titleOf(e)} from your list.`);
      render();
    } catch (err) {
      if (err.status === 401) U.signedOut(err.message);
      toast(`Couldn't remove it: ${err.message}`, "warn");
    }
  }


  Object.assign(U, { addToMine, doEdit, fillDetail, findEntry, openDetail, openRelated, relatedBack, relatedHtml, relatedSaved, removeFromMine, unlockPage });
})();
