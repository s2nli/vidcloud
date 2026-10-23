// Vercel serverless proxy for https://vidcloud.eu.org/api
// Usage: https://YOUR-APP.vercel.app/api/<same path as upstream /api/...>
// Special routes:  /api/_batches  -> studystark batches.json
//                  /api/_token    -> debug: check whether token fetch works

const ORIGIN = process.env.UPSTREAM_ORIGIN || "https://vidcloud.eu.org";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const TOKEN_TTL = 10 * 60 * 1000;

let tokenCache = null; // { access_token, token, cookie, at }

async function getTokens(force = false) {
  if (!force && tokenCache && Date.now() - tokenCache.at < TOKEN_TTL) return tokenCache;
  const r = await fetch(ORIGIN + "/generate_token.php", {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: ORIGIN + "/" },
    cache: "no-store",
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.success || !j.access_token || !j.token) {
    throw new Error("token fetch failed (status " + r.status + ")");
  }
  let setCookie = [];
  if (typeof r.headers.getSetCookie === "function") setCookie = r.headers.getSetCookie();
  const sess = setCookie.map((c) => c.split(";")[0]).join("; ");
  tokenCache = { access_token: j.access_token, token: j.token, cookie: sess, at: Date.now() };
  return tokenCache;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body) || typeof req.body === "string") return req.body;
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function callUpstream(url, req, body, t) {
  const headers = {
    "User-Agent": UA,
    Accept: req.headers["accept"] || "application/json, text/plain, */*",
    Origin: ORIGIN,
    Referer: ORIGIN + "/",
    Authorization: "Bearer " + t.access_token,
    "X-Auth-Token": t.token,
    Cookie: ["auth_token=" + encodeURIComponent(t.token), t.cookie].filter(Boolean).join("; "),
  };
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  return fetch(url, { method: req.method, headers, body, redirect: "follow" });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const u = new URL(req.url, "http://x");
    const sub = u.pathname.replace(/^\/api\/?/, "");

    if (sub === "_batches") {
      const r = await fetch("https://studystark.github.io/batches/batches.json");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
      return res.status(r.status).send(await r.text());
    }
    if (sub === "_token") {
      const t = await getTokens(true);
      return res.status(200).json({ ok: true, has_access_token: !!t.access_token, has_token: !!t.token, cookies: !!t.cookie });
    }

    const target = ORIGIN + "/api/" + sub + u.search;
    const body = await readBody(req);

    let t = await getTokens();
    let r = await callUpstream(target, req, body, t);
    if (r.status === 401 || r.status === 403 || r.status === 419) {
      t = await getTokens(true);
      r = await callUpstream(target, req, body, t);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    if (req.method === "GET" && r.ok) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    }
    return res.status(r.status).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "proxy_error", message: String(e && e.message || e) });
  }
};
