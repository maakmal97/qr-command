/* The Worker.
 *
 * This site is static and read-only. There is no store, no key, no write path and no KV
 * binding, because the phone is a viewer: the account list is baked into the bundle at build
 * time and a change is shipped by deploying, not by posting. That is the whole security
 * model, and it is why there is so little here.
 *
 * The Worker exists for one reason: to put the security headers on every response itself,
 * rather than trusting a `_headers` file to be honoured by the asset router. `X-Robots-Tag`
 * is the only thing keeping this address out of a search index, so it is not something to
 * assume; set here, it is asserted by test/verify.mjs offline and by curl against the live
 * origin after deploy.
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
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Paths that must never be served from a stale cache, or a deploy would not reach the phone.
const NO_CACHE = /^\/(?:|index\.html|sw\.js|rev\.json|manifest\.webmanifest)$/;

export default {
  async fetch(request, env) {
    if (!env || !env.ASSETS) {
      // Fail closed and say why. A silent fallthrough here would serve nothing and look like
      // a platform outage.
      return new Response("no ASSETS binding: check assets.binding in wrangler.jsonc", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("This site is read only.", {
        status: 405,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          allow: "GET, HEAD",
          ...SECURITY,
        },
      });
    }

    const url = new URL(request.url);
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

export { SECURITY, NO_CACHE };
