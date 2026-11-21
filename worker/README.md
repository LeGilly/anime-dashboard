# Relay setup

The dashboard loads lists by username through this Cloudflare Worker. It keeps the MAL Client ID secret and adds the headers browsers need.

1. **Client ID:** at https://myanimelist.net/apiconfig, click **Create ID**. Set App Type to `web` and both URLs to `https://legilly.com/anime-dashboard/`, then copy the **Client ID**.
2. **Worker:** at https://dash.cloudflare.com, go to **Workers & Pages** → **Create application**, and start from the Hello World starter (not a Git repository). Name it `anime-dashboard` and deploy it. Click **Edit code**, paste in `worker.js`, and deploy again.
3. **Secret:** in the Worker's **Settings** → **Variables and Secrets**, add a **Secret** named `MAL_CLIENT_ID` containing the Client ID.
4. **Connect:** put the Worker's address in `../js/config.js`.

Allowed pages are listed in `ALLOWED_ORIGINS` at the top of `worker.js`.
