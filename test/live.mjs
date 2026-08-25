/* live.mjs - verify the DEPLOYED origin, not the local build.
 *
 * Everything else in this repo checks bytes on disk. This one fetches what the internet is
 * actually being served, renders the codes from those exact bytes and decodes them back. Run
 * it after every deploy:  node test/live.mjs [url]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
/* THE DEFAULT HOST IS A CONVENIENCE, NOT A FACT, and it has gone stale twice in one day:
 * once when the Worker was renamed and once when the account subdomain was changed in the
 * dashboard, which wrangler follows automatically and this file does not. `wrangler deploy`
 * prints the address it actually deployed to; that is the authority, and QR_HOST or argv[2]
 * overrides this line without editing it. */
const URL_BASE = (process.argv[2] || process.env.QR_HOST ||
  "https://jb3zkzyqguu5.qyts8mh72kyg.workers.dev").replace(/\/+$/, "");
const MASTER = process.env.QR_MASTER ||
  "C:/Users/maakm/Claude/Code/pay-afif-site";

let pass = 0, fail = 0;
const ok = (what, cond, detail) => {
  if (cond) { pass++; console.log("  ok    " + what); }
  else { fail++; console.log("  FAIL  " + what + (detail ? "\n        " + detail : "")); }
};

/* Every fetch carries a cache-buster.
 *
 * Without one this suite is a coin toss for the first minute after a deploy: Cloudflare's edge
 * answers from cache, the build id comes back as the previous release and seven assertions fail
 * on a deploy that actually worked. That is worse than having no check at all, because a test
 * that cries wolf gets ignored on the day it is right. The `sleep` below waits for the new
 * build to appear rather than asserting on the first answer. */
const bust = () => "cb=" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const get = async (p) => {
  const url = URL_BASE + p + (p.includes("?") ? "&" : "?") + bust();
  const r = await fetch(url, { redirect: "follow", cache: "no-store" });
  return { r, text: await r.text() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\nchecking " + URL_BASE + "\n");

/* ------------------------------------------------------------------- headers */

const root = await get("/");
ok("the site answers 200", root.r.status === 200, "got " + root.r.status);
for (const [h, want] of [
  ["x-robots-tag", /noindex/i],
  ["referrer-policy", /no-referrer/i],
  ["x-content-type-options", /nosniff/i],
  ["x-frame-options", /DENY/i],
  ["cross-origin-opener-policy", /same-origin/i],
  ["content-security-policy", /default-src 'none'/],
]) {
  const v = root.r.headers.get(h) || "";
  ok(h + " is set at the edge", want.test(v), "got " + JSON.stringify(v));
}
{
  const csp = root.r.headers.get("content-security-policy") || "";
  ok("the live CSP allows no inline script, no eval and no remote origin",
    !/unsafe-inline|unsafe-eval|https?:/i.test(csp), csp);
}
ok("the page is not cached at the edge", (root.r.headers.get("cache-control") || "").includes("no-cache"));

{
  const r = await fetch(URL_BASE + "/", { method: "POST" });
  ok("a POST is refused", r.status === 405 || r.status === 404, "got " + r.status);
}
{
  const r = await fetch(URL_BASE + "/definitely-not-here-" + pass);
  ok("an unknown path 404s rather than being rewritten into the app", r.status === 404, "got " + r.status);
}

/* -------------------------------------------------- the deployed build itself */

/* Wait for the new build to reach the edge before asserting anything about its contents.
 *
 * Both halves are checked, and that is the lesson from getting this wrong twice: rev.json is
 * a separate cache entry from the page, so the manifest can be current while `/` is still the
 * previous release. Gating on the manifest alone passed the build-id check and then failed the
 * byte comparison underneath it, on a deploy that had worked perfectly. Gate on the thing you
 * are about to make assertions about. */
const local = JSON.parse(fs.readFileSync(path.join(REPO, "public", "rev.json"), "utf8"));
let rev = null, rootText = root.text, waited = 0;
for (;;) {
  rev = JSON.parse((await get("/rev.json")).text);
  const pageIsCurrent = rootText.includes("?v=" + local.id);
  if ((rev.id === local.id && pageIsCurrent) || waited >= 90000) break;
  if (!waited) console.log("  ...  waiting for " + local.id + " to reach the edge");
  await sleep(5000);
  waited += 5000;
  rootText = (await get("/")).text;
}
ok("the deployed build id matches the one on disk (" + rev.id + ")" +
   (waited ? ", after " + waited / 1000 + "s" : ""),
  rev.id === local.id && rootText.includes("?v=" + local.id),
  "live " + rev.id + " against local " + local.id +
  ", page current: " + rootText.includes("?v=" + local.id) + ". Run npm run deploy.");
root.text = rootText;

/* EVERY text asset in public/, read off the directory rather than listed again here. A typed
 * list goes stale the moment a file joins the bundle, and it goes stale silently: the new file
 * is simply never compared, so the one check that says the deployed bytes are the reviewed bytes
 * quietly stops covering it. That happened once already, when duitnow-mark.js was added.
 * index.html is compared separately below, out of the root response. */
const files = fs.readdirSync(path.join(REPO, "public"))
  .filter((f) => /\.(js|css|json|webmanifest)$/i.test(f) && f !== "index.html")
  .sort();
ok("the wire check covers every text asset in public/", files.length >= 8, files.join(", "));
const fetched = {};
for (const f of files) {
  const { text } = await get("/" + f);
  fetched[f] = text;
  const disk = fs.readFileSync(path.join(REPO, "public", f), "utf8");
  ok(f + " served byte for byte as built", text === disk);
}
ok("index.html served byte for byte as built",
  root.text === fs.readFileSync(path.join(REPO, "public", "index.html"), "utf8"));

/* ----------------------------------------------- nothing private on the wire */

{
  const master = JSON.parse(fs.readFileSync(path.join(MASTER, "accounts.json"), "utf8"));
  const secret = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (t.length >= 4) secret.add(t);
    const sq = t.replace(/[\s-]/g, "");
    if (sq.length >= 6) secret.add(sq);
  };
  /* `sub` is deliberately NOT on this list. The account numbers ship, as `acct`, for the back
   * of the coin; see the note on SHIP in tools/build.mjs. Everything else the master holds must
   * still stay behind, and the assertion after this one checks the other direction so the
   * feature cannot silently disappear either. */
  add(master.payee);
  (master.owners || []).forEach((o) => { add(o && o.name); add(o && o.legal); });
  master.accounts.forEach((a) => { add(a.mid); });

  /* filter(Boolean) is load-bearing: an account with no DuitNow code has no payload, and
   * `body.split("")` would split every served file into its individual characters, leaving the
   * leak search reading rubble and quietly finding nothing. */
  const payloads = master.accounts.map((a) => a.payload).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const hits = [];
  for (const [name, body] of Object.entries({ "index.html": root.text, ...fetched })) {
    let t = body;
    for (const p of payloads) t = t.split(p).join(" PAYLOAD ");
    const hay = t.toLowerCase();
    for (const s of secret) if (hay.includes(s.toLowerCase())) hits.push(name);
  }
  ok("no dropped value is served anywhere, outside the payloads themselves",
    hits.length === 0, [...new Set(hits)].join(", "));

  /* And the slugged form, which exact matching above cannot see. A key derived from the payee
   * would be served as text AND become the public URL of the page, and one very nearly was.
   * This is the copy that matters most, because it reads what is actually on the wire rather
   * than what the build believed it wrote. */
  const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stems = [master.payee, ...(master.owners || []).flatMap((o) => [o && o.name, o && o.legal])]
    .map((v) => squash(v).slice(0, 12)).filter((s) => s.length === 12);
  const slugHits = [];
  for (const [name, body] of Object.entries({ "index.html": root.text, ...fetched })) {
    let t = body;
    for (const p of payloads) t = t.split(p).join(" PAYLOAD ");
    const flat = squash(t);
    for (const s of stems) if (flat.includes(s)) slugHits.push(name + " <- " + JSON.stringify(s));
  }
  ok("no slugged form of a person's name is served outside the payloads",
    stems.length > 0 && slugHits.length === 0, [...new Set(slugHits)].join(", "));

  // And the other way: every account number is actually being served, matching the master.
  const served = JSON.parse(fetched["data.js"].match(/self\.QR_CODES = ([\s\S]*?);\nself\.QR_BUILD/)[1]);
  const wrong = master.accounts.filter((a) => {
    const c = served.find((x) => x.key === a.key);
    return !c || c.acct !== String(a.sub || "").trim();
  });
  ok("every account number is served, matching the master exactly", wrong.length === 0,
    wrong.map((a) => a.key).join(", "));
}

/* ------------------------------------------------ the served codes still scan */

{
  const qrcode = new Function("return (function(){" + fetched["qrcode.js"] + "; return qrcode;})();")();
  const scope = { qrcode };
  new Function("self", fetched["qr-art.js"]).call(scope, scope);
  const QRArt = scope.QRArt;
  const js = {};
  new Function("self", fs.readFileSync(path.join(HERE, "vendor", "jsqr.js"), "utf8")).call(js, js);
  const jsQR = js.jsQR;
  const codes = JSON.parse(fetched["data.js"].match(/self\.QR_CODES = ([\s\S]*?);\nself\.QR_BUILD/)[1]);

  const master = JSON.parse(fs.readFileSync(path.join(MASTER, "accounts.json"), "utf8"));
  const bad = [];
  /* AN ACCOUNT WITH NO CODE IS NOT DECODED, and skipping it is not the same as ignoring it.
   * Handed an empty payload the encoder encodes the empty string and jsQR reads back "", so
   * `got.data === c.payload` compares "" with "" and passes, claiming to have proved something
   * about a code that does not exist. The served-vs-master comparison above still covers it. */
  const withCode = codes.filter((c) => c.payload);
  for (const c of codes) {
    const src = master.accounts.find((a) => a.key === c.key);
    if (!src || String(src.payload || "") !== c.payload) { bad.push(c.key + ": served payload differs from the master"); continue; }
    if (!c.payload) continue;
    for (const px of [QRArt.DEFAULTS.safePhysicalPx, 700, 1000]) {
      const canvas = createCanvas(8, 8);
      QRArt.draw(canvas, c.payload, { size: px, pixelRatio: 1, brand: c.brand });
      const g = canvas.getContext("2d");
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (!got) bad.push(c.key + " at " + px + "px: no read");
      else if (got.data !== c.payload) bad.push(c.key + " at " + px + "px: decoded to something else");
    }
  }
  ok("every code the live site serves renders and decodes back to the master's payload " +
     "(" + withCode.length + " codes, " + (codes.length - withCode.length) + " without one)",
    bad.length === 0, bad.slice(0, 6).join("\n        "));
  ok("the live site serves every account the master has", codes.length === master.accounts.length);

  /* And the code-less ones carry what makes them payable. A plate with no bank or no holder is
   * three quarters of a transfer instruction, which is worse than not being there at all. */
  const thin = codes.filter((c) => !c.payload).filter((c) => !c.bank || !c.acct);
  ok("every account served without a code names its bank and its number",
    thin.length === 0, thin.map((c) => c.key).join(", "));
}

console.log("\n" + (fail ? "FAILED: " : "ok: ") + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
