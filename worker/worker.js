// Anime Dashboard relay — a Cloudflare Worker that talks to the MyAnimeList API for the dashboard.
//
// Why it exists: MAL's API needs a Client ID and does not allow requests straight from a
// web page (no CORS). This Worker keeps the Client ID secret and adds the CORS headers.
// It only reads public data: it never logs in and can't change anyone's list.
//
// It needs one secret, MAL_CLIENT_ID, set in the Worker's settings on Cloudflare.
//
// Endpoints (GET only):
//   /list?user=NAME&type=anime|manga      -> { user, type, items: [ {node, list_status}, ... ] }
//   /details?type=anime|manga&ids=1,2,3   -> { type, items: [ node, ... ] }   (max 25 ids)
//   /links?type=anime|manga&ids=1,2,3     -> { type, items: [ { id, recs, related }, ... ] }   (max 25 ids)
//        recs:    [[id, title, picture, number of MAL users recommending it], ...]
//        related: [[id, title, picture, relation (sequel, side_story, ...)], ...]

// Pages allowed to use this relay. Add your own test address here if needed.
const ALLOWED_ORIGINS = [
  "https://legilly.com",
  "https://www.legilly.com",
  "https://legilly.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAL = "https://api.myanimelist.net/v2";
const MAX_IDS = 25;            // Cloudflare's free plan allows 50 outgoing requests per call; stay well under
// Nothing is stored here: the dashboard keeps title details in the visitor's browser for a week,
// and users' lists are never stored.

const COMMON = "id,title,main_picture,alternative_titles,start_date,mean,media_type,status,genres,nsfw,num_list_users";
// List fields are named explicitly: MAL leaves out the rewatch/reread count otherwise.
const LIST_FIELDS = {
  anime: "list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date,updated_at}",
  manga: "list_status{status,score,num_chapters_read,num_volumes_read,is_rereading,num_times_reread,start_date,finish_date,updated_at}",
};
const FIELDS = {
  anime: COMMON + ",num_episodes,start_season,average_episode_duration,studios",
  manga: COMMON + ",num_volumes,num_chapters,authors{first_name,last_name}",
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "Only GET is allowed." }, 405, cors);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed." }, 403, cors);
    if (!env.MAL_CLIENT_ID) return json({ error: "The relay has no MAL_CLIENT_ID secret yet." }, 500, cors);

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    if (type !== "anime" && type !== "manga") return json({ error: "type must be anime or manga." }, 400, cors);

    try {
      if (url.pathname === "/list") {
        const user = url.searchParams.get("user") || "";
        if (!/^[A-Za-z0-9_-]{2,16}$/.test(user)) return json({ error: "That doesn't look like a MAL username." }, 400, cors);
        return json(await getList(env, user, type), 200, { ...cors, "Cache-Control": "no-store" });
      }
      if (url.pathname === "/details" || url.pathname === "/links") {
        const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
        if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => /^\d{1,9}$/.test(id))) {
          return json({ error: `ids must be 1 to ${MAX_IDS} numbers.` }, 400, cors);
        }
        const unique = [...new Set(ids)];
        const result = url.pathname === "/details"
          ? await getMany(env, type, unique, FIELDS[type], (node) => node)
          : await getMany(env, type, unique, `recommendations,related_${type}`, slimLinks(type));
        return json(result, 200, cors);
      }
      return json({ error: "Unknown endpoint." }, 404, cors);
    } catch (err) {
      const status = err.status || 502;
      return json({ error: err.message || "MyAnimeList could not be reached." }, status, cors);
    }
  },
};

async function getList(env, user, type) {
  const kind = type === "anime" ? "animelist" : "mangalist";
  let next = `${MAL}/users/${encodeURIComponent(user)}/${kind}?limit=1000&nsfw=true&fields=${LIST_FIELDS[type]},${FIELDS[type]}`;
  const items = [];
  // A list of 1000 entries per page; 20 pages (20,000 entries) is far more than anyone has.
  for (let page = 0; next && page < 20; page++) {
    const data = await mal(env, next);
    items.push(...(data.data || []));
    next = data.paging && data.paging.next;
  }
  return { user, type, items };
}

// Recommendations and related titles, trimmed to what the dashboard uses.
function slimLinks(type) {
  const pic = (n) => (n.main_picture && (n.main_picture.medium || n.main_picture.large)) || "";
  return (node) => ({
    id: node.id,
    recs: (node.recommendations || []).map((r) => [r.node.id, r.node.title, pic(r.node), r.num_recommendations || 0]),
    related: (node[`related_${type}`] || []).map((r) => [r.node.id, r.node.title, pic(r.node), r.relation_type]),
  });
}

// Looks up several titles, two at a time so MAL isn't hit with them all at once.
async function getMany(env, type, ids, fields, shape) {
  const items = [];
  for (let i = 0; i < ids.length; i += 2) {
    const batch = ids.slice(i, i + 2);
    items.push(...await Promise.all(batch.map(async (id) => {
      try {
        return shape(await mal(env, `${MAL}/${type}/${id}?nsfw=true&fields=${fields}`));
      } catch (err) {
        if (err.status === 404) return { id: Number(id), missing: true }; // removed from MAL
        throw err;
      }
    })));
  }
  return { type, items };
}

async function mal(env, url) {
  let res;
  try {
    // Give up after 15 seconds instead of waiting forever when MAL stops answering.
    res = await fetch(url, { headers: { "X-MAL-CLIENT-ID": env.MAL_CLIENT_ID }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw Object.assign(new Error("MyAnimeList took too long to answer. It may be busy or limiting requests; try again in a minute."), { status: 504 });
  }
  if (res.ok) return res.json();
  const messages = {
    400: "MyAnimeList rejected the request.",
    401: "The relay's MAL Client ID is not valid.",
    403: "This list is private, or MyAnimeList is limiting requests. Try the XML upload instead.",
    404: "No MyAnimeList user with that name.",
    429: "MyAnimeList is limiting requests. Wait a minute and try again.",
  };
  throw Object.assign(new Error(messages[res.status] || `MyAnimeList answered with error ${res.status}.`), {
    status: res.status >= 500 ? 502 : res.status,
  });
}

function corsHeaders(origin) {
  return ALLOWED_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" }
    : { "Vary": "Origin" };
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
