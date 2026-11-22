// Anime Dashboard, part 5 of 5: sign-in, loading lists, every button and key, and start-up.
"use strict";
(function () {
  const MALD = window.MALD;
  const U = MALD.ui;
  const { $, A, PAGE, S, addToMine, browseKey, browseParams, doEdit, esc, fetchBrowse, fillDetail, findEntry, keepListPosition, list, openDetail, openRelated, relatedBack, relatedHtml, relatedSaved, removeFromMine, render, resetNextPaging, savePrefs, setStatus, show, syncNet, syncUrl, toast, unlockPage } = U;

  /* ---------- loading ---------- */

  /* ---------- your own list (signed in) ---------- */

  function updateAccount() {
    const line = $("acctLine");
    if (A.me) {
      line.hidden = false;
      line.innerHTML = `Signed in as <strong>${esc(A.me.name)}</strong> · <button type="button" class="link" data-acct="signout">Sign out</button>`;
    } else if (A.available()) {
      line.hidden = false;
      line.innerHTML = `<button type="button" class="link" data-acct="signin">Sign in with MyAnimeList</button> to edit your own list`;
    } else line.hidden = true;
    $("signinBox").hidden = !(A.available() && !A.me);
    $("mineBox").hidden = !A.me;
    if (A.me) $("mineHint").textContent = `Signed in as ${A.me.name}.`;
    $("signinOr").hidden = !A.available();
    $("mineBtn").hidden = !(A.me && S.data && S.data.source !== "mine");
  }

  async function openMine() {
    if (A.mine) {
      MALD.save(A.mine);
      show(A.mine);
      if (Date.now() - A.mine.fetchedAt > 30 * 60 * 1000) refreshMine();
      return;
    }
    $("loader").hidden = true;
    await refreshMine();
  }

  async function refreshMine() {
    if (S.busy) return;
    S.busy = true;
    const showing = !S.data || S.data.source === "mine" || $("app").hidden;
    if (showing) setStatus("Loading your list…", "busy");
    try {
      const data = await A.loadMine();
      if (showing || (S.data && S.data.source === "mine")) { MALD.save(data); show(data); }
    } catch (err) {
      if (err.status === 401) signedOut(err.message);
      else if (showing) setStatus(err.message, "warn");
      if ($("app").hidden) $("loader").hidden = false;
    } finally {
      S.busy = false;
    }
  }

  function signedOut(message) {
    A.me = null;
    A.mine = null;
    updateAccount();
    if (S.data && S.data.source === "mine") { S.data = null; $("app").hidden = true; $("loader").hidden = false; }
    if (message) setStatus(message, "warn");
  }

  async function loadUser(user) {
    if (S.busy) return;
    user = user.trim();
    if (!user) return;
    // Your own name while signed in: open your own list (with private entries and editing).
    if (A.me && user.toLowerCase() === A.me.name.toLowerCase()) return openMine();
    S.busy = true;
    setStatus(`Loading ${user}'s lists…`, "busy");
    document.body.classList.add("loading");
    try {
      const data = await MALD.loadLive(user);
      MALD.save(data);
      show(data);
      // Signed in and browsing someone else: have your own list at hand for "On your list".
      if (A.me && !A.mine) A.loadMine().then(() => render()).catch(() => {});
    } catch (err) {
      setStatus(err.message, "warn");
      // Opened from a link and it failed: show the form so another name can be tried.
      if ($("app").hidden) { $("loader").hidden = false; $("user").value = user; }
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
      Object.assign(S.next, { genresOff: [], matchAll: false, excludes: [], lengthsOff: [] }); S.openMulti = null; S.msearch = {}; resetNextPaging();
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
      if (S.data && S.data.source === "mine") refreshMine();
      else if (S.data && S.data.source === "live") loadUser(S.data.user);
      else $("file").click();
    });
    $("mineBtn").addEventListener("click", () => { S.tab = "library"; openMine(); });
    $("openMineBtn").addEventListener("click", () => { S.tab = "library"; S.kind = "anime"; openMine(); });
    $("signInBtn").addEventListener("click", () => A.signIn());
    $("settings").addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-acct]");
      if (!b) return;
      if (b.dataset.acct === "signin") A.signIn();
      else {
        await A.signOut();
        signedOut();
        toast("Signed out.");
      }
    });
    $("changeBtn").addEventListener("click", () => {
      // Start fresh: clear the address, and open the next list on the Library (anime).
      history.replaceState(null, "", location.pathname);
      S.tab = "library";
      S.kind = "anime";
      $("app").hidden = true;
      $("loader").hidden = false;
      syncNet();
      $("user").value = S.data && S.data.source === "live" ? S.data.user : "";
      $("user").focus();
    });
    $("settingsBtn").addEventListener("click", () => {
      const p = $("settings");
      p.hidden = !p.hidden;
      $("settingsBtn").setAttribute("aria-expanded", String(!p.hidden));
    });
    $("logBtn").addEventListener("click", async () => {
      const text = MALD.netLogText();
      try { await navigator.clipboard.writeText(text); toast("Request log copied. Paste it wherever you like."); }
      catch { toast("Couldn't copy the request log in this browser.", "warn"); }
    });
    $("forgetBtn").addEventListener("click", () => {
      MALD.forget();
      A.mine = null;
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
      if (ev.target.matches("[data-msearch]")) {
        const key = ev.target.closest("[data-multi]").dataset.multi;
        S.msearch[key] = ev.target.value;
        render();
        const box = view.querySelector(`[data-multi="${key}"] [data-msearch]`);
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
        return;
      }
      if (ev.target.id !== "q") return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        S.lib.q = ev.target.value; S.lib.shown = PAGE;
        const pos = ev.target.selectionStart;
        render();
        const q = $("q"); q.focus(); q.setSelectionRange(pos, pos);
      }, 150);
    });
    view.addEventListener("submit", (ev) => {
      if (ev.target.id !== "bForm") return;
      ev.preventDefault();
      S.browse.q = $("bq").value;
      render();
      const box = $("bq"); if (box) box.focus();
    });
    view.addEventListener("change", (ev) => {
      const b = ev.target.dataset.b;
      if (b) {
        S.browse[b] = ev.target.type === "checkbox" ? ev.target.checked : b === "year" ? Number(ev.target.value) : ev.target.value;
        render();
        return;
      }
      const map = { fType: "type", fGenre: "genre", fCreator: "creator", fYear: "year", fSort: "sort" };
      if (map[ev.target.id]) { S.lib[map[ev.target.id]] = ev.target.value; S.lib.shown = PAGE; render(); }
      else if (ev.target.id === "qSort") { S.queueSort = ev.target.value; render(); }
      else if (ev.target.matches("[data-mval]")) {
        const key = ev.target.closest("[data-multi]").dataset.multi;
        const v = ev.target.dataset.mval;
        // For "off" lists a tick removes it from the unticked list; for the leave-out list a tick adds it.
        const add = key.endsWith("Off") ? !ev.target.checked : ev.target.checked;
        S.next[key] = add ? [...S.next[key], v] : S.next[key].filter((x) => x !== v);
        keepListPosition(key, () => { resetNextPaging(); render(); });
      }
      else if (ev.target.matches("[data-mall]")) { keepListPosition("genresOff", () => { S.next.matchAll = ev.target.checked; resetNextPaging(); render(); }); }
      else if (ev.target.id === "rAiring") { S.next.airing = ev.target.checked; resetNextPaging(); render(); }
    });
    view.addEventListener("click", (ev) => {
      const t = ev.target.closest("button");
      if (!t) return;
      if (t.dataset.bmode) { S.browse.mode = t.dataset.bmode; S.browse.type = ""; render(); if (t.dataset.bmode === "search" && $("bq")) $("bq").focus(); }
      else if (t.dataset.act === "bmore" || t.dataset.act === "bretry") {
        const key = browseKey(), r = S.browse.results.get(key);
        if (r && !r.loading) { fetchBrowse(key, browseParams(), r); render(); }
      }
      else if (t.dataset.status) { S.lib.status = t.dataset.status; S.lib.shown = PAGE; render(); }
      else if (t.dataset.view) { S.lib.view = t.dataset.view; render(); }
      else if (t.dataset.act === "more") { S.lib.shown += PAGE; render(); }
      else if (t.dataset.act === "clear") { Object.assign(S.lib, { status: "all", q: "", type: "", genre: "", creator: "", year: "", shown: PAGE }); render(); }
      else if (t.dataset.gmode) { S.groupMode[t.dataset.field] = t.dataset.gmode; render(); }
      else if (t.classList.contains("msel")) {
        const key = t.closest("[data-multi]").dataset.multi;
        S.openMulti = S.openMulti === key ? null : key;
        const pending = S.recData[S.kind];
        if (!S.openMulti && pending && pending.dirty) { pending.dirty = false; render(); return; }
        view.querySelectorAll("[data-multi]").forEach((m) => {
          const open = m.dataset.multi === S.openMulti;
          m.querySelector(".mpanel").hidden = !open;
          m.querySelector(".msel").setAttribute("aria-expanded", String(open));
        });
      }
      else if (t.dataset.mset) {
        const m = t.closest("[data-multi]");
        const key = m.dataset.multi;
        // Only the genres currently shown (after a search) are affected.
        const shownVals = [...m.querySelectorAll("[data-mval]")].map((i) => i.dataset.mval);
        if (key.endsWith("Off")) {
          const rest = S.next[key].filter((v) => !shownVals.includes(v));
          S.next[key] = t.dataset.mset === "all" ? rest : [...rest, ...shownVals];
        } else S.next[key] = []; // "Clear" empties the leave-out list
        if (key === "genresOff" && t.dataset.mset === "all") S.next.matchAll = false;
        keepListPosition(key, () => { resetNextPaging(); render(); });
      }
      else if (t.dataset.rsource) { S.next.source = t.dataset.rsource; resetNextPaging(); render(); }
      else if (t.dataset.act === "rmore") { S.next.shown += 12; render(); }
      else if (t.dataset.act === "cmore") { S.next.contShown += 12; render(); }
      else if (t.dataset.act === "smore") { S.next.soonShown += 12; render(); }
      else if (t.dataset.act === "rretry") {
        const old = S.recData[S.kind];
        if (old) clearTimeout(old.resumeTimer);
        MALD.pace.skipWait();
        delete S.recData[S.kind]; render();
      }
      else if (t.dataset.expand) { S.expand[t.dataset.expand] = !S.expand[t.dataset.expand]; render(); }
      else if (t.dataset.gall) { S.groupAll[t.dataset.gall] = !S.groupAll[t.dataset.gall]; render(); }
      else if (t.dataset.hmetric) { S.histMetric = t.dataset.hmetric; render(); }
      else if (t.dataset.year) { S.histYear = Number(t.dataset.year); render(); }
      else if (t.dataset.plus) { const e = findEntry(t.dataset.plus); if (e) doEdit(e, { progress: e.progress + 1 }, true); }
      else if (t.dataset.add) addToMine(t.dataset.add);
      else if (t.dataset.id) openDetail(t.dataset.id);
    });

    const closeMulti = () => {
      if (!S.openMulti) return;
      S.openMulti = null;
      view.querySelectorAll("[data-multi]").forEach((m) => {
        m.querySelector(".mpanel").hidden = true;
        m.querySelector(".msel").setAttribute("aria-expanded", "false");
      });
      // New results arrived while the list was open: show them now.
      const st = S.recData[S.kind];
      if (S.tab === "next" && st && st.dirty) { st.dirty = false; render(); }
    };
    document.addEventListener("click", (ev) => { if (!ev.target.closest("[data-multi]")) closeMulti(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMulti(); });

    const dlg = $("detail");
    dlg.addEventListener("close", unlockPage);
    // Editor: every change goes to MAL straight away.
    dlg.addEventListener("change", (ev) => {
      const f = ev.target.dataset.f;
      const box = ev.target.closest("[data-edit]");
      if (!f || !box) return;
      const e = findEntry(box.dataset.edit);
      if (!e) return;
      let v = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
      if (["score", "progress", "progressVol", "timesRepeated"].includes(f)) v = Math.max(0, parseInt(v, 10) || 0);
      doEdit(e, { [f]: v });
    });
    dlg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const box = b.closest("[data-edit]");
      if (b.dataset.step && box) {
        const e = findEntry(box.dataset.edit);
        if (e) doEdit(e, { [b.dataset.step]: (e[b.dataset.step] || 0) + Number(b.dataset.by) });
      } else if (b.dataset.add) addToMine(b.dataset.add);
      else if (b.dataset.rel) openRelated(b.dataset.rel);
      else if (b.dataset.act === "relback") relatedBack();
      else if (b.dataset.act === "relmore" || b.dataset.act === "relless") {
        const e = findEntry(S.detailId) || (A.me && A.myEntry(S.kind, S.detailId));
        S.relAll = b.dataset.act === "relmore" ? S.detailId : null;
        const box = $("dRelated");
        if (e && box) box.outerHTML = relatedHtml(e, relatedSaved(e) || []);
      }
      else if (b.dataset.act === "remove") {
        b.parentElement.innerHTML = `Remove this title from your list?
          <button type="button" class="link danger" data-act="remove-yes">Yes, remove it</button>
          <button type="button" class="link" data-act="remove-no">Cancel</button>`;
      } else if (b.dataset.act === "remove-yes") removeFromMine(box.dataset.edit);
      else if (b.dataset.act === "remove-no") { const e = findEntry(box.dataset.edit); if (e) fillDetail(e); }
    });
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

  async function start() {
    bind();
    MALD.pruneDetails();
    const p = new URLSearchParams(location.search);
    const signin = p.get("signin");
    if (!MALD.relayReady()) {
      $("liveHint").textContent = "Live loading isn't set up on this site yet. Use the XML upload below.";
      $("user").disabled = true;
      $("loadBtn").disabled = true;
    }
    // A tab or manga in the address is honoured; otherwise every visit starts on the Library (anime).
    if (p.get("kind") === "manga") S.kind = "manga";
    if (["search", "progress", "next", "stats"].includes(p.get("tab"))) S.tab = p.get("tab");
    // Signed in? (The relay checks its cookie; this page never sees the sign-in itself.)
    if (A.available()) {
      setStatus("Checking sign-in…", "busy");
      await A.check();
    }
    updateAccount();
    const outcomes = {
      ok: A.me ? `Signed in as ${A.me.name}.` : "",
      cancelled: "Sign-in cancelled.",
      failed: "Sign-in didn't work. Try again in a moment.",
      expired: "The sign-in took too long. Try again.",
    };
    const wanted = p.get("user");
    // Signed in: your own list opens on the plain address, after signing in, or from ?user=<you>.
    // ?user=<someone else> still opens their list.
    const mineWanted = A.me && (signin === "ok" || !wanted || wanted.toLowerCase() === A.me.name.toLowerCase());
    if (signin && outcomes[signin]) toast(outcomes[signin], signin === "ok" ? "" : "warn");
    else if (A.unconfirmed) toast(`Couldn't reach MyAnimeList to confirm your sign-in.${mineWanted ? " Showing your saved list." : ""}`, "warn");
    // Not signed in, the plain address opens the start page; a list only opens when the address names one
    // (?user=…). "Change list" still reaches the start page while signed in (it doesn't reload the page).
    if (mineWanted) {
      if (!p.get("tab")) S.tab = "library";
      return openMine();
    }
    const saved = MALD.loadSaved();
    // Your own list saved from before, but no longer signed in: show it as a normal, read-only list.
    if (saved && saved.source === "mine" && !A.me) saved.source = "live";
    if (wanted && MALD.relayReady()) {
      const same = saved && saved.source === "live" && saved.user.toLowerCase() === wanted.toLowerCase();
      if (same) {
        // Already saved: show it straight away, and refresh quietly if it's over 30 minutes old.
        show(saved);
        if (Date.now() - saved.fetchedAt > 30 * 60 * 1000) loadUser(wanted);
      } else {
        // Someone else: show a loading message instead of the "choose a list" form.
        $("loader").hidden = true;
        loadUser(wanted);
      }
    } else {
      if (saved && saved.source === "live" && saved.user) $("user").value = saved.user;
      setStatus("See your MyAnimeList in a cleaner way.");
    }
  }

  Object.assign(U, { signedOut, updateAccount });
  start();
})();
