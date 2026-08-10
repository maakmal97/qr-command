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
const URL_BASE = (process.argv[2] || "https://qr-command.maakmal97.workers.dev").replace(/\/+$/, "");
const MASTER = process.env.QR_MASTER ||
  "C:/Users/maakm/Claude/Projects/Personal/Cow-Fin06_QR Consolidator/pay-afif-site";

let pass = 0, fail = 0;
const ok = (what, cond, detail) => {
  if (cond) { pass++; console.log("  ok    " + what); }
  else { fail++; console.log("  FAIL  " + what + (detail ? "\n        " + detail : "")); }
};

const get = async (p) => {
  const r = await fetch(URL_BASE + p, { redirect: "follow" });
  return { r, text: await r.text() };
};

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

const rev = JSON.parse((await get("/rev.json")).text);
const local = JSON.parse(fs.readFileSync(path.join(REPO, "public", "rev.json"), "utf8"));
ok("the deployed build id matches the one on disk (" + rev.id + ")", rev.id === local.id,
  "live " + rev.id + " against local " + local.id + ". Run npm run deploy.");

const files = ["app.js", "app.css", "qr-art.js", "qrcode.js", "data.js", "sw.js", "manifest.webmanifest"];
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
  add(master.payee);
  (master.owners || []).forEach((o) => { add(o && o.name); add(o && o.legal); });
  master.accounts.forEach((a) => { add(a.sub); add(a.mid); });

  const payloads = master.accounts.map((a) => a.payload).sort((a, b) => b.length - a.length);
  const hits = [];
  for (const [name, body] of Object.entries({ "index.html": root.text, ...fetched })) {
    let t = body;
    for (const p of payloads) t = t.split(p).join(" PAYLOAD ");
    const hay = t.toLowerCase();
    for (const s of secret) if (hay.includes(s.toLowerCase())) hits.push(name);
  }
  ok("no dropped value is served anywhere, outside the payloads themselves",
    hits.length === 0, [...new Set(hits)].join(", "));
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
  for (const c of codes) {
    const src = master.accounts.find((a) => a.key === c.key);
    if (!src || src.payload !== c.payload) { bad.push(c.key + ": served payload differs from the master"); continue; }
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
     "(" + codes.length + " codes)", bad.length === 0, bad.slice(0, 6).join("\n        "));
  ok("the live site serves every account the master has", codes.length === master.accounts.length);
}

console.log("\n" + (fail ? "FAILED: " : "ok: ") + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
