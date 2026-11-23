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
| `js/tags.js` | Community tags: loading them, voting, the same name rules as the relay |
| `js/ui.js` | Shared state and helpers for the screen, and the Library, Progress and Stats views |
| `js/ui-search.js` | The Search tab |
| `js/ui-next.js` | The Next up tab and its background checks |
| `js/ui-detail.js` | The detail panel, the editor, Related titles, and changes to your list |
| `js/ui-main.js` | Sign-in state, loading lists, every button and key, and start-up (loaded last) |
| `worker/worker.js` | The Cloudflare Worker ("relay") between the page and MyAnimeList |
| `CNAME` | `anime.legilly.com` for GitHub Pages |
| `tests/`, `package.json`, `playwright.config.mjs` | The tests (see Testing) |

The `ui*.js` files share one object, `MALD.ui` (`U` in the code). Each file ends with `Object.assign(U, {...})`
listing what the other files use, and starts by taking what it needs from the files loaded before it. Something
from a file loaded later is called as `U.name()` at the time of use (e.g. `U.renderNext` in `ui.js`). The order of
the script tags in `index.html` matters, and `ui-main.js` starts the page, so it comes last.

## Hosting

- **Site:** GitHub Pages at https://anime.legilly.com (the old `legilly.com/anime-dashboard/` redirects there).
- **Relay:** Cloudflare Worker named `anime-dashboard`, custom domain `api.legilly.com`. It also answers on a
  `*.workers.dev` address; keep that address out of this public repo (it contains the owner's name).
- **Tag database:** Cloudflare D1 database `anime-dashboard-tags`, attached to the worker as `TAGS`
  (see Community tags below). Without it the relay answers 503 for tags and the page hides them.
- **Secrets** `MAL_CLIENT_ID` and `MAL_CLIENT_SECRET` exist only as Cloudflare secrets. Never put them in
  the repo or in chat.
- **MAL app** redirect URL: `https://api.legilly.com/auth/callback`.
- **Logs:** Workers Logs (Cloudflare → the worker → Observability) keep a few days of request lines plus one
  JSON line per MAL call: `{"mal":"details","status":200,"ms":240,"lastMin":12}`. Cloudflare's own request
  lines include the URL, so usernames of loaded lists appear there; the privacy page says so.

## Releasing

- Version: `index.html` (footer `vX.Y.Z` and every `?v=`) and `privacy.html` (`?v=`). A test checks they all
  match the changelog. Any change to a JS or CSS file needs a new version, or browsers may mix old and new files.
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
  api.legilly.com (Security → WAF → Rate limiting rules; free plan: one rule, counted per IP over 10 s), covering
  `/list`, `/details`, `/links`, `/browse`, `/tags` and `/me/tags`.
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

## Community tags

Like Steam's tags: each signed-in person votes for the tags they think fit a title; everyone sees each title's
tags ordered by votes (not who voted). Tags belong to titles, not to lists. Decided with the owner:

- Only signed-in users can add or vote; who voted comes from the sign-in cookie, never from the request.
- Any title can be tagged, from its detail panel. Anime and manga are separate.
- Names: 2 to 24 characters, letters (any language), numbers, spaces, hyphens, apostrophes. Capitals don't
  matter ("Found family" = "found family"); the first spelling is the one shown. `cleanTag()` in `worker.js`
  and `MALD.tags.check()` in `tags.js` must stay the same.
- Limits (top of the tags section in `worker.js`): `TAG_MIN_VOTES` 1 (votes before a tag shows; raise it if the
  site gets busy and junk appears), `TAG_MAX_PER_TITLE` 20, `TAG_PER_HOUR` 60.
- **Moderation is never on the website.** No admin endpoints, no admin page: the owner moderates in the
  Cloudflare dashboard (protected by the Cloudflare login) with the commands below.
- A title's name is fetched from MAL once, with its first tag (`titles` table), only so the console is readable.
  Ids MAL doesn't know are refused. If MAL is busy the vote still counts; the name comes with the next vote.
- The page loads all tags for a kind in one call (`GET /tags`), fine while the site is small. If it ever gets
  big, switch to per-title calls.

**Setup (once):** Cloudflare → Storage & Databases → D1 → Create → name `anime-dashboard-tags`. Then Workers &
Pages → `anime-dashboard` → Settings → Bindings → Add → D1 database → variable name `TAGS`, database
`anime-dashboard-tags` → Deploy. The relay creates its tables on first use.

**Moderating:** D1 → `anime-dashboard-tags` → Console. Tag keys are the lower-case name. Times are in
milliseconds (`datetime(at / 1000, 'unixepoch')` makes them readable).

```sql
-- Newest votes, with the title's name and who voted (times in UTC)
SELECT datetime(v.at / 1000, 'unixepoch') AS time, v.type, v.title, n.name, t.label, v.user_name, v.user_id
FROM votes v JOIN tags t ON t.key = v.tag LEFT JOIN titles n ON n.type = v.type AND n.id = v.title
ORDER BY v.at DESC LIMIT 50;

-- Most used tags
SELECT t.label, t.key, COUNT(*) AS votes FROM votes v JOIN tags t ON t.key = v.tag GROUP BY v.tag ORDER BY votes DESC LIMIT 100;

-- Everything one person did (find their user_id here)
SELECT v.type, v.title, n.name, t.label, v.user_id FROM votes v JOIN tags t ON t.key = v.tag
LEFT JOIN titles n ON n.type = v.type AND n.id = v.title WHERE v.user_name = 'Name';

-- Every tag on one title
SELECT t.label, COUNT(*) AS votes FROM votes v JOIN tags t ON t.key = v.tag
WHERE v.type = 'anime' AND v.title = 12345 GROUP BY v.tag ORDER BY votes DESC;

-- Delete a tag everywhere
DELETE FROM votes WHERE tag = 'bad tag';
DELETE FROM tags WHERE key = 'bad tag';

-- Remove one tag from one title (type 'anime' or 'manga', title = MAL id)
DELETE FROM votes WHERE type = 'anime' AND title = 12345 AND tag = 'bad tag';

-- Change how a tag is spelled on screen
UPDATE tags SET label = 'Found family' WHERE key = 'found family';

-- Move all votes from one tag to another (then delete the old one as above)
INSERT OR IGNORE INTO votes (type, title, tag, user_id, user_name, at)
  SELECT type, title, 'new tag', user_id, user_name, at FROM votes WHERE tag = 'old tag';
INSERT OR IGNORE INTO tags (key, label, at) VALUES ('new tag', 'New tag', strftime('%s', 'now') * 1000);

-- Remove everything one person added
DELETE FROM votes WHERE user_id = 123456;

-- Block a person (their votes stop counting at once; they can still take votes back) / unblock
INSERT INTO blocked_users (user_id, user_name, note, at) VALUES (123456, 'Name', 'why', strftime('%s', 'now') * 1000);
DELETE FROM blocked_users WHERE user_id = 123456;

-- Words new tags can't contain (whole words, lower case) / allow again
INSERT INTO blocked_words (word) VALUES ('badword');
DELETE FROM blocked_words WHERE word = 'badword';
```

## Settled behaviour (decided with the owner)

- Tabs: Search, Library, Progress, Next up, Stats. A loaded list (or a fresh sign-in) opens on Library.
- "Blur 18+ covers" (`MALD.isAdult`): anime go by MAL's age rating (R+ and Rx blurred), because MAL's "gray"
  flag also covers all-ages shows (e.g. Chiikawa). Manga have no rating in MAL's API, so they use the flag
  (anything not "white"). Hentai/Erotica genres and the "black" flag are always blurred.
- The plain address opens the start page, or your own Library when you're signed in. `?user=` (plus optional
  `tab=`, `kind=`) opens that list, someone else's included while signed in. "Change list" clears the address
  and shows the start page without reloading, so a signed-in user can load another list from there.
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

How tests run (GitHub, locally, keeping them current) is in the hub's `MAINTAINING.md`, "Tests". `npm test` runs:

- `tests/relay.test.mjs`: `worker.js` in Node, with `globalThis.fetch` replaced (origins, sign-in, cookies,
  id limits, MAL errors), and tags against `tests/fake-d1.mjs` (D1 imitated with Node's built-in SQLite).
- Browser tests (`*.spec.mjs`) against the page served by `tests/serve.mjs` on localhost:8000, with
  `tests/mock-relay.mjs` standing in for api.legilly.com using the made-up lists in `tests/fixtures/mal.json`
  (owner `LeGilly`, a `Friend`, and `NoSuchUser` for a missing list). `account` (sign-in, +1, editor, dates,
  busy MAL), `pages` (start page, tabs, URLs, privacy page, phone widths), `search`, `related`, `nextup`
  (the request queue, pausing away from the tab), `storage` (full browser storage), `tags` (showing, voting,
  suggestions, By tag, filters, tags switched off). The stand-in relay keeps tag votes in `state.votes`.
- `fastQueue(page)` removes the request spacing so tests don't wait; tests that check the spacing set their own.
- Still check light and dark mode by eye. Native pop-ups like the date picker only show in a real (headful)
  browser, e.g. Chrome on a virtual screen (Xvfb) captured with a screenshot tool.

## Shared bar and themes: what's specific here

- The status colours (`--st-*`, with dark variants) and `--good`/`--bad` are defined in `style.css` and never
  change with the theme. `privacy.html` loads the shared files too, and links back to the dashboard itself.
- The security rule lists `https://legilly.com` for scripts and styles (the dashboard is on its own subdomain).
