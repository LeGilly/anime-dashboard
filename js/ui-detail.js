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
    const whose = `On ${owner()} list`;
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
      ["Age rating", esc(MALD.RATING_LABELS[e.rating] || "")],
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
          ${tagsSection(e)}
          ${info ? `<h3>About</h3><dl>${info}</dl>` : ""}
          ${relatedSection(e)}
          <p><a class="btn" href="${malUrl(e)}" target="_blank" rel="noopener">Open on MyAnimeList</a></p>
        </div>
      </div>`;
  }

  /* ---------- community tags in the detail panel ----------
     Everyone sees a title's tags, most votes first. Signed in, you can vote for tags (new or existing) and take
     your votes back. Clicking a tag lists every title with it (Search, "By tag"). */
  const TAGS_SHOWN = 10;
  function tagsSection(e) {
    const T = MALD.tags;
    if (T.off || !MALD.relayReady()) return "";
    T.ensure(e.kind);
    return `<section id="dTags" class="d-tags" data-kind="${e.kind}" data-id="${e.id}">${tagsHtml(e)}</section>`;
  }
  function tagsHtml(e) {
    const T = MALD.tags;
    if (!T.ready(e.kind)) return `<h3>Tags</h3><p class="muted">${T.error[e.kind] ? "Couldn't load tags right now. Try again in a minute." : "Loading tags…"}</p>`;
    const tags = T.forTitle(e.kind, e.id);
    const mine = T.mineFor(e.kind, e.id).map((l) => l.toLowerCase());
    const shown = S.tagsAll === e.id ? tags : tags.slice(0, TAGS_SHOWN);
    const what = e.kind === "anime" ? "anime" : "manga";
    const chip = ([label, n]) => {
      const my = mine.includes(label.toLowerCase());
      const vote = !A.me ? "" : my
        ? `<button type="button" class="ctag-vote" data-tagoff="${esc(label)}" title="Take back your vote" aria-label="Take back your vote for ${esc(label)}">✕</button>`
        : `<button type="button" class="ctag-vote" data-tagon="${esc(label)}" title="Vote for this tag too" aria-label="Vote for ${esc(label)} too">+</button>`;
      return `<li class="ctag${my ? " mine" : ""}"><button type="button" class="ctag-go" data-tagbrowse="${esc(label)}" title="Every ${what} tagged ${esc(label)}">${esc(label)} <small aria-label="${n} vote${n === 1 ? "" : "s"}">${n}</small></button>${vote}</li>`;
    };
    const list = tags.length
      ? `<ul class="ctags">${shown.map(chip).join("")}</ul>
         ${tags.length > TAGS_SHOWN ? `<button type="button" class="link" data-act="${S.tagsAll === e.id ? "tagsless" : "tagsmore"}">${S.tagsAll === e.id ? "Show fewer" : `Show all ${tags.length}`}</button>` : ""}`
      : `<p class="muted">No tags yet.${A.me ? " Add the first one." : ""}</p>`;
    const form = A.me
      ? `<form class="tagform" id="tagForm" autocomplete="off">
          <div class="tagbox">
            <input type="text" id="tagInput" maxlength="24" placeholder="Add a tag…" aria-label="Add a tag" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tagSuggest" aria-describedby="tagMsg">
            <ul id="tagSuggest" class="tagsuggest" role="listbox" aria-label="Tags already in use" hidden></ul>
          </div>
          <button type="submit" class="mbtn">Add</button>
        </form>
        <p class="muted small" id="tagMsg" aria-live="polite">Your vote counts once; anyone can see the totals, not who voted.</p>`
      : A.available() ? `<p class="muted small">Sign in to add tags.</p>` : "";
    return `<h3>Tags</h3>${list}${form}`;
  }
  // Redraws the tags of the open title, keeping whatever is being typed.
  function refreshTags(message) {
    const box = $("dTags");
    if (!box || !$("detail").open) return;
    const e = findEntry(box.dataset.id) || (A.me && A.myEntry(box.dataset.kind, Number(box.dataset.id)));
    if (!e) return;
    const input = $("tagInput"), typed = input ? input.value : "", focused = document.activeElement === input;
    box.innerHTML = tagsHtml(e);
    const again = $("tagInput");
    if (again) { again.value = typed; if (focused) again.focus(); }
    if (message && $("tagMsg")) { $("tagMsg").textContent = message.text; $("tagMsg").className = `small ${message.warn ? "warn-text" : "muted"}`; }
  }
  async function sendTag(label, on) {
    const box = $("dTags");
    if (!box) return;
    const kind = box.dataset.kind, id = Number(box.dataset.id);
    box.querySelectorAll("button, input").forEach((el) => { el.disabled = true; });
    try {
      if (on) await MALD.tags.vote(kind, id, label); else await MALD.tags.unvote(kind, id, label);
      refreshTags({ text: on ? `Voted for "${label}".` : `Took back your vote for "${label}".` });
      render();
    } catch (err) {
      refreshTags({ text: err.message, warn: true });
      if (err.status === 401) { U.updateAccount(); refreshTags({ text: err.message, warn: true }); }
    }
  }
  const voteTag = (label, on) => sendTag(label, on);
  function addTag(raw) {
    const c = MALD.tags.check(raw);
    if (c.error) { refreshTags({ text: c.error, warn: true }); return; }
    const input = $("tagInput"); if (input) input.value = "";
    sendTag(c.label, true);
  }
  function browseTag(label) {
    const box = $("dTags");
    if (box) S.kind = box.dataset.kind;
    $("detail").close();
    Object.assign(S.browse, { mode: "tag", tag: label, type: "", tagF: "" });
    S.tab = "search";
    U.syncUrl(); render();
    window.scrollTo({ top: 0 });
  }
  // Suggestions while typing: tags already in use for this kind, starting with what's typed first.
  function suggestTags() {
    const input = $("tagInput"), ul = $("tagSuggest"), box = $("dTags");
    if (!input || !ul || !box) return;
    const q = input.value.trim().toLowerCase();
    const mine = MALD.tags.mineFor(box.dataset.kind, box.dataset.id).map((l) => l.toLowerCase());
    const pool = MALD.tags.all(box.dataset.kind).map(([l]) => l).filter((l) => !mine.includes(l.toLowerCase()));
    const hits = !q ? [] : pool.filter((l) => l.toLowerCase().startsWith(q)).concat(pool.filter((l) => !l.toLowerCase().startsWith(q) && l.toLowerCase().includes(q))).slice(0, 8);
    ul.innerHTML = hits.map((l, i) => `<li role="option" id="tagOpt${i}" aria-selected="false"><button type="button" tabindex="-1" data-tagpick="${esc(l)}">${esc(l)}</button></li>`).join("");
    ul.hidden = !hits.length;
    input.setAttribute("aria-expanded", String(!!hits.length));
    input.removeAttribute("aria-activedescendant");
  }
  function bindTags(dlg) {
    dlg.addEventListener("input", (ev) => { if (ev.target.id === "tagInput") suggestTags(); });
    dlg.addEventListener("submit", (ev) => {
      if (ev.target.id !== "tagForm") return;
      ev.preventDefault();
      const active = dlg.querySelector("#tagSuggest [aria-selected=true] button");
      addTag(active ? active.dataset.tagpick : $("tagInput").value);
    });
    dlg.addEventListener("keydown", (ev) => {
      if (ev.target.id !== "tagInput") return;
      const ul = $("tagSuggest");
      if (!ul || ul.hidden) return;
      const opts = [...ul.querySelectorAll("li")];
      let i = opts.findIndex((o) => o.getAttribute("aria-selected") === "true");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        i = ev.key === "ArrowDown" ? (i + 1) % opts.length : (i <= 0 ? opts.length : i) - 1;
        opts.forEach((o, j) => o.setAttribute("aria-selected", String(j === i)));
        ev.target.setAttribute("aria-activedescendant", opts[i].id);
      } else if (ev.key === "Escape") {
        ev.preventDefault(); // close the suggestions, not the whole panel
        ul.hidden = true;
        ev.target.setAttribute("aria-expanded", "false");
      }
    });
    dlg.addEventListener("cancel", (ev) => {
      // Escape while suggestions are open only closes them (some browsers send "cancel" before keydown).
      const ul = $("tagSuggest");
      if (ul && !ul.hidden && document.activeElement && document.activeElement.id === "tagInput") ev.preventDefault();
    });
    dlg.addEventListener("focusout", (ev) => {
      if (ev.target.id === "tagInput" && !(ev.relatedTarget && ev.relatedTarget.closest("#tagSuggest"))) {
        setTimeout(() => { const ul = $("tagSuggest"); if (ul) ul.hidden = true; }, 150);
      }
    });
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


  Object.assign(U, { addTag, addToMine, bindTags, browseTag, doEdit, fillDetail, findEntry, openDetail, openRelated, refreshTags, relatedBack, relatedHtml, relatedSaved, removeFromMine, unlockPage, voteTag });
})();
