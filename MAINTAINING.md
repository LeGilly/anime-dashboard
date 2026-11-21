# Maintaining Anime Dashboard

Notes for whoever works on this repo (including AI assistants). The README describes the app; this file
covers how it's built, released and why some things are the way they are.

## How the owner works

- Changes are committed and pushed by the owner with GitHub Desktop, from `Documents\GitHub\anime-dashboard`.
  An assistant writes files into that folder and suggests a one-line commit summary; it doesn't commit.
- Hub: https://legilly.com (repo `LeGilly.github.io`). Sibling projects: `ba-halo-game`, `irc-idlerpg-web`.

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

1. Version is major.minor.patch: patch = fixes and small visual changes, minor = a new feature,
   major = a big change in what the app is or does.
2. Set it in `index.html` (footer `vX.Y.Z` and every `?v=`) and in `privacy.html` (`?v=`), so browsers
   fetch the fresh files.
3. Add an entry at the top of `CHANGELOG.md` (`## X.Y.Z · YYYY-MM-DD`, one short line per change).
4. If `worker/worker.js` changed, the owner must also redeploy it: Cloudflare → Workers & Pages →
   `anime-dashboard` → Edit code → paste the file → Deploy. Pushing to GitHub does not update the relay.
5. If anything stored in the browser, logged, or sent changes, update `privacy.html` to match.

## Constraints

- **Content security policy** (meta tag in `index.html`): `script-src`/`style-src 'self' https://legilly.com`
  (the shared bar and themes), no inline scripts or styles, `connect-src https://api.legilly.com`. Sizes and positions that depend on data are set from JS
  (e.g. `data-w`/`data-h` attributes read by a script), never with `style="…"`. No third-party scripts.
- **Relay origins:** `ACCOUNT_ORIGINS` (anime.legilly.com, localhost:8000, 127.0.0.1:8000) may sign in and
  edit; `ALLOWED_ORIGINS` (also legilly.com) may use the public endpoints. Changing requests (PATCH,
  DELETE, logout) must carry an allowed `Origin`.
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

## Shared code: navigation bar and colour themes

- One script and one stylesheet are shared by every legilly.com site. They live **only in the hub repo**
  (`LeGilly.github.io/shared/site.js` and `site.css`) and every site loads them from
  `https://legilly.com/shared/`, in `<head>` before its own stylesheet. A change there reaches every site
  within about 10 minutes of pushing the hub (GitHub Pages cache), with no commit in the other repos.
  So test a change on all four sites before pushing the hub: a mistake breaks every site at once.
- Each page says which project it belongs to: `<html data-lg-project="home|anime|halo|idlerpg">`
  (highlights it in the bar). `<html data-tp-dark-only>` keeps a site dark (IdleRPG).
- **The bar** (top of every page, 46 px, `--lg-bar-h`): home icon → hub; **Games** and **Tools** menus
  listing every project (current one highlighted); theme button on the right. The project list is
  `GROUPS` at the top of `site.js`. The bar replaced every "← All projects" link: don't add back links.
  Pages get `padding-top` for it from the start (`html.lg-bar-on`), so nothing jumps when it's drawn.
- **Themes:** the script reads the `legilly_theme` cookie (`theme.mode`, e.g. `purple.dark`;
  `Domain=legilly.com` so every subdomain shares it; localStorage elsewhere, e.g. localhost) and sets
  `data-theme` (blue, purple, teal, amber, rose) and `data-mode` (light or dark, System resolved) on `<html>`
  before the page draws. `site.css` defines `--bg --card --ink --muted --accent --accent-ink --line --tag
  --track --shadow` per theme and mode; site stylesheets don't redefine these.
- Text on an accent background uses `var(--accent-ink)`: white in light mode and for Blue in dark mode;
  dark text on the lighter dark-mode accents of the other themes.
- Dark-only rules are written as `:root[data-mode="dark"] …`, plus `@media (prefers-color-scheme: dark)
  { :root:not([data-mode]) … }` as a fallback without the script.
- How the palettes were made: the blue neutrals with only the hue rotated (same lightness, so the same
  contrast); accents chosen by calculation, with at least the old blue's contrast and at least as far from the
  dashboard's status colours as the blue is from "Plan to watch". Check any new theme the same way.
- Security rules: sites on legilly.com allow `script-src`/`style-src` `'self' https://legilly.com`; Anime
  Dashboard (anime.legilly.com) needs `https://legilly.com` listed for both.
- Here: the status colours (`--st-*`, with dark variants) and `--good`/`--bad` are defined in `style.css`
  and never change with the theme. `privacy.html` loads the shared files too.
