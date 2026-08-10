/* verify.mjs - the whole suite. No network, no browser, no framework, about three seconds.
 *
 * Four things are being defended here, in descending order of how much it would hurt to get
 * them wrong:
 *
 *   1. THE CODES STILL SCAN. Every real payload is drawn by the very renderer that ships and
 *      decoded back with jsQR, at every size and pixel ratio the app can ask for. A pretty QR
 *      that does not read is worse than no app at all, because it fails at a counter with
 *      somebody waiting.
 *   2. NOTHING PRIVATE SHIPPED. The bundle is read back and searched for every value the
 *      master holds and the build was supposed to drop.
 *   3. THE CONFIG MATCHES THE CODE. wrangler.jsonc is parsed and its binding names are checked
 *      against the identifiers the Worker actually reads. This is the assertion salt-command
 *      did not have on 08 Aug, when a lowercase binding name in the config broke every write
 *      in production while the suite stayed green, because the suite mocked the binding
 *      instead of reading the file.
 *   4. THE SERVICE WORKER CANNOT POISON ITSELF. Its guards are asserted from its source.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PUB = path.join(REPO, "public");
const MASTER = process.env.QR_MASTER ||
  "C:/Users/maakm/Claude/Projects/Personal/Cow-Fin06_QR Consolidator/pay-afif-site";

const read = (p) => fs.readFileSync(p, "utf8");

let pass = 0, fail = 0;
function ok(what, cond, detail) {
  if (cond) { pass++; return true; }
  fail++;
  console.log("  FAIL  " + what + (detail ? "\n        " + detail : ""));
  return false;
}
const section = (s) => console.log("\n" + s);

/* -------------------------------------------------------------- shared fixtures */

const master = JSON.parse(read(path.join(MASTER, "accounts.json")));
const V = await import(pathToFileURL(path.join(MASTER, "functions", "_lib", "store.js")).href);
const rev = JSON.parse(read(path.join(PUB, "rev.json")));
const dataSrc = read(path.join(PUB, "data.js"));
const shipped = JSON.parse(dataSrc.match(/self\.QR_CODES = ([\s\S]*?);\nself\.QR_BUILD/)[1]);
const indexHtml = read(path.join(PUB, "index.html"));
const swSrc = read(path.join(PUB, "sw.js"));

function classicScript(file, extra) {
  const scope = Object.assign({ location: { origin: "https://x" } }, extra || {});
  new Function("self", "window", read(file)).call(scope, scope, scope);
  return scope;
}
const qrcode = new Function("return (function(){" + read(path.join(PUB, "qrcode.js")) + "; return qrcode;})();")();
const QRArt = classicScript(path.join(PUB, "qr-art.js"), { qrcode }).QRArt;
const jsQR = classicScript(path.join(HERE, "vendor", "jsqr.js")).jsQR;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const files = walk(PUB);
const rel = (f) => path.relative(PUB, f).replace(/\\/g, "/");

/* ============================================================ 1. the codes scan */

section("1. Every code decodes, from the renderer that ships");

/* Decode a code at a given PHYSICAL size, which is the size it occupies on the glass and so
 * the only size a camera cares about. A large backing store shown small proves nothing. */
function decode(c, physical, extra) {
  const canvas = createCanvas(8, 8);
  const meta = QRArt.draw(canvas, c.payload,
    Object.assign({ size: physical, pixelRatio: 1, brand: c.brand, label: c.name, seed: c.key }, extra || {}));
  const g = canvas.getContext("2d");
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  return { ok: !!got && got.data === c.payload, meta, got };
}

const SAFE = QRArt.DEFAULTS.safePhysicalPx;

{
  const sizes = [SAFE, 620, 700, 820, 1000, 1240];
  const bad = [];
  let n = 0;
  for (const c of shipped) for (const px of sizes) {
    const r = decode(c, px);
    n++;
    if (r.meta.plain) bad.push(c.key + " at " + px + "px fell back to plain above the safe size");
    if (!r.ok) bad.push(c.key + " at " + px + "px physical" + (r.got ? " (wrong string)" : " (no read)"));
  }
  ok("the coin decodes at and above its stated safe size, " + SAFE + "px (" + n + " renders)",
    bad.length === 0, bad.slice(0, 6).join("\n        "));
}

{
  // Below the safe size the renderer must drop to the plain code by itself, and that code must
  // read. This is the guard that stops a small window silently producing an unscannable badge.
  const bad = [];
  for (const c of shipped) for (const px of [240, 300, 380, 460, SAFE - 1]) {
    const r = decode(c, px);
    if (!r.meta.plain) bad.push(c.key + " at " + px + "px still drew a coin");
    if (!r.meta.fellBack) bad.push(c.key + " at " + px + "px did not report the fallback");
    if (!r.ok) bad.push(c.key + " plain at " + px + "px did not decode");
  }
  ok("below the safe size it falls back to the plain code, and that decodes", bad.length === 0,
    bad.slice(0, 6).join("\n        "));
}

{
  // The safe size must be a measurement with headroom, not a number someone liked. Re-measure
  // the worst code's floor and assert the threshold still sits above it.
  let worst = 0, who = "";
  for (const c of shipped) {
    let floor = null, streak = 0;
    for (let px = 200; px <= 1000; px += 20) {
      if (decode(c, px, { safePhysicalPx: 0 }).ok) { if (!streak) floor = px; streak++; if (streak >= 6) break; }
      else { streak = 0; floor = null; }
    }
    if (floor === null) { worst = Infinity; who = c.key; break; }
    if (floor > worst) { worst = floor; who = c.key; }
  }
  ok("the safe size sits above the measured floor of the worst code (" + who + " reads from " +
     worst + "px, threshold " + SAFE + "px)", worst * 1.2 <= SAFE);
}

{
  const bad = [];
  for (const c of shipped) for (const px of [240, 400, 700]) {
    if (!decode(c, px, { plain: true }).ok) bad.push(c.key + " at " + px);
  }
  ok("the plain fallback decodes for every code, down to 240px", bad.length === 0, bad.join(", "));
}

{
  const levels = {};
  for (const c of shipped) {
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    levels[p.ecl] = (levels[p.ecl] || 0) + 1;
  }
  {
    /* ONE FILL PER MODULE, asserted so nobody "optimises" it into one big path. That was tried
     * and measured: fourteen times slower, 25.8ms against 1.84ms for the same 1,172 modules,
     * because a fill is charged by its path's bounding box and one path spans the whole code.
     * It turned a 6ms draw into 17ms and was a visible cause of jitter. */
    const art = read(path.join(PUB, "qr-art.js"));
    ok("each module is filled on its own, never batched into one path",
      /blob\(g, dark, n, r, c, geo, opts\.dot\);/.test(art) &&
      !/new Path2D|newPath\(\)/.test(art));
  }

  ok("every code encodes at M, the level the master page and the printed card use " +
     "(" + JSON.stringify(levels) + ")", levels.M === shipped.length);
}

{
  /* The image saved to the gallery. This one matters more than the on-screen coin: it is
   * scanned out of somebody else's photo library, often after a messaging app has recompressed
   * it, and there is nobody there to pinch and zoom if it will not read. */
  const bad = [];
  let minCoin = Infinity;
  for (const c of shipped) {
    const canvas = createCanvas(8, 8);
    const meta = QRArt.drawCard(canvas, c.payload, { brand: c.brand, label: c.name, seed: c.key });
    const g = canvas.getContext("2d");
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (!got) bad.push(c.key + ": no read");
    else if (got.data !== c.payload) bad.push(c.key + ": decoded to something else");
    if (meta.plain) bad.push(c.key + ": the card fell back to a plain code");
    minCoin = Math.min(minCoin, meta.cssSize);
  }
  ok("the image saved to the gallery decodes for every code", bad.length === 0, bad.join("; "));
  ok("the saved coin is drawn far above the safe size (" + minCoin + "px against " + SAFE + ")",
    minCoin >= SAFE * 1.6);
}

{
  // Halving a saved card, as a messaging app would, must not make it unreadable.
  const bad = [];
  for (const c of shipped) {
    const full = createCanvas(8, 8);
    QRArt.drawCard(full, c.payload, { brand: c.brand, label: c.name, seed: c.key, cardWidth: 700 });
    const g = full.getContext("2d");
    const img = g.getImageData(0, 0, full.width, full.height);
    const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (!got || got.data !== c.payload) bad.push(c.key);
  }
  ok("a saved card halved to 700px still decodes", bad.length === 0, bad.join(", "));
}

{
  // The coin's outline is derived from the provider key, so it is stable for ever and
  // different between providers. Both halves of that are worth asserting.
  const opts = Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode });
  const shot = (c) => {
    const cv = createCanvas(8, 8);
    QRArt.draw(cv, c.payload, { size: 700, pixelRatio: 1, brand: c.brand, label: c.name, seed: c.key });
    return crypto.createHash("sha256").update(Buffer.from(
      cv.getContext("2d").getImageData(0, 0, 60, cv.height / 2).data)).digest("hex");
  };
  const first = shipped.map(shot);
  const again = shipped.map(shot);
  ok("the same account draws the same coin every time", first.join() === again.join());
  ok("no two accounts share an outline and a colour", new Set(first).size === first.length);
  void opts;
}

{
  // The decoded string must be the payload byte for byte, not a normalised version of it.
  const c = shipped[0];
  const canvas = createCanvas(8, 8);
  QRArt.draw(canvas, c.payload, { size: 400, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
  const g = canvas.getContext("2d");
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  ok("the decoded string is identical in length and content, not merely equal-ish",
    got && got.data.length === c.payload.length && got.data === c.payload);
}

{
  let worst = Infinity, who = "";
  for (const c of shipped) {
    const p = QRArt.palette(c.brand, QRArt.DEFAULTS.minContrast);
    if (p.contrast < worst) { worst = p.contrast; who = c.key; }
  }
  ok("ink clears the contrast floor against the field for every brand (worst " +
     worst.toFixed(1) + ":1 on " + who + ")", worst >= QRArt.DEFAULTS.minContrast);
}

{
  // The floor that makes the decode stable at small display sizes must actually be enforced.
  let bad = [];
  for (const c of shipped) {
    const canvas = createCanvas(8, 8);
    const meta = QRArt.draw(canvas, c.payload, { size: 90, pixelRatio: 1, brand: c.brand });
    if (meta.modulePxDevice < QRArt.DEFAULTS.minModulePx - 0.001) bad.push(c.key + " " + meta.modulePxDevice.toFixed(2));
    if (canvas.width !== canvas.height) bad.push(c.key + " not square");
  }
  ok("a tiny requested size still renders a buffer at or above the module floor", bad.length === 0, bad.join(", "));
}

{
  // Quiet zone: the light field must circumscribe the code plus four modules, corners and
  // all. Assert the geometry rather than trusting the comment above it.
  let bad = [];
  for (const c of shipped) {
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    const geo = QRArt.coinGeometry(p.n, 1000, QRArt.DEFAULTS);
    const halfMargin = (p.n / 2 + QRArt.DEFAULTS.quiet) * geo.m;   // half the margin square
    const cornerReach = halfMargin * Math.SQRT2;                    // its corner, from centre
    if (cornerReach > geo.Rd + 0.51) bad.push(c.key + " corner " + cornerReach.toFixed(1) + " > field " + geo.Rd.toFixed(1));
  }
  ok("the light field contains the four-module quiet zone, corners included", bad.length === 0, bad.join(", "));
}

{
  /* The finder patterns, measured off the painted pixels.
   *
   * This is the assertion the module-by-module comparison cannot make. A finder carries no
   * error correction, because it is a function pattern rather than data: a decoder that
   * cannot see one does not recover from it, it simply never finds the code at all. What
   * every decoder looks for is the run-length ratio 1:1:3:1:1 of dark, light, dark, light,
   * dark along a line through the centre. The eyes here are stylised, so that ratio is
   * measured from the pixels rather than assumed from the geometry.
   */
  function runsThrough(img, w, y, x0, x1) {
    const runs = [];
    let prev = null, len = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const dark = (0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]) < 128;
      if (dark === prev) len++;
      else { if (prev !== null) runs.push({ dark: prev, len }); prev = dark; len = 1; }
    }
    runs.push({ dark: prev, len });
    return runs;
  }

  const bad = [];
  for (const c of shipped) {
    const canvas = createCanvas(8, 8);
    QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    const geo = QRArt.coinGeometry(p.n, canvas.width, QRArt.DEFAULTS);
    const img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;

    for (const [r0, c0, where] of [[0, 0, "top-left"], [0, p.n - 7, "top-right"], [p.n - 7, 0, "bottom-left"]]) {
      const yMid = Math.round((geo.gy(r0 + 3) + geo.gy(r0 + 4)) / 2);
      const runs = runsThrough(img, canvas.width, yMid,
        Math.round(geo.gx(c0) - geo.m), Math.round(geo.gx(c0 + 7) + geo.m))
        .filter((r) => r.len > 1);
      const core = runs.slice(runs.findIndex((r) => r.dark));
      if (core.length < 5) { bad.push(c.key + " " + where + ": only " + core.length + " runs"); continue; }
      const five = core.slice(0, 5);
      if (!five.every((r, i) => r.dark === (i % 2 === 0))) { bad.push(c.key + " " + where + ": runs are not dark/light alternating"); continue; }
      const unit = (five[0].len + five[1].len + five[3].len + five[4].len) / 4;
      const ratios = five.map((r) => r.len / unit);
      const want = [1, 1, 3, 1, 1];
      const off = ratios.map((v, i) => Math.abs(v - want[i]));
      if (Math.max(...off) > 0.5) {
        bad.push(c.key + " " + where + ": ratio " + ratios.map((v) => v.toFixed(2)).join(":") + " against 1:1:3:1:1");
      }
    }
  }
  ok("every finder eye still measures 1:1:3:1:1 through its centre in the painted pixels",
    bad.length === 0, bad.slice(0, 5).join("\n        "));
}

{
  /* Outside the eyes there is no artistic licence at all: every data module must be painted
   * exactly as the matrix says, because that is what a decoder samples once it has found the
   * code. The eyes are the only place the drawing departs from the matrix, and only at their
   * outermost diagonal corners. */
  const bad = [];
  for (const c of shipped) {
    const canvas = createCanvas(8, 8);
    QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    const geo = QRArt.coinGeometry(p.n, canvas.width, QRArt.DEFAULTS);
    const img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const n = p.n;
    const lum = (x, y) => { const i = (Math.round(y) * canvas.width + Math.round(x)) * 4;
      return 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]; };
    /* The only cells allowed to differ, named rather than counted: the four outer corners of
     * each eye's 7x7 block and the four corners of the 5x5 light ring inside it. Those are
     * what a rounded eye is. Anywhere else, including one cell of the timing pattern or an
     * alignment pattern, is a bug. */
    const allowed = new Set();
    for (const [R0, C0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (const [dr, dc] of [[0, 0], [0, 6], [6, 0], [6, 6], [1, 1], [1, 5], [5, 1], [5, 5]]) {
        allowed.add((R0 + dr) + "," + (C0 + dc));
      }
    }
    const stray = [];
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      const x = (geo.gx(col) + geo.gx(col + 1)) / 2, y = (geo.gy(r) + geo.gy(r + 1)) / 2;
      if ((lum(x, y) < 128) !== p.qr.isDark(r, col) && !allowed.has(r + "," + col)) {
        stray.push(r + "," + col);
      }
    }
    if (stray.length) bad.push(c.key + ": painted against the matrix at " + stray.slice(0, 8).join(" "));
  }
  ok("nothing is painted against the matrix except the corners of the three eyes",
    bad.length === 0, bad.join("\n        "));
}

{
  // The quiet zone must be light all the way round, four modules out.
  const bad = [];
  for (const c of shipped) {
    const canvas = createCanvas(8, 8);
    QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    const geo = QRArt.coinGeometry(p.n, canvas.width, QRArt.DEFAULTS);
    const img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = (x, y) => { const i = (Math.round(y) * canvas.width + Math.round(x)) * 4;
      return 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]; };
    for (let k = 1; k <= 4; k++) {
      for (let t = 0; t <= p.n; t += Math.max(1, Math.floor(p.n / 12))) {
        const along = (geo.gx(t) + geo.gx(Math.min(t + 1, p.n))) / 2;
        const pts = [[along, geo.gy(0) - (k - 0.5) * geo.m], [along, geo.gy(p.n) + (k - 0.5) * geo.m],
                     [geo.gx(0) - (k - 0.5) * geo.m, along], [geo.gx(p.n) + (k - 0.5) * geo.m, along]];
        for (const [x, y] of pts) if (lum(x, y) < 190) bad.push(c.key + " at " + k + " modules out");
      }
    }
  }
  ok("the quiet zone is light for four modules on every side", bad.length === 0,
    [...new Set(bad)].slice(0, 5).join(", "));
}

{
  const levels = {};
  for (const c of shipped) {
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    levels[p.ecl] = (levels[p.ecl] || 0) + 1;
    if (p.n > QRArt.DEFAULTS.maxModules) levels.OVER = (levels.OVER || 0) + 1;
  }
  ok("no code exceeds the module cap (" + JSON.stringify(levels) + ")", !levels.OVER);
}

/* ================================================== 2. nothing private shipped */

section("2. The bundle carries the codes and nothing else");

{
  const banned = /\.(md|pdf|py|pyc|pem|key|bak|zip|log|env)$/i;
  const offenders = files.filter((f) => banned.test(f) ||
    /(^|\/)(backups|__pycache__|node_modules|\.git)(\/|$)/.test(rel(f)));
  ok("public/ holds no docs, PDFs, scripts, backups or caches", offenders.length === 0, offenders.map(rel).join(", "));
}

{
  const SHIP = ["brand", "key", "name", "payload"];
  const wrong = shipped.filter((c) => Object.keys(c).sort().join() !== SHIP.join());
  ok("every shipped record has exactly key, name, brand, payload", wrong.length === 0,
    wrong.map((w) => w.key + ": " + Object.keys(w).join(",")).join("; "));
}

{
  // Everything the master holds that the build was supposed to leave behind, gathered from
  // the master rather than typed here, so a new field upstream is covered automatically.
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

  const payloads = shipped.map((c) => c.payload).sort((a, b) => b.length - a.length);
  const hits = [];
  for (const f of files) {
    if (!/\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f)) continue;
    let body = read(f);
    for (const p of payloads) body = body.split(p).join(" PAYLOAD ");
    const hay = body.toLowerCase();
    for (const s of secret) if (hay.includes(s.toLowerCase())) hits.push(rel(f) + " <- " + s.length + " chars");
  }
  ok("no dropped value appears anywhere in public/ outside a payload", hits.length === 0, [...new Set(hits)].join("\n        "));
}

{
  // The counterpart, and the honest half of it: the name IS inside the codes, and that is a
  // property of DuitNow, not of this site. Assert it, so the fact stays visible in the suite
  // rather than being quietly forgotten the next time somebody reads the check above.
  const name = String(master.payee || "").trim().toUpperCase().slice(0, 12);
  const inside = shipped.filter((c) => c.payload.toUpperCase().includes(name)).length;
  ok("recorded: the account-holder name is inside " + inside + " of " + shipped.length +
     " payloads and cannot be removed without breaking payment", inside > 0);
}

{
  const bad = [];
  for (const c of shipped) {
    const src = master.accounts.find((a) => a.key === c.key);
    if (!src) { bad.push(c.key + " is not in the master"); continue; }
    if (src.payload !== c.payload) bad.push(c.key + " payload differs from the master");
    if (V.payloadError(c.payload)) bad.push(c.key + ": " + V.payloadError(c.payload));
  }
  ok("every payload is byte-identical to the master and passes the master's own validator",
    bad.length === 0, bad.join("; "));
}

{
  // Proof that the validator above is live rather than a function that returns null. Flip one
  // character of a copy and it must be refused.
  const p = shipped[0].payload;
  const tampered = p.slice(0, 30) + (p[30] === "1" ? "2" : "1") + p.slice(31);
  ok("the master's validator rejects a payload with one character changed",
    V.payloadError(tampered) !== null);
}

{
  const externals = [];
  for (const f of files) {
    if (!/\.(html|js|css|webmanifest)$/i.test(f)) continue;
    const m = read(f).match(/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import[^;]*https?:/i);
    if (m) externals.push(rel(f) + ": " + m[0]);
  }
  ok("nothing is loaded from another origin", externals.length === 0, externals.join(", "));
}

{
  /* The three things the page must be able to do, asserted from the shipped source rather
   * than from memory of having written them. */
  const appJs = read(path.join(PUB, "app.js"));

  const appCss = read(path.join(PUB, "app.css"));
  /* Strip the comments first. An assertion that something is ABSENT will otherwise be defeated
   * by the comment explaining why it was removed, which is exactly what happened here and
   * happened once already with animationend. Assert against the code, not the prose. */
  const cssCode = appCss.replace(/\/\*[\s\S]*?\*\//g, "");

  ok("the app opens on the accounts, not on a code",
    /<body class="view-list">/.test(indexHtml) &&
    /body\.view-list \.accounts\{display:flex;\}/.test(appCss));
  ok("every account is a named tile on that first screen",
    /id="grid"/.test(indexHtml) && /className = "tile"/.test(appJs) && /tiletext/.test(appJs));
  ok("a code has an explicit way back to the accounts",
    /id="back"/.test(indexHtml) && /elBack\.addEventListener\("click", goBack\)/.test(appJs));
  ok("the two views are addressed by the hash, so back and a home-screen link both work",
    /function route\(\)/.test(appJs) && /popstate/.test(appJs) && /history\.pushState/.test(appJs));
  ok("stepping between codes replaces rather than pushes, so back is never a walk backwards " +
     "through everything swiped past", /history\.replaceState\(history\.state/.test(appJs));
  ok("nothing scrolls sideways any more",
    !/overflow-x:auto/.test(appCss) && !/id="dots"/.test(indexHtml));

  ok("the code saves by share sheet where that exists and by download otherwise",
    /navigator\.canShare\(\s*\{\s*files/.test(appJs) && /navigator\.share\(/.test(appJs) &&
    /a\.download = card\.name/.test(appJs));
  ok("a cancelled share sheet is not reported as a failure",
    /AbortError/.test(appJs));

  /* The save has no label, so the affordance is doing the work and is therefore load-bearing
   * rather than decoration. Press and hold is the gesture a phone has already taught for
   * keeping a picture; the coin has to look like an object worth pressing; and the motion on
   * save is the only explanation the action ever gets. */
  ok("press and hold saves, which is the gesture phones already teach for keeping a picture",
    /pointerdown/.test(appJs) && /setTimeout\(function \(\) \{[\s\S]{0,200}?save\(\);/.test(appJs));
  ok("a hold does not then also fire the tap, so one press never saves twice",
    /if \(held\)/.test(appJs));
  ok("the coin is drawn as a physical object: a contact shadow, a lit rim and a press state",
    /inset 0 2px 0 rgba\(255,255,255/.test(appCss) && /\.coinbtn:active\{/.test(appCss));
  ok("saving plays a motion, so the action explains itself the first time",
    /@keyframes tuck/.test(appCss) && /oneShot\(elBtn, "tuck"/.test(appJs));
  ok("the long press cannot raise the system copy menu over the top of it",
    /-webkit-touch-callout:none/.test(appCss) && /contextmenu/.test(appJs));

  /* Motion. The rule that matters is that none of it can be load-bearing: a reduced-motion
   * phone runs no animations at all, so anything waiting on an animation to finish would wait
   * for ever. Every step is on a timer that collapses to zero instead. */
  ok("the list deals itself in, the coin arrives, and stepping between codes travels",
    /@keyframes tile-in/.test(appCss) && /@keyframes coin-in\b/.test(appCss) &&
    /@keyframes coin-out-left/.test(appCss) && /@keyframes coin-in-right/.test(appCss));
  /* The zoom. The thumbnail on a tile is the same coin drawn small, and opening an account
   * flies that very image up to full size, so it reads as one object moving rather than a dot
   * being swapped for a coin. Both ends are measured while their own view is on screen, which
   * is why fly() takes rects: whichever view is hidden reports zeros for everything in it, and
   * measuring after the switch made the previous version do nothing at all, silently. */
  ok("a tile's thumbnail is the real coin, drawn small",
    /className = "tiledot"/.test(appJs) && /decorative: true/.test(appJs) &&
    /function drawThumbs\(\)/.test(appJs) && /\.tiledot\{/.test(cssCode));
  ok("opening an account flies that same image up to full size",
    /function fly\(fromRect, toRect, image, opts\)/.test(appJs) &&
    /fly\(from, to, pre\.canvas/.test(appJs) && /\.flier\{/.test(cssCode));
  ok("going back flies it down into its tile again",
    /reverse: true/.test(appJs) && /fly\(from, to, shot/.test(appJs));
  ok("both ends are measured while their own view is on screen",
    /var from = thumb \? thumb\.getBoundingClientRect\(\) : null;/.test(appJs) &&
    /var to = elBtn\.getBoundingClientRect\(\);/.test(appJs));
  ok("the flier carries the full-size render and is only ever scaled down",
    /c\.width = image\.width;/.test(appJs) && /var s = small\.width \/ big\.width;/.test(appJs));
  ok("if the zoom cannot play, the coin still gets an entrance",
    /if \(!flew\) \{ restore\(\); oneShot\(elBtn, "enter"/.test(appJs));
  ok("the decorative escape from the safe-size rule is used for thumbnails only",
    (appJs.match(/decorative: true/g) || []).length === 1);
  ok("saving throws a ring off the coin", /@keyframes flash/.test(appCss) && /function flash\(/.test(appJs));
  ok("nothing waits on an animation event, so reduced motion cannot strand the app",
    !/addEventListener\(\s*"animationend"/.test(appJs) && /function after\(ms, fn\) \{ if \(still\(\)\) fn\(\); else setTimeout/.test(appJs));
  ok("reduced motion switches all of it off, in the sheet and in the script",
    /prefers-reduced-motion:reduce/.test(appCss) &&
    /animation:none !important/.test(appCss) &&
    /prefers-reduced-motion: reduce/.test(appJs) && /function still\(\)/.test(appJs));
  /* The flier is injected into the page, so it must come out again whatever the animation
   * does: a rejected or cancelled Web Animation must not leave a coin stuck over the app. It
   * cleans up on the animation's own promise AND on a timer, and the coin it was covering is
   * restored the same way. */
  ok("the flier always cleans up, whatever the animation does",
    /setTimeout\(finish, ms \+ \d+\)/.test(appJs) &&
    /a\.finished\.then\(finish, finish\)/.test(appJs) &&
    /setTimeout\(restore, \d+\)/.test(appJs));

  /* One-shot animation classes must remove themselves. They all set `animation` on the same
   * element, so one left behind out-ranks the next by nothing more than being further down the
   * stylesheet, and the symptom is a missing animation rather than an error. */
  ok("every one-shot animation class clears the others and then removes itself",
    /var ONESHOT = \[/.test(appJs) &&
    /for \(var i = 0; i < ONESHOT\.length; i\+\+\) el\.classList\.remove\(ONESHOT\[i\]\)/.test(appJs) &&
    /setTimeout\(function \(\) \{ el\.classList\.remove\(cls\); \}/.test(appJs));
  /* Three costs that jitter an animation without erroring, all of them found by measuring
   * rather than by reading. Each is now forbidden by assertion. */
  ok("the aurora uses no filter, so changing it cannot re-blur a full-screen layer per frame",
    !/filter:\s*blur/.test(cssCode) && /\.sky\{/.test(cssCode));
  ok("the aurora changes by cross-fading opacity, which the compositor does on its own",
    /\.sky\.on\{opacity/.test(cssCode) && /transition:opacity/.test(cssCode) &&
    /classList\.add\("on"\)/.test(appJs) && /classList\.remove\("on"\)/.test(appJs));
  ok("nothing transitions background-color on a full-screen element",
    !/\.sky[^{]*\{[^}]*transition:[^;}]*background-color/.test(cssCode));
  ok("the coin transitions transform only, never its box-shadow",
    /\.coinbtn\{[\s\S]*?transition:transform [^;]+;/.test(cssCode) &&
    !/\.coinbtn[^{]*\{[^}]*transition:[^;}]*box-shadow/.test(cssCode));
  ok("a step pre-renders the incoming coin, so the redraw is not in the middle of the animation",
    /function prerender\(i\)/.test(appJs) &&
    /var pre = still\(\) \? null : prerender\(i\);/.test(appJs) &&
    /drawImage\(pre\.canvas, 0, 0\)/.test(appJs));
  ok("the coin is promoted to its own layer, so a transform never repaints it",
    /\.coinbtn\{[\s\S]*?will-change:transform;/.test(cssCode));

  ok("no animation moves layout: transform and opacity only",
    (appCss.match(/@keyframes[^}]*\{[\s\S]*?\n\}/g) || []).every((k) =>
      !/(^|[\s;{])(width|height|top|left|right|bottom|margin|padding)\s*:/.test(k)));

  /* The saved image is built with toDataURL, not toBlob, and that is load-bearing rather than
   * a style choice: iOS only allows navigator.share from inside the gesture that triggered it,
   * and awaiting toBlob is enough to lose that permission. The failure mode is silent, the
   * share sheet simply never appears, so assert the synchronous route stays. */
  ok("the saved image is built synchronously, so the share gesture survives",
    /toDataURL\(/.test(appJs) && !/toBlob\(/.test(appJs));

  ok("a swipe cannot also register as a tap and save by accident",
    /if \(swiped\) \{ swiped = false; return; \}/.test(appJs) &&
    /Math\.abs\(e\.touches\[0\]\.clientX - x0\) > 20\) \{ swiped = true/.test(appJs));
}

{
  ok("index.html has no inline script",
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(indexHtml));
  ok("index.html has no inline style block or style attribute",
    !/<style[^>]*>[\s\S]*?\S[\s\S]*?<\/style>/i.test(indexHtml) && !/\sstyle\s*=\s*["']/i.test(indexHtml));
  ok("index.html carries no account data of its own",
    !/payload|QR_CODES\s*=/.test(indexHtml));
}

{
  /* Every custom property the stylesheet reads must be defined somewhere, or the rule using it
   * silently does nothing. An undefined var() is not a parse error and shows up only as a
   * control that quietly lost its radius or its colour. */
  const css = read(path.join(PUB, "app.css"));
  const appJs = read(path.join(PUB, "app.js"));
  const root = new Set();
  // Every :root block, not just the first: the tokens are declared in more than one place.
  for (const block of css.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)) root.add(m[1]);
  }
  // Some are set at runtime, per element or on the document, rather than in the sheet.
  for (const m of appJs.matchAll(/setProperty\(\s*"(--[a-z0-9-]+)"/gi)) root.add(m[1]);
  const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
  const missing = [...used].filter((v) => !root.has(v));
  ok("every CSS custom property the stylesheet uses is defined", missing.length === 0,
    "undefined: " + missing.join(", "));
}

{
  const scripts = files.filter((f) => /\.js$/i.test(f));
  const bad = [];
  for (const f of scripts) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
    catch (e) { bad.push(rel(f)); }
  }
  ok("every shipped script parses (" + scripts.length + " files)", bad.length === 0, bad.join(", "));
}

/* ================================================ 3. the config matches the code */

section("3. wrangler.jsonc agrees with the Worker, character for character");

const wranglerRaw = read(path.join(REPO, "wrangler.jsonc"));
let wrangler = null;
try {
  wrangler = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
} catch (e) { /* reported below */ }
ok("wrangler.jsonc parses once its comments are stripped", !!wrangler, wrangler ? "" : "JSON.parse failed");

const workerSrc = read(path.join(REPO, "src", "worker.js"));

if (wrangler) {
  ok("main points at src/worker.js and the file exists",
    wrangler.main === "src/worker.js" && fs.existsSync(path.join(REPO, wrangler.main)));
  ok("assets.directory is ./public and the folder exists",
    wrangler.assets && wrangler.assets.directory === "./public" && fs.existsSync(PUB));
  ok("run_worker_first is on, so the Worker sets the headers on every request",
    wrangler.assets && wrangler.assets.run_worker_first === true);
  ok("not_found_handling is not single-page-application",
    wrangler.assets && wrangler.assets.not_found_handling !== "single-page-application",
    "an SPA fallback answers a missing script with HTML, which a stale service worker then caches");
  ok("the project name is set and is a plain slug",
    typeof wrangler.name === "string" && /^[a-z0-9][a-z0-9-]{0,50}$/.test(wrangler.name));

  // THE ONE THAT SALT-COMMAND LACKED. Every env.X the Worker reads must be declared in the
  // config, spelled identically, case included.
  const readsRaw = [...workerSrc.matchAll(/\benv\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const reads = [...new Set(readsRaw)];
  const declared = new Set();
  if (wrangler.assets && wrangler.assets.binding) declared.add(wrangler.assets.binding);
  for (const k of Object.keys(wrangler.vars || {})) declared.add(k);
  for (const n of wrangler.kv_namespaces || []) declared.add(n.binding);
  for (const n of wrangler.r2_buckets || []) declared.add(n.binding);
  for (const n of wrangler.d1_databases || []) declared.add(n.binding);

  const undeclared = reads.filter((r) => !declared.has(r));
  ok("every binding the Worker reads is declared in the config (" + reads.join(", ") + ")",
    undeclared.length === 0,
    "undeclared: " + undeclared.join(", ") + ". This is the salt-command failure of 08 Aug: " +
    "the code read SALT_QUEUE, the config declared salt_queue, and the suite passed because " +
    "it mocked the binding instead of reading the file.");

  const unused = [...declared].filter((d) => !reads.includes(d));
  ok("the config declares nothing the Worker never reads", unused.length === 0, "unused: " + unused.join(", "));

  ok("no KV, secret or variable is configured, because the site is read-only",
    !wrangler.kv_namespaces && !wrangler.vars && !wrangler.d1_databases && !wrangler.r2_buckets);
}

/* ==================================================== 4. the Worker's behaviour */

section("4. The Worker, against a mock asset store");

const { default: worker, SECURITY } = await import(pathToFileURL(path.join(REPO, "src", "worker.js")).href);

function mockEnv(body = "<!DOCTYPE html>hello", status = 200, headers = { "content-type": "text/html" }) {
  return { ASSETS: { fetch: async () => new Response(body, { status, headers }) } };
}
const hit = (url, init) => worker.fetch(new Request("https://pay.example" + url, init), mockEnv());

{
  const r = await hit("/");
  ok("a GET is served from the assets", r.status === 200);
  const miss = Object.keys(SECURITY).filter((h) => !r.headers.get(h));
  ok("every security header is present on the response", miss.length === 0, "missing: " + miss.join(", "));
  ok("X-Robots-Tag says noindex", /noindex/i.test(r.headers.get("x-robots-tag") || ""));
  const csp = r.headers.get("content-security-policy") || "";
  ok("the CSP has no unsafe-inline, no unsafe-eval and no remote origin",
    !/unsafe-inline|unsafe-eval|https?:/i.test(csp), csp);
  ok("the CSP default-src is none", /default-src 'none'/.test(csp));
  ok("frame-ancestors is none", /frame-ancestors 'none'/.test(csp));
}

{
  for (const p of ["/", "/index.html", "/sw.js", "/rev.json", "/manifest.webmanifest"]) {
    const r = await hit(p);
    ok("no-cache on " + p, (r.headers.get("cache-control") || "") === "no-cache");
  }
  const r = await hit("/app.js?v=abc123");
  ok("a build-stamped asset is not forced to no-cache", (r.headers.get("cache-control") || "") !== "no-cache");
}

{
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await hit("/", { method });
    ok(method + " is refused with 405 and an Allow header",
      r.status === 405 && (r.headers.get("allow") || "").includes("GET"));
  }
  const head = await hit("/", { method: "HEAD" });
  ok("HEAD is served like GET", head.status === 200);
}

{
  const r = await worker.fetch(new Request("https://pay.example/"), {});
  ok("a missing ASSETS binding fails closed with a 500 that names the binding",
    r.status === 500 && /ASSETS/.test(await r.text()));
}

{
  const r = await worker.fetch(new Request("https://pay.example/nope"),
    { ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } });
  ok("a missing asset stays a 404 and is not rewritten into the app", r.status === 404);
  ok("the 404 still carries the security headers", !!r.headers.get("x-robots-tag"));
}

/* ============================================ 5. the service worker cannot poison */

section("5. The service worker's guards");

{
  ok("it refuses to cache anything that is not a complete, same-origin, unredirected 200",
    /status\s*===\s*200/.test(swSrc) && /type\s*===\s*"basic"/.test(swSrc) && /!\s*r\.redirected/.test(swSrc),
    "an unguarded put is how a worker ends up serving a sign-in or captive-portal page as the app");
  ok("it ignores every non-GET request", /req\.method\s*!==\s*"GET"/.test(swSrc));
  ok("it ignores cross-origin requests", /url\.origin\s*!==\s*self\.location\.origin/.test(swSrc));
  ok("navigations go to the network first", /req\.mode\s*===\s*"navigate"/.test(swSrc));
  ok("stale caches are deleted on activate", /caches\.delete/.test(swSrc));
}

{
  const cacheName = (swSrc.match(/const CACHE = "([^"]+)"/) || [])[1];
  ok("the cache name carries the build id, so no version constant has to be remembered",
    cacheName === "pay-" + rev.id, cacheName + " vs pay-" + rev.id);

  const shell = JSON.parse(swSrc.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
  const missing = shell.filter((u) => {
    const f = u.replace(/^\.\//, "").split("?")[0];
    return f && !fs.existsSync(path.join(PUB, f));
  });
  ok("every file the shell precaches exists in public/", missing.length === 0, missing.join(", "));
  const unstamped = shell.filter((u) => u !== "./" && !u.includes("?v=" + rev.id));
  ok("every precached URL carries this build's stamp", unstamped.length === 0, unstamped.join(", "));
}

/* ====================================================== 6. the build is coherent */

section("6. One build id, everywhere");

{
  const inHtml = [...indexHtml.matchAll(/\?v=([0-9a-f]{6,})/g)].map((m) => m[1]);
  ok("index.html stamps every asset with the build id", inHtml.length >= 4 && inHtml.every((v) => v === rev.id),
    [...new Set(inHtml)].join(", ") + " vs " + rev.id);
  ok("index.html has no unstamped local script or stylesheet",
    !/(?:src|href)="\.\/(?!favicon|apple-touch|manifest)[^"?]+\.(?:js|css)"/.test(indexHtml));
  ok("data.js records the same build id", new RegExp('QR_BUILD = "' + rev.id + '"').test(dataSrc));
  ok("rev.json counts the codes it actually shipped", rev.codes === shipped.length);
}

{
  // The build id is a hash of everything that ships. Recompute it: a hand-edit inside public/
  // would change a file without changing the id, and that is exactly the state in which the
  // deployed bytes stop being the reviewed bytes.
  const parts = ["index.html", "app.css", "app.js", "qr-art.js", "qrcode.js"]
    .map((f) => read(path.join(PUB, f)).replace(new RegExp("\\?v=" + rev.id, "g"), "?v=__BUILD__"));
  parts.splice(5, 0, read(path.join(REPO, "src", "app", "sw.js")));
  const dataBody = dataSrc.replace(/self\.QR_BUILD = "[^"]*";\n$/, "");
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p);
  h.update(dataBody);
  ok("the build id still hashes the files that are on disk", h.digest("hex").slice(0, 12) === rev.id,
    "run npm run build; something in public/ was changed by hand");
}

{
  const cs = shipped.map((c) => c.key);
  ok("no duplicate keys in the bundle", new Set(cs).size === cs.length);
  const ps = shipped.map((c) => c.payload);
  ok("no duplicate payloads in the bundle", new Set(ps).size === ps.length);
  ok("the bundle holds every account the master does", shipped.length === master.accounts.length);
}

/* --------------------------------------------------------------------- verdict */

console.log("\n" + (fail ? "FAILED: " : "ok: ") + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
