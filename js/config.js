// Address of the Cloudflare Worker relay (code in worker/worker.js).
// If it changes, also update connect-src in index.html.
// Example: "https://anime-dashboard.your-name.workers.dev"
// Leave it empty to allow only XML uploads, without covers or genres.
window.MALD_CONFIG = {
  relay: "https://anime-dashboard.legilly.workers.dev",
};
