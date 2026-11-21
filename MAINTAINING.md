# Maintaining Anime Dashboard

> **Start with the hub's `MAINTAINING.md`** (repo `LeGilly.github.io`, or
> https://github.com/LeGilly/LeGilly.github.io/blob/main/MAINTAINING.md): how the owner works, versions and
> releases, the rules every site follows, and the shared navigation bar and colour themes.
> This file only covers what's specific to Anime Dashboard.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `privacy.html`, `style.css` | The page, the privacy notice, all styles |
| `js/config.js` | Relay address (`https://api.legilly.com`) |
| `js/data.js` | Loading lists (relay or XML), browser storage, the MAL request queue and request log |
| `js/stats.js` | Stats tab numbers |
| `js/recs.js` | Next up: taste profile, candidates, scoring, sequel checks, slowdown pace |
| `js/account.js` | Sign-in state and list editing (talks to the relay with credentials) |
| `js/ui.js` | Everything on screen: tabs, detail panel, Related, Search, editor, toasts |
| `worker/worker.js` | The Cloudflare Worker ("relay") between the page and MyAnimeList |
| `CNAME` | `anime.legilly.com` for GitHub Pages |

## Hosting

- **Site:** GitHub Pages at https://anime.legilly.com (the old `legilly.com/anime-dashboard/` redirects there).
- **Relay:** Cloudflare Worker named `anime-dashboard`, custom domain `api.legilly.com`. It also answers on a
  `*.workers.dev` address; keep that address out of this public repo (it contains the owner's name).
- **Secrets** `MAL_CLIENT_ID` and `MAL_CLIENT_SECRET` exist only as Cloudflare secrets. Never put them in
  the repo or in chat.
- **MAL app** redirect URL: `https://api.legilly.com/auth/callback`.
- **Logs:** Workers Logs (Cloudflare → the worker → Observability) keep a few days of request lines plus one
  JSON line per MAL call: `{"mal":"details","status":200,"ms":240,"lastMin":12}`. Cloudflare's own request
  lines include the URL, so usernames of loaded lists appear there; the privacy page says so.

## Releasing

- Version: `index.html` (footer `vX.Y.Z` and every `?v=`) and `privacy.html` (`?v=`).
- If `worker/worker.js` changed, the owner must also redeploy it: Cloudflare → Workers & Pages →
  `anime-dashboard` → Edit code → paste the file → Deploy. Pushing to GitHub does not update the relay.
- If anything stored in the browser, logged, or sent changes, update `privacy.html` to match.

## Constraints

- **Content security policy** (meta tag in `index.html`): `script-src`/`style-src 'self' https://legilly.com`
  (the shared bar and themes), no inline scripts or styles, `connect-src https://api.legilly.com`. Sizes and positions that depend on data are set from JS
  (e.g. `data-w`/`data-h` attributes read by a script), never with `style="…"`. No third-party scripts.
- **Relay origins:** `ORIGINS` in `worker.js` holds only https://anime.legilly.com. Every request must carry
  that `Origin`, except the two sign-in steps the browser navigates to (`/auth/login`, `/auth/callback`);
  sign-in can only return to it. Requests from other sites, localhost or plain scripts (no Origin) get 403.
  Tests use a stand-in relay, so localhost isn't needed. Backed by a Cloudflare rate-limiting rule on
  api.legilly.com (Security → WAF → Rate limiting rules; free plan: one rule, counted per IP over 10 s).
- **Sign-in:** OAuth with PKCE "plain" (what MAL supports); the token exchange needs the client secret.
  Session in an AES-GCM encrypted cookie `mald_sess` (HttpOnly, Secure, SameSite=Strict, 60 days),
  which also stores the user's id and name so checking sign-in never calls MAL. A failed token refresh
  only signs out on MAL's 400/401; anything else keeps the session.
- **Refresh tokens are single-use,** so account calls go one at a time (`call()` in `account.js`).
- **Cloudflare free plan:** at most 50 outgoing requests per invocation, so `/details` and `/links` take
  at most 25 ids (`MAX_IDS`) and query MAL one after another.
- **MAL list fields** must be named explicitly (`LIST_FIELDS`), or MAL leaves out rewatch/reread counts.

## Talking to MyAnimeList (rate limits)

MAL publishes no limits. What we measured:

- When it limits, MAL usually **stops answering** (our 15 s timeout fires) rather than returning 429.
  Sometimes it sends 403, which is ambiguous with "private list".
- 2026-11-21: a Next up run went silent after ~80 requests in one minute (a burst of 25, then 1/s),
  right after several minutes at 1/s. A run at 1/s with no burst had been fine for ~177 checks.

So every request that reaches MAL goes through one queue in `data.js` (`MALD.net`):

- Budget: `BURST` 10 at once, then one per `RATE` 1500 ms, shared with other tabs via `mald:budget`.
  After a slowdown the whole queue slows to the Next up pace.
- Priority 0 = something the user did (load a list, edit, search, open a title): never waits for the
  budget. 1 = Next up while the user waits. 2 = background checks.
- Next up's requests are grouped (`next:anime`/`next:manga`) and paused when the user leaves the tab or
  the browser tab is hidden; resumed on return.
- Next up pace (`recs.js`): `REQ_PAUSE` 1500 ms per title, doubling after each slowdown up to
  `MAX_PAUSE` 12000, with a 5-minute break (10 if it happens again soon); a clean run eases it back.
  `CHUNK` 5 titles per relay call, `FIRST_DETAILS` 40 looked up before showing results,
  `MAX_AUTO` 300 titles checked for sequels automatically.
- **Don't raise these numbers without new evidence.** Settings → Copy request log gives the last 400
  requests (time, kind, cost, priority, wait, duration, MAL's answer); compare with the Cloudflare lines.

## Browser storage (keys)

`mald:last` (last list viewed, or `{ref:"mine"}`), `mald:mine` (own list), `mald:me` (last confirmed
sign-in), `mald:details:{kind}`, `mald:links:{kind}`, `mald:related:{kind}` (max 300 titles),
`mald:pace`, `mald:budget`, `mald:netlog` (request log), `mald:prefs`. Lists are kept 30 days; details,
links and related titles are refreshed after 30 days. **Settings → Forget this list** clears all of them
(`MALD.forget` in `data.js`): add any new key there.

Browsers allow about 5 MB per site, and a big list plus title details can get close. All saving goes through
`store()` / `MALD.writeCache` in `data.js`: when storage is full, the oldest half of what can be fetched again
(`PRUNABLE`: details, related titles, sequel checks; plus older log rows) is dropped and the save retried;
lists are never dropped. The request log's second line shows how much is used per kind, and whether room had
to be made. Save anything new through these functions, never with `localStorage.setItem` directly.

## Settled behaviour (decided with the owner)

- Tabs: Search, Library, Progress, Next up, Stats. A loaded list (or a fresh sign-in) opens on Library.
- The plain address opens the start page; a list opens only from `?user=` (plus optional `tab=`, `kind=`),
  or right after signing in. "Change list" clears the address.
- Quick +1 is on Progress cards and in the editor, not on Library covers.
- Edits fill in fields the way MAL's own site does (e.g. completing sets all episodes and today's finish
  date); removing a title asks for confirmation.
- Next up checks favorites and "likely" titles for sequels only (no "check everything" button).
- Related, in the detail panel: prequels, sequels, main story and side stories first; the rest behind a button.
- Search works without signing in; 50 results per MAL request; results kept until reload.
- Status colors (Watching blue, Completed green, On hold amber, Plan to watch purple, Dropped red) were
  checked for colorblind separation; keep them fixed whatever the theme.
- The README describes the app only (no process or decisions); those go here.

## Testing

There's no test suite in the repo. What has worked:

- Serve the folder with `python -m http.server 8000` (localhost:8000 is an allowed account origin) and drive
  it with Playwright, routing `https://api.legilly.com/**` to a mock (lists, `/details`, `/links`, `/browse`,
  `/me`, `/me/list`, `/me/entry`).
- Test `worker.js` with Node by importing it as a module and replacing `globalThis.fetch`.
- Check light and dark mode and a phone width (390 px). Native pop-ups like the date picker only show in a
  real (headful) browser, e.g. Chrome on a virtual screen (Xvfb) captured with a screenshot tool.

## Shared bar and themes: what's specific here

- The status colours (`--st-*`, with dark variants) and `--good`/`--bad` are defined in `style.css` and never
  change with the theme. `privacy.html` loads the shared files too, and links back to the dashboard itself.
- The security rule lists `https://legilly.com` for scripts and styles (the dashboard is on its own subdomain).
