/* The Worker.
 *
 * The public site is static: the account list is baked into the bundle at build time, and an
 * account is added or removed by editing data/accounts.json and deploying. What changes without
 * a deploy is one small JSON value in KV, `state`: which accounts are suspended and what order
 * the tiles stand in. Since 8 Sep 2026 that value is written from the site itself, on /admin/,
 * behind Cloudflare Access; the laptop switch that used to write it is retired.
 *
 * THE GATE IS THE TOKEN, NOT THE HEADER. Access injects Cf-Access-Jwt-Assertion on every request
 * that passed the application, but the application covers /admin/ and the write route is reached
 * by a fetch from that page carrying the CF_Authorization cookie. So every gated route verifies
 * the JWT itself: RS256 signature against the team's published keys, issuer, audience and expiry.
 * Presence of a header would not do, because a misconfigured Access application is exactly the
 * case in which a stranger could reach the route with a header of their own.
 *
 * FAIL CLOSED. With ACCESS_TEAM or ACCESS_AUD unset, every gated route answers 401 and nothing is
 * written, so this can be deployed before the Access application exists without opening a write.
 *
 * The Worker also puts the security headers on every response itself, rather than trusting a
 * `_headers` file to be honoured by the asset router. `X-Robots-Tag` is the only thing keeping
 * this address out of a search index, so it is set here and asserted by test/verify.mjs offline
 * and by curl against the live origin after deploy.
 */

const SECURITY = {
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), midi=(), " +
    "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
  // Everything the page needs is same-origin and external to the HTML, so there is no
  // 'unsafe-inline' anywhere: no inline script, no inline style, no remote anything.
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Paths that must never be served from a stale cache, or a deploy would not reach the phone.
const NO_CACHE = /^\/(?:|index\.html|sw\.js|rev\.json|manifest\.webmanifest|admin|admin\/index\.html)$/;

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_STATE = 8 * 1024;

const text = (body, status, extra) => new Response(body, {
  status,
  headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY, ...(extra || {}) },
});
const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, must-revalidate",
    ...SECURITY,
  },
});

/* ------------------------------------------------------------- the Access token */

function b64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cookie(request, name) {
  const all = request.headers.get("cookie") || "";
  for (const part of all.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

/* Who passed Access, or null. Never throws: a malformed token, an unreachable key server or an
 * unset variable all read as "nobody", which is the answer that opens nothing. */
async function identity(request, env) {
  const team = String((env && env.ACCESS_TEAM) || "").trim();
  const aud = String((env && env.ACCESS_AUD) || "").trim();
  if (!team || !aud) return null;
  const token = request.headers.get("cf-access-jwt-assertion") || cookie(request, "CF_Authorization");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(b64url(parts[0])));
    const claims = JSON.parse(dec.decode(b64url(parts[1])));
    const iss = "https://" + team + ".cloudflareaccess.com";
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (header.alg !== "RS256" || claims.iss !== iss || !auds.includes(aud)) return null;
    if (typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000) return null;
    const certs = await (await fetch(iss + "/cdn-cgi/access/certs")).json();
    const jwk = (certs.keys || []).find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]));
    return good ? { email: String(claims.email || "") } : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------- the state */

/* The whole of what the admin may write: booleans against account keys, and an order of keys.
 * The Worker does not know the account list (that is an asset), so shape is checked here and
 * the phone ignores any key it does not recognise. Anything else in the body is dropped. */
function cleanState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const maintenance = {};
  const m = raw.maintenance;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    for (const k of Object.keys(m)) {
      if (KEY_RE.test(k) && typeof m[k] === "boolean") maintenance[k] = m[k];
    }
  }
  const order = Array.isArray(raw.order)
    ? raw.order.filter((k, i, a) => typeof k === "string" && KEY_RE.test(k) && a.indexOf(k) === i)
    : [];
  if (order.length > 200) return null;
  return { maintenance, order, at: new Date().toISOString() };
}

/* The self-lifting maintenance guard. MAINTENANCE_UNTIL is an ISO timestamp; while now is before
 * it, everything answers 503, assets included. Absent, empty or unparseable does nothing. */
const MAINT_TEXT = "The store is currently under maintenance. We are open for business again at 00:01 midnight of October 5.";
const MAINT_PAGE = '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Maintenance</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'padding:16px;box-sizing:border-box;font:18px/1.5 system-ui,sans-serif;text-align:center}' +
  'p{max-width:28em}</style></head><body><p>' + MAINT_TEXT + '</p></body></html>';

function maintenance(request, env) {
  const until = Date.parse((env && env.MAINTENANCE_UNTIL) || "");
  if (!(Date.now() < until)) return null;
  const base = { "cache-control": "no-store", "retry-after": String(Math.ceil((until - Date.now()) / 1000)) };
  if ((request.headers.get("accept") || "").includes("text/html")) {
    return new Response(MAINT_PAGE, { status: 503, headers: { ...base,
      "content-type": "text/html; charset=utf-8", "x-robots-tag": SECURITY["x-robots-tag"],
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }
  return new Response(JSON.stringify({ ok: false, error: "maintenance" }), { status: 503,
    headers: { ...base, "content-type": "application/json; charset=utf-8", ...SECURITY } });
}

export default {
  async fetch(request, env) {
    const held = maintenance(request, env);
    if (held) return held;

    if (!env || !env.ASSETS) {
      // Fail closed and say why. A silent fallthrough here would serve nothing and look like
      // a platform outage.
      return text("no ASSETS binding: check assets.binding in wrangler.jsonc", 500);
    }

    const url = new URL(request.url);
    const method = request.method;

    /* /state.json - what changes without a deploy. Public, read only, never cached anywhere: a
     * suspended code still being served from a cache is the one failure this exists to prevent.
     * It carries account keys, booleans and an order; the keys are already public in data.js.
     * A miss, an empty namespace or a KV outage answers {} and the phone keeps what it last saw. */
    if (url.pathname === "/state.json" && (method === "GET" || method === "HEAD")) {
      let body = "{}";
      try {
        if (env.QR_STATE) {
          const raw = await env.QR_STATE.get("state");
          if (raw) { JSON.parse(raw); body = raw; }   // parse to refuse malformed JSON, then pass through
        }
      } catch (e) { body = "{}"; }
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, must-revalidate",
          ...SECURITY,
        },
      });
    }

    /* The gated routes. /admin/ is the page, /api/me says who is signed in, /api/state writes.
     * Each one verifies the token; none of them trusts the other to have done so. */
    const gated = url.pathname === "/admin" || url.pathname.startsWith("/admin/") ||
                  url.pathname.startsWith("/api/");
    if (gated) {
      const who = await identity(request, env);
      if (!who) {
        return url.pathname.startsWith("/api/")
          ? json({ ok: false, error: "not signed in" }, 401)
          : text("Sign in through Cloudflare Access to manage the accounts. If you are signed " +
                 "in and still see this, the Access application or its variables are not set.", 401);
      }
      if (url.pathname === "/api/me" && method === "GET") return json({ ok: true, email: who.email });
      if (url.pathname === "/api/state" && method === "POST") {
        if (!env.QR_STATE) return json({ ok: false, error: "no QR_STATE binding" }, 500);
        let raw = null;
        try {
          const body = await request.text();
          if (body.length > MAX_STATE) return json({ ok: false, error: "too large" }, 413);
          raw = JSON.parse(body);
        } catch (e) { return json({ ok: false, error: "not JSON" }, 400); }
        const next = cleanState(raw);
        if (!next) return json({ ok: false, error: "bad shape" }, 400);
        await env.QR_STATE.put("state", JSON.stringify(next));
        return json({ ok: true, state: next });
      }
      if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "no such route" }, 404);
    }

    if (method !== "GET" && method !== "HEAD") {
      return text("This site is read only.", 405, { allow: "GET, HEAD" });
    }

    const upstream = await env.ASSETS.fetch(request);

    // Response headers are immutable as returned, so rebuild rather than mutate.
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
    if (NO_CACHE.test(url.pathname.replace(/\/+$/, "") || "/")) {
      headers.set("cache-control", "no-cache");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};

export { SECURITY, NO_CACHE, identity, cleanState };
