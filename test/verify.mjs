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
import { createCanvas, loadImage, Path2D } from "@napi-rs/canvas";

/* The DuitNow mark is drawn from the official SVG path data, which needs Path2D. Browsers have
 * it as a global; Node does not, so the headless canvas's implementation goes where the shipped
 * code looks for it. Nothing else in the renderer uses Path2D: the code's modules are filled
 * individually on purpose, and that is asserted separately. */
globalThis.Path2D = Path2D;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PUB = path.join(REPO, "public");
// The store lives in this repo since 8 Sep 2026; the laptop master is retired.
const STORE = path.join(REPO, "data", "accounts.json");

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

const master = JSON.parse(read(STORE));
const V = await import(pathToFileURL(path.join(REPO, "tools", "store.js")).href);
const rev = JSON.parse(read(path.join(PUB, "rev.json")));
const dataSrc = read(path.join(PUB, "data.js"));
const shipped = JSON.parse(dataSrc.match(/self\.QR_CODES = ([\s\S]*?);\nself\.QR_BUILD/)[1]);

/* CODES AND PLATES ARE NOT THE SAME THING, and section 1 must never be handed a plate.
 *
 * An account with no DuitNow code ships with an empty payload. Fed to the renderer anyway, the
 * encoder happily encodes the empty string, jsQR reads back "" and the assertion `got.data ===
 * c.payload` compares "" with "" and PASSES. Every decode assertion in section 1 would then be
 * vacuously true for that account, while claiming to have proved something about a code that
 * the app never draws for it. That is worse than no coverage, because the count goes up.
 *
 * So the rendering section walks `codes`, the bundle section still walks `shipped`, and the
 * plates get assertions of their own that say what should be true of them instead. */
const codes = shipped.filter((c) => c.payload);
const plates = shipped.filter((c) => !c.payload);
const indexHtml = read(path.join(PUB, "index.html"));
const swSrc = read(path.join(PUB, "sw.js"));

function classicScript(file, extra) {
  const scope = Object.assign({ location: { origin: "https://x" } }, extra || {});
  new Function("self", "window", read(file)).call(scope, scope, scope);
  return scope;
}
const qrcode = new Function("return (function(){" + read(path.join(PUB, "qrcode.js")) + "; return qrcode;})();")();
/* Path2D IS A BROWSER GLOBAL and the headless canvas does not install one, so it has to be
 * handed in. Without it drawMark() returns false and every traced mark silently draws nothing
 * while the layout still reserves its height: a neat empty gap, no error. That is exactly how
 * the first render of the marks came out. */
const QRArt = classicScript(path.join(PUB, "qr-art.js"), { qrcode, Path2D }).QRArt;
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
/* THE DOWNSCALE IS THE MEASUREMENT, and leaving it out quietly disabled this whole section.
 *
 * The backing store is never allowed below minDeviceFor(), which is around 530 pixels for a
 * typical code, so a canvas rendered for a 200px display is still a 530px buffer. Decoding that
 * buffer proves the buffer is big and nothing else: it succeeds at every requested size, so the
 * floor sweep below simply reported whichever size its loop started at, and the assertion that
 * safePhysicalPx still clears the floor was passing on a number it had not measured.
 *
 * Draw as the app draws, then scale to the size the glass would actually show, which is what a
 * camera sees. The dark ground behind it is the page's, so the surround is the real one too. */
function decode(c, physical, extra) {
  const canvas = createCanvas(8, 8);
  const meta = QRArt.draw(canvas, c.payload,
    Object.assign({ size: physical, pixelRatio: 1, brand: c.brand, label: c.name, seed: c.key }, extra || {}));
  const shown = createCanvas(physical, physical);
  const sg = shown.getContext("2d");
  sg.fillStyle = "#0a0d18";
  sg.fillRect(0, 0, physical, physical);
  sg.drawImage(canvas, 0, 0, physical, physical);
  const img = sg.getImageData(0, 0, physical, physical);
  const got = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  return { ok: !!got && got.data === c.payload, meta, got };
}

const SAFE = QRArt.DEFAULTS.safePhysicalPx;

{
  const sizes = [SAFE, 620, 700, 820, 1000, 1240];
  const bad = [];
  let n = 0;
  for (const c of codes) for (const px of sizes) {
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
  for (const c of codes) for (const px of [240, 300, 380, 460, SAFE - 1]) {
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
  for (const c of codes) {
    let floor = null, streak = 0;
    for (let px = 120; px <= 1000; px += 20) {
      if (decode(c, px, { safePhysicalPx: 0 }).ok) { if (!streak) floor = px; streak++; if (streak >= 6) break; }
      else { streak = 0; floor = null; }
    }
    if (floor === null) { worst = Infinity; who = c.key; break; }
    if (floor > worst) { worst = floor; who = c.key; }
  }
  ok("the safe size sits above the measured floor of the worst code (" + who + " reads from " +
     worst + "px, threshold " + SAFE + "px)", worst * 1.5 <= SAFE);
}

{
  const bad = [];
  for (const c of codes) for (const px of [240, 400, 700]) {
    if (!decode(c, px, { plain: true }).ok) bad.push(c.key + " at " + px);
  }
  ok("the plain fallback decodes for every code, down to 240px", bad.length === 0, bad.join(", "));
}

{
  const levels = {};
  for (const c of codes) {
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
      !/blob\(path,/.test(art) && !/newPath\(\)/.test(art));
  }

  ok("every code encodes at M, the level the master page and the printed card use " +
     "(" + JSON.stringify(levels) + ")", levels.M === codes.length);
}

{
  /* The image saved to the gallery. This one matters more than the on-screen coin: it is
   * scanned out of somebody else's photo library, often after a messaging app has recompressed
   * it, and there is nobody there to pinch and zoom if it will not read. */
  const bad = [];
  let minCoin = Infinity;
  for (const c of codes) {
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
  for (const c of codes) {
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
  const first = codes.map(shot);
  const again = codes.map(shot);
  ok("the same account draws the same coin every time", first.join() === again.join());
  ok("no two accounts share an outline and a colour", new Set(first).size === first.length);
  void opts;
}

{
  // The decoded string must be the payload byte for byte, not a normalised version of it.
  const c = codes[0];
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
  for (const c of codes) {
    const p = QRArt.palette(c.brand, QRArt.DEFAULTS.minContrast);
    if (p.contrast < worst) { worst = p.contrast; who = c.key; }
  }
  ok("ink clears the contrast floor against the field for every brand (worst " +
     worst.toFixed(1) + ":1 on " + who + ")", worst >= QRArt.DEFAULTS.minContrast);
}

{
  // The floor that makes the decode stable at small display sizes must actually be enforced.
  let bad = [];
  for (const c of codes) {
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
  for (const c of codes) {
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
  for (const c of codes) {
    const canvas = createCanvas(8, 8);
    const meta = QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    // Where the renderer says it drew, not where the canvas width implies. The lens holds
    // the disc back from the edge, and re-deriving this was what broke when it landed.
    const geo = meta.grid;
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
  for (const c of codes) {
    const canvas = createCanvas(8, 8);
    const meta = QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    // Where the renderer says it drew, not where the canvas width implies. The lens holds
    // the disc back from the edge, and re-deriving this was what broke when it landed.
    const geo = meta.grid;
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
  for (const c of codes) {
    const canvas = createCanvas(8, 8);
    const meta = QRArt.draw(canvas, c.payload, { size: 420, pixelRatio: 2, brand: c.brand, label: c.name, seed: c.key });
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    // Where the renderer says it drew, not where the canvas width implies. The lens holds
    // the disc back from the edge, and re-deriving this was what broke when it landed.
    const geo = meta.grid;
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
  for (const c of codes) {
    const p = QRArt.plan(c.payload, Object.assign({}, QRArt.DEFAULTS, { encoder: qrcode }));
    levels[p.ecl] = (levels[p.ecl] || 0) + 1;
    if (p.n > QRArt.DEFAULTS.maxModules) levels.OVER = (levels.OVER || 0) + 1;
  }
  ok("no code exceeds the module cap (" + JSON.stringify(levels) + ")", !levels.OVER);
}

/* ================================================== 2. nothing private shipped */

{
  /* THE LENS. Its whole claim is that it is free: the light bent around the disc lives outside
   * the code, so it cannot cost a scan. That claim is only worth having if it is checked. */
  const art = read(path.join(REPO, "src", "app", "qr-art.js"));

  ok("the lens is on by default and its scale is a stated number",
    QRArt.DEFAULTS.lens === true && QRArt.DEFAULTS.lensScale > 0.6 && QRArt.DEFAULTS.lensScale < 1);

  /* NOTHING IS PAINTED OVER THE FIELD. The rim glow is the one piece drawn after the coin, and
   * it must be clipped out of the light disc: an unclipped glow washes the outer modules and
   * the contrast palette() measured stops being the contrast that is there. */
  ok("the rim glow is clipped clear of the light field",
    /function lensRim\(/.test(art) &&
    /g\.arc\(R, R, geo\.Rd, 0, Math\.PI \* 2\);\s*\n\s*g\.clip\("evenodd"\);/.test(art));
  ok("the arcs and the Einstein ring are drawn behind the coin, never over it",
    art.indexOf("function lensBehind(") > 0 &&
    /lensBehind\(g, device, coinPx, pal, opts\);[\s\S]{0,200}?drawCoin\(g, p, coinPx, pal, lopts\);/.test(art));

  /* THE CANVAS STAYS TRANSPARENT. The coin's shadow is cast from its alpha by drop-shadow, so
   * an opaque backdrop here would put a hard square shadow behind a round object. The dark of
   * space is the page's job. Measured at the corners, which must be untouched. */
  {
    const c = createCanvas(8, 8);
    QRArt.draw(c, codes[0].payload, { size: 700, pixelRatio: 1, brand: codes[0].brand,
      label: codes[0].name, seed: codes[0].key });
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const alphaAt = (x, y) => d[(y * c.width + x) * 4 + 3];
    ok("the canvas is transparent at its corners, so the shadow follows the coin and not a box",
      alphaAt(1, 1) === 0 && alphaAt(c.width - 2, 1) === 0 && alphaAt(1, c.height - 2) === 0);
  }

  /* THE SKY IS THE PROVIDER'S SIGNATURE, and it has to be the same sky every time or the
   * thumbnail and the full-size render would disagree and the zoom would stop being one object
   * moving. No Math.random anywhere in the renderer; the arcs come from the key. */
  ok("nothing in the renderer is random, so an account draws the same every time",
    // A CALL, not the words: the comment above randOf() names Math.random to say it is not
    // used, and matching that would make this assertion pass by accident either way.
    !new RegExp('Math' + String.fromCharCode(92) + '.random\\s*\\(').test(art) &&
    /function randOf\(seed\)/.test(art));
  {
    const c1 = createCanvas(8, 8), c2 = createCanvas(8, 8), c3 = createCanvas(8, 8);
    const o = (a) => ({ size: 700, pixelRatio: 1, brand: a.brand, label: a.name, seed: a.key });
    QRArt.draw(c1, codes[0].payload, o(codes[0]));
    QRArt.draw(c2, codes[0].payload, o(codes[0]));
    QRArt.draw(c3, codes[1].payload, o(codes[1]));
    const px = (c) => Buffer.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);
    ok("the same account draws pixel for pixel the same coin twice", px(c1).equals(px(c2)));
    ok("two accounts get different skies", !px(c1).equals(px(c3)) || codes[0].brand !== codes[1].brand);
  }
}

{
  /* UNDER MAINTENANCE, AND THE ONLY THING THAT MATTERS IS THAT NO CODE IS DRAWN.
   *
   * An account is marked while it is being changed on the laptop, so the payload on the phone
   * may already be the wrong one, and a wrong DuitNow code still scans and still pays, just to
   * somebody else. Dimming a code would not do; the code must not exist on the canvas. A coin
   * drawn and then covered by a panel is a screenshot away from being scanned, and the panel is
   * a stylesheet away from not being there. */
  const appJsSrc = read(path.join(REPO, "src", "app", "app.js"));
  /* ONE READING, AND THE PRECEDENCE IS THE POINT. The KV override is consulted first so a
   * suspension reaches the phone without a deploy; where it says nothing, the flag baked
   * into the bundle stands. The bake is the fail-safe, the override the fast path. */
  ok("the flag is read in one place, and only a real boolean counts",
    /function down\(a\)/.test(appJsSrc) &&
    /return a\.maintenance === true;/.test(appJsSrc) &&
    /override\.maintenance\[a\.key\] === true/.test(appJsSrc));
  ok("a failed or malformed state read leaves the previous state alone",
    /\.then\(done, function \(\) { return done\(false\); \}\);/.test(appJsSrc) &&
    /if \(!j \|\| typeof j !== "object"\) return null;/.test(appJsSrc) &&
    /if \(!next\) return false;/.test(appJsSrc));
  ok("only booleans against known account keys are trusted from the wire, and only known keys in the order",
    /typeof m\[k\] === "boolean"/.test(appJsSrc) &&
    /if \(known\[key\] && next\.order\.indexOf\(key\) < 0\) next\.order\.push\(key\);/.test(appJsSrc));
  /* THE PHONE REMEMBERS. Nothing deploys a fresh bake behind a change any more, so the last
   * state read is stored and restored before the first frame; the bundle's flag is only what a
   * phone knows on its very first open. */
  ok("the last good state is stored on the phone and restored before the grid is built",
    /localStorage\.setItem\(STORE_KEY/.test(appJsSrc) &&
    /rememberedState\(\);[\s\S]{0,120}?buildGrid\(\);/.test(appJsSrc));
  ok("the state file is fetched no-store and never precached, and nor is the edit surface",
    /fetch\("state\.json", { cache: "no-store"/.test(appJsSrc) &&
    (function () {
      const sw = read(path.join(REPO, "src", "app", "sw.js"));
      return /url\.pathname === "\/state\.json" \|\| url\.pathname === "\/rev\.json" \|\| url\.pathname === "\/admin" \|\|\s*url\.pathname\.startsWith\("\/admin\/"\) \|\| url\.pathname\.startsWith\("\/api\/"\)\) return;/.test(sw);
    })());
  /* THE PAGE FOLLOWS THE BUILD (owner, 15 Sep 2026). A page left open kept the old script until
   * it was closed; now it compares its build id with the served rev.json on every return to the
   * front and reloads once when they differ. The id is remembered before the reload, so a
   * disagreement can never loop. */
  ok("an open page reloads itself once when a newer build is served",
    /function followBuild\(\)/.test(appJsSrc) &&
    /fetch\("rev\.json", \{ cache: "no-store"/.test(appJsSrc) &&
    /if \(recall\("reloaded"\) === j\.id\) return;[\s\S]{0,80}?remember\("reloaded", j\.id\);[\s\S]{0,40}?location\.reload\(\);/.test(appJsSrc) &&
    /document\.addEventListener\("visibilitychange", function \(\) \{[\s\S]{0,160}?read\(\);\s*followBuild\(\);/.test(appJsSrc));
  /* ONE WRITE, AND IT IS INSIDE THE GATE. The Worker puts to the namespace in exactly one place,
   * after identity() has answered, and reads it in exactly one. */
  ok("the Worker writes the namespace once, behind the token check, and answers {} when it cannot read",
    (function () {
      const w = read(path.join(REPO, "src", "worker.js"));
      const puts = w.match(/QR_STATE\.put\(/g) || [];
      return /env\.QR_STATE\.get\("state"\)/.test(w) && puts.length === 1 &&
             /const who = await identity\(request, env\);\s*if \(!who\) \{[\s\S]*?QR_STATE\.put\(/.test(w) &&
             !/QR_STATE\.(?:delete|list)/.test(w) && /body = "{}";/.test(w);
    })());
  ok("the build normalises the flag rather than shipping whatever the master had",
    /rec\.maintenance = a\.maintenance === true;/.test(read(path.join(REPO, "tools", "build.mjs"))));
  ok("a suspended account is cleared off the canvas, not merely covered",
    /if \(down\(a\)\) \{[\s\S]{0,400}?elCoin\.width = 8; elCoin\.height = 8;/.test(appJsSrc));
  ok("nothing is pre-rendered for a suspended account either",
    /function prerender\(i\) \{[\s\S]{0,120}?if \(down\(CODES\[i\]\) \|\| viewOf\(CODES\[i\]\) !== "qr"\) return null;/.test(appJsSrc));
  /* THE MINIATURE IS CLEARED, NOT MERELY SKIPPED, and the difference is a live bug.
   *
   * This used to assert `if (down(a)) continue;`, which is correct only on the first pass, when
   * nothing has been painted yet. drawThumbs also runs when /state.json changes what is
   * suspended, and there `continue` leaves whatever is already on the canvas: an account baked
   * LIVE and then suspended from the laptop went grey and sank to the bottom with its code
   * still drawn on the tile. Seen on the live phone on 3 Sep 2026, GX Bank, class "tile down"
   * with .tiledot.drawn. The old assertion passed throughout, because it was pinning the shape
   * of the fault. */
  ok("a suspended account's miniature is CLEARED, not merely skipped",
    /function drawThumbs\(\)[\s\S]{0,1200}?if \(down\(a\)\) \{[\s\S]{0,240}?el\.width = 8; el\.height = 8;[\s\S]{0,240}?el\.classList\.remove\("drawn"\);/
      .test(appJsSrc));
  ok("and the clear happens before the renderer is ever asked for that account",
    (() => {
      const body = (appJsSrc.match(/function drawThumbs\(\)[\s\S]*?\n  \}/) || [""])[0];
      return body.indexOf("el.width = 8") > 0 &&
             body.indexOf("el.width = 8") < body.indexOf("paintFace(");
    })());
  ok("saving and copying are both refused while suspended",
    (appJsSrc.match(/if \(down\(a\)\) \{ say\("Under maintenance"\); return; \}/g) || []).length === 2);

  // And the same in the pixels, which is the assertion that would survive all of the above being
  // rewritten: the shipped bundle must mark it, and the renderer must never be asked for it.
  const susp = shipped.filter((c) => c.maintenance === true);
  ok("the bundle marks exactly the accounts the master suspended",
    susp.length === master.accounts.filter((a) => a.maintenance === true).length,
    susp.map((c) => c.key).join(", ") || "none");
  ok("every record carries the flag as a boolean, never absent and never a string",
    shipped.every((c) => typeof c.maintenance === "boolean"));
}

section("2. The bundle carries the codes and nothing else");

{
  const banned = /\.(md|pdf|py|pyc|pem|key|bak|zip|log|env)$/i;
  const offenders = files.filter((f) => banned.test(f) ||
    /(^|\/)(backups|__pycache__|node_modules|\.git)(\/|$)/.test(rel(f)));
  ok("public/ holds no docs, PDFs, scripts, backups or caches", offenders.length === 0, offenders.map(rel).join(", "));
}

{
  // `biller` and `ref1` added 4 Sep 2026 for JomPAY. Widening this list is the deliberate act
  // rule 4 describes: it happens here and in build.mjs's SHIP, in the open, or not at all.
  const SHIP = ["acct", "bank", "bankMark", "biller", "brand", "holder", "holderMark", "key",
                "maintenance", "name", "payload", "ref1", "ring", "tag"];
  const wrong = shipped.filter((c) => Object.keys(c).sort().join() !== SHIP.join());
  ok("every shipped record has exactly " + SHIP.join(", ") + " and nothing else",
    wrong.length === 0,
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
  /* `sub` is NOT on this list any more. The account numbers ship deliberately, as `acct`, for
   * the back of the coin: see the note on SHIP in tools/build.mjs. Everything else the master
   * holds still has to stay behind, and the assertion after this one checks the other
   * direction, so the feature cannot quietly disappear either. */
  add(master.payee);
  (master.owners || []).forEach((o) => { add(o && o.name); add(o && o.legal); });
  master.accounts.forEach((a) => { add(a.mid); });

  /* `filter(Boolean)` IS LOAD-BEARING, not tidiness. An account with no code ships an empty
   * payload, and `body.split("")` splits a string into its individual characters, so a single
   * empty entry here would blow every file apart into " PAYLOAD "-separated letters and leave
   * the leak search looking at rubble. It would not fail loudly; it would simply stop finding
   * anything, which is the worst way for a guard to break. */
  const payloads = shipped.map((c) => c.payload).filter(Boolean).sort((a, b) => b.length - a.length);
  const holderNames = [...new Set(plates.map((c) => c.holder).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const hits = [];
  for (const f of files) {
    if (!/\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f)) continue;
    let body = read(f);
    for (const p of payloads) body = body.split(p).join(" PAYLOAD ");
    /* THE SANCTIONED NAME IS STRIPPED, NOT EXEMPTED, exactly as the build does it. An account
     * with no code has to print the holder, so its name reaches data.js on purpose. Dropping
     * the payee from the forbidden set instead would switch off the check that stopped a
     * truncated slug of it from becoming this site's public URL. The expected occurrences are
     * counted and pinned by their own assertion below; what remains here is everything else,
     * and a slug is not the same bytes as the name, so it is never stripped by this. */
    for (const h of holderNames) body = body.split(h).join(" HOLDER ");
    const hay = body.toLowerCase();
    for (const s of secret) if (hay.includes(s.toLowerCase())) hits.push(rel(f) + " <- " + s.length + " chars");
  }
  ok("no dropped value appears anywhere in public/ outside a payload", hits.length === 0, [...new Set(hits)].join("\n        "));

  // And the other direction: every account number IS in the bundle, exactly as the master
  // has it, because that is now a feature and a silent loss of it would be a regression.
  const missingAcct = master.accounts.filter((a) => {
    const c = shipped.find((x) => x.key === a.key);
    return !c || c.acct !== String(a.sub || "").trim();
  });
  ok("every account number ships, matching the master exactly", missingAcct.length === 0,
    missingAcct.map((a) => a.key).join(", "));

  /* A NAME ALSO TRAVELS AS A SLUG, and the exact-match sweep above cannot see that. The master
   * once keyed an account `muhammad-afif-akmal-bin`, a truncated lowercase slug of the payee,
   * and it passed every check here and in the build because it matched no forbidden string byte
   * for byte. It would have become the public URL of the page. Compare stems instead: strip
   * everything that is not a letter or a digit from both sides, and look for the first twelve
   * characters of the name. */
  const stem = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const stems = [master.payee, ...(master.owners || []).flatMap((o) => [o && o.name, o && o.legal])]
    .map(stem).filter((s) => s.length === 12);
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const slugHits = [];
  for (const f of files) {
    if (!/\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f)) continue;
    let body = read(f);
    for (const p of payloads) body = body.split(p).join(" PAYLOAD ");
    /* THE SANCTIONED NAME IS STRIPPED, NOT EXEMPTED, exactly as the build does it. An account
     * with no code has to print the holder, so its name reaches data.js on purpose. Dropping
     * the payee from the forbidden set instead would switch off the check that stopped a
     * truncated slug of it from becoming this site's public URL. The expected occurrences are
     * counted and pinned by their own assertion below; what remains here is everything else,
     * and a slug is not the same bytes as the name, so it is never stripped by this. */
    for (const h of holderNames) body = body.split(h).join(" HOLDER ");
    const flat = squash(body);
    for (const s of stems) if (flat.includes(s)) slugHits.push(rel(f) + " <- " + JSON.stringify(s));
  }
  ok("no slugged form of a person's name appears in public/ outside a payload",
    slugHits.length === 0, [...new Set(slugHits)].join("\n        "));

  // The stem sweep is only worth anything if it would actually catch one. Feed it the slug the
  // master really produced, and it must be found.
  ok("the stem sweep catches the slug that got through once",
    stems.length > 0 && stems.some((s) => squash("key: muhammad-afif-akmal-bin,").includes(s)));

  // And the build refuses it rather than merely reporting it, so a bad key cannot reach public/.
  const buildTxt = read(path.join(REPO, "tools", "build.mjs"));
  ok("tools/build.mjs runs the same stem check and dies on a hit",
    /function nameStems\(doc\)/.test(buildTxt) && /const STEM = 12;/.test(buildTxt) &&
    /for \(const stem of stems\) \{[\s\S]{0,120}?squashed\.includes\(stem\)[\s\S]{0,80}?die\(/.test(buildTxt));
}

{
  // The counterpart, and the honest half of it: the name IS inside the codes, and that is a
  // property of DuitNow, not of this site. Assert it, so the fact stays visible in the suite
  // rather than being quietly forgotten the next time somebody reads the check above.
  const name = String(master.payee || "").trim().toUpperCase().slice(0, 12);
  const inside = codes.filter((c) => c.payload.toUpperCase().includes(name)).length;
  ok("recorded: the account-holder name is inside " + inside + " of " + codes.length +
     " payloads and cannot be removed without breaking payment", inside > 0);
}

{
  const bad = [];
  for (const c of shipped) {
    const src = master.accounts.find((a) => a.key === c.key);
    if (!src) { bad.push(c.key + " is not in the master"); continue; }
    /* An account with no code carries an empty payload BY CONSTRUCTION, normalised by the build
     * so the field is never absent. The master's payload rules apply to the accounts that have
     * a payload, and to those only; an empty one is checked against the master being empty too,
     * so a payload cannot be silently dropped on the way through either. */
    if (String(src.payload || "") !== c.payload) bad.push(c.key + " payload differs from the master");
    if (c.payload && V.payloadError(c.payload)) bad.push(c.key + ": " + V.payloadError(c.payload));
  }
  ok("every payload is byte-identical to the master and passes the master's own validator",
    bad.length === 0, bad.join("; "));
}

{
  // Proof that the validator above is live rather than a function that returns null. Flip one
  // character of a copy and it must be refused.
  const p = codes[0].payload;
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
    /document\.body\.className = "view-list fresh";/.test(appJs) &&
    /body\.view-list \.accounts,/.test(cssCode));

  /* BOTH VIEWS ARE ALWAYS LAID OUT and cross-faded. A display swap cannot be animated, so the
   * list used to vanish in one frame while the coin was still flying, which reads as a glitch;
   * and an element inside a display:none view reports a zero rect, which silently cancelled the
   * zoom. Neither can happen once both views are permanently in layout. */
  ok("the two views are cross-faded, never switched with display",
    !/\.accounts,\.codeview\{display:none;\}/.test(cssCode) &&
    /\.accounts,\.codeview\{[\s\S]*?position:fixed;/.test(cssCode) &&
    /transition:opacity var\(--dur\) var\(--ease\), visibility/.test(cssCode));

  ok("every account is a named tile on that first screen",
    /id="grid"/.test(indexHtml) && /b\.className = classOf\(a\);/.test(appJs) &&
    /tiletext/.test(appJs));

  /* ONE PLACE DECIDES A TILE'S CLASSES. There were two, and they disagreed: the KV watcher
   * rebuilt the string from scratch and dropped `wide`, so a suspension arriving from the laptop
   * collapsed the featured account's full-width row. Both callers go through classOf now. */
  ok("a tile's classes are built in one place, so a state change cannot drop one",
    /function classOf\(a\) \{\s*return "tile" \+ \(down\(a\) \? " down" : ""\);/.test(appJs) &&
    !/tiles\[i\]\.className = down\(/.test(appJs));

  /* SUSPENDED ACCOUNTS SINK, AT RUNTIME. It cannot be the master's order: /state.json suspends
   * an account in seconds with no deploy, so a baked order would leave it among the live ones
   * until the next release. The tiles are MOVED rather than rebuilt, so tiles[i] stays aligned
   * with CODES[i] and every index the app holds keeps its meaning. */
  ok("suspended accounts are sorted to the end, and re-sorted when the state changes",
    /function orderTiles\(\)/.test(appJs) &&
    /\(down\(CODES\[placed\[p\]\]\) \? held : live\)\.push\(placed\[p\]\)/.test(appJs) &&
    /orderTiles\(\);[\s\S]{0,900}?if \(idx >= 0\) paint\(\);/.test(appJs));
  /* THE ARRANGEMENT COMES FROM THE STATE, and every account still appears: keys the state
   * names first, in its order, then the rest in build order, so a newly added account shows
   * up at the end rather than nowhere. */
  ok("the tile order follows the state's order, and unlisted accounts follow in build order",
    /var want = override \? override\.order : \[\];/.test(appJs) &&
    /for \(var r = 0; r < tiles\.length; r\+\+\) if \(!seen\[r\]\) placed\.push\(r\);/.test(appJs));
  /* A STATE CHANGE MUST REDRAW THE MINIATURES TOO. Re-classing a tile greys it and moving it
   * sinks it; neither takes the code off it. This is the other half of the 3 Sep bug: the
   * watcher did everything except the one thing that removes the picture. */
  ok("a state change redraws the miniatures, not just the classes and the order",
    /orderTiles\(\);[\s\S]{0,900}?drawThumbs\(\);[\s\S]{0,200}?if \(idx >= 0\) paint\(\);/.test(appJs));
  /* The stagger counts VISIBLE tiles, which is stricter than "display order" and had to become
   * so once a rail filter could hide some. Numbered over all fourteen, a filter showing one
   * account would deal it in on the fourteenth beat and read as the app having hung. */
  ok("the deal-in stagger follows the visible order, not the build order",
    /setProperty\("--i", String\(shown\+\+\)\)/.test(appJs));
  ok("and a filtered-out tile is hidden rather than the grid being rebuilt, so tiles[i] still " +
     "means CODES[i]",
    /el\.hidden = !on;/.test(appJs) && !/elGrid\.textContent = ""/.test(appJs));

  /* NO ACCOUNT IS FEATURED (owner, 14 Sep 2026): one column of rows, every row alike, named as
   * the DuitNow list names the institution, and a tag is a sub-line telling two accounts at one
   * institution apart. */
  ok("every account is one row alike, named after its institution, and a tag is a sub-line",
    !/ wide/.test(appJs) && !/\.tile\.wide\{/.test(cssCode) &&
    /tx\.textContent = a\.bank \|\| a\.name;/.test(appJs) &&
    /tg\.className = "tiletag"/.test(appJs) &&
    /grid-template-columns:1fr;/.test(cssCode));
  /* THE RAIL IS A MODE. It filters the list and decides what an opened account shows, it is
   * remembered, and an account reached by hash that is not on the current rail falls back to
   * the first rail it is on. Steps walk the visible order, so a swipe stays on the rail. */
  ok("the rail is remembered, and decides the view of an opened account",
    /var rail = railOf\(recall\("rail"\)\)\.id;/.test(appJs) &&
    /remember\("rail", id\);/.test(appJs) &&
    /function viewOf\(a\) \{\s*if \(onRail\(a, rail\)\) return rail;/.test(appJs) &&
    /document\.body\.setAttribute\("data-view", v\);/.test(appJs) &&
    !/id: "all"/.test(appJs));
  ok("the code miniatures appear on the QR rail only; elsewhere a row wears an initials badge",
    /if \(rail === "qr"\) \{[\s\S]{0,200}?paintFace\(el[\s\S]{0,300}?drawBadge\(el, a\);/.test(appJs) &&
    /function initialsOf\(name\)/.test(appJs) && /function drawBadge\(el, a\)/.test(appJs) &&
    /remember\("rail", id\);[\s\S]{0,600}?orderTiles\(\);\s*drawThumbs\(\);/.test(appJs));
  ok("a step walks the visible order, never the build order",
    /shownOrder\.push\(order\[k\]\)/.test(appJs) &&
    /var i = shownOrder\[\(pos \+ dir \+ shownOrder\.length\) % shownOrder\.length\];/.test(appJs));
  ok("a code has an explicit way back to the accounts",
    /id="back"/.test(indexHtml) && /elBack\.addEventListener\("click", close\)/.test(appJs));

  /* THE HASH IS THE ONLY STATE. Reading history.state to decide what to draw was a real bug:
   * after a reload that state is stale, so Accounts called history.back() and landed on
   * whatever entry happened to be behind, which could be another code. `depth` counts only the
   * entries this page session pushed, so back either unwinds one of ours or rewrites the hash
   * in place, and can never walk off into somebody else's history. */
  ok("the two views are addressed by the hash, so back and a home-screen link both work",
    /function route\(pre\)/.test(appJs) && /popstate/.test(appJs) && /history\.pushState/.test(appJs));
  ok("nothing reads history.state to decide what to draw",
    !/history\.state\s*&&/.test(appJs) && /if \(depth > 0\) \{ depth--; history\.back\(\); \}/.test(appJs));
  ok("stepping between codes replaces rather than pushes, so back is never a walk backwards " +
     "through everything swiped past", /history\.replaceState\(history\.state/.test(appJs));
  ok("nothing scrolls sideways any more",
    !/overflow-x:auto/.test(cssCode) && !/id="dots"/.test(indexHtml));

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
    /pointerdown/.test(appJs) &&
    /held = true;[\s\S]{0,200}?save\(\);/.test(appJs));
  ok("a tap does the same as the hold",
    /if \(swiped\) \{ swiped = false; return; }[\s\S]{0,80}?save\(\);/.test(appJs));

  /* BOTH FACES NAME THEIR OWN TAP. The reverse always said "Tap to copy" and the code side
   * said nothing, so the same gesture read as a feature on one face and a secret on the
   * other. The label is held open rather than timed out, because it describes what is on
   * screen rather than reporting something that just happened. */
  ok("the view says what a tap does, and the label does not time out",
    /say\(viewOf\(a\) !== "qr" \? "Tap a value to copy" : dueRows\(a\)\.length \? "Tap the code to save, a value to copy" : "Tap to save", false\);/.test(appJs) &&
    /if \(msg && hold !== false\)/.test(appJs));
  ok("a hold does not then also fire the tap, so one press never saves twice",
    /if \(held\)/.test(appJs));
  /* The coin's shadow is cast from its ALPHA, not from a box around it.
   *
   * The button is a circle; the coin inside it is scalloped, so more than a third of the
   * samples around its rim are transparent. A box-shadow therefore showed straight through
   * those valleys as a hard dark ring behind the coin, and it appeared at the end of the zoom
   * because that is when the coin, and with it its shadow, was revealed. drop-shadow follows
   * the alpha and so follows the scallops. */
  // A box-shadow with an actual value, not the `box-shadow:none` that the forced-colours block
  // uses to take it away.
  const paintsAShadow = (sel) =>
    new RegExp(sel + "[^{]*\{[^}]*box-shadow\s*:\s*(?!none)").test(cssCode);
  /* The drop-shadow sits on the BUTTON, not on either face. A filter forces transform-style
   * back to flat on the element carrying it, so a filter on a face would collapse the 3D flip
   * and show both sides of the coin at once. On the button it still follows the alpha of
   * whichever face is in front, which is the whole point of using drop-shadow. */
  ok("the coin's shadow follows its scalloped edge rather than a circle around it",
    /\.coinbtn\{\s*filter:drop-shadow/.test(cssCode) && !paintsAShadow("\.coinbtn"));
  ok("no filter sits on a rotating face, which would flatten the flip",
    !/\.face\{[^}]*filter:/.test(cssCode) && !/\.faces\{[^}]*filter:/.test(cssCode));
  ok("no element behind a scalloped coin paints a circle the valleys can expose",
    !paintsAShadow("\.coinbtn") && !paintsAShadow("\.tiledot"));
  ok("the coin still presses in under a finger", /\.coinbtn:active\{/.test(cssCode));

  /* ONE FACE, AND THE NUMBER IS NEVER ON SCREEN.
   *
   * The coin used to turn over to a reverse carrying PayNet's brand graphic and the account
   * number, so copying the number meant displaying it first. "Copy account number" puts it
   * straight on the clipboard, which removed the only reason to turn the coin over, and the
   * reverse went with it: the second canvas, the preserve-3d wrapper, drawBack, drawMark and
   * the vendored artwork. Owner's decision, 25 Aug 2026.
   *
   * These assert the removal is complete rather than half-done, because a half-removed flip is
   * a coin that can be rotated to a blank face. */
  ok("the coin has one face and no flip",
    /id="coin" class="coin"/.test(indexHtml) &&
    !/coinback/.test(indexHtml) &&
    !/transform-style:preserve-3d/.test(cssCode) &&
    !/backface-visibility/.test(cssCode) &&
    !/\.flipped/.test(cssCode));
  ok("nothing in the app still reaches for a reverse or a flip",
    !/drawBack|paintBack|setFlipped|flipped/.test(appJs));

  /* PAYNET'S ARTWORK IS GONE FROM THE BUNDLE, not merely unused. It is their trademark, its use
   * is governed by their guidelines, and a copy of it shipped to every phone that nothing draws
   * is a compliance surface with no benefit whatever. The generator went too. */
  ok("PayNet's mark is not shipped, and nothing left behind can draw one",
    !fs.existsSync(path.join(PUB, "duitnow-mark.js")) &&
    !fs.existsSync(path.join(REPO, "src", "vendor", "duitnow-mark.js")) &&
    !fs.existsSync(path.join(REPO, "tools", "mark.mjs")) &&
    // Comments stripped: the note explaining WHY the mark went names it, and a guard that
    // trips on its own explanation is a guard nobody can document.
    !/DuitNowMark|duitnow-mark|duitnow/i.test(
      read(path.join(PUB, "qr-art.js")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) &&
    !/duitnow-mark/.test(indexHtml));

  /* THE NUMBER IS ON SCREEN, ON THE TRANSFER VIEW ONLY (owner, 14 Sep 2026, reversing 25 Aug).
   * A plate of the bank's name and the number, and on JomPAY the biller code, Ref-1 and a Ref-2
   * shown as a dash; each value copies on a tap. The QR view shows the coin, and under it only what a
   * payer's link carried (below). It is still
   * written to the DOM from the record, never drawn onto a canvas, so the renderer stays clean. */
  ok("the Transfer view shows the bank and the number, and JomPAY the biller code and both references",
    /id="plate"/.test(indexHtml) &&
    /function fillPlate\(a, v\)/.test(appJs) &&
    /\["Bank", a\.bank\], \["Account", spaced\(a\.acct\), "account number"\]/.test(appJs) &&
    /\["Biller code", a\.biller, "biller code"\], \["Ref-1", a\.ref1, "Ref-1"\], \["Ref-2", "-"\]/.test(appJs) &&
    /copyValue\(r\[3\] \|\| r\[1\], r\[2\]\)/.test(appJs));
  ok("the QR view is the coin alone, and the other views have no coin",
    /body\[data-view="qr"\] \.plate\{display:none;\}/.test(cssCode) &&
    /body:not\(\[data-view="qr"\]\) \.coinbtn\{display:none;\}/.test(cssCode) &&
    !/copybtn|jompaybtn/.test(indexHtml) &&
    /if \(v !== "qr"\) \{[\s\S]{0,400}?elCoin\.width = 8;[\s\S]{0,200}?fillPlate\(a, v\);/.test(appJs));
  ok("a suspended account shows neither a code nor a number, and refuses to copy",
    /document\.body\.classList\.add\("maintenance"\);/.test(appJs) &&
    /if \(down\(a\)\) \{[\s\S]{0,600}?elPlate\.textContent = "";/.test(appJs) &&
    /if \(down\(a\)\) \{ say\("Under maintenance"\); return; }/.test(appJs));

  /* SALT-COMMAND LIFTS THIS PARSER BY TEXT (26 Sep 2026; CLAUDE.md, the payer's link). Its suite
   * reads public/app.js in this checkout, cuts out `function linkOf(` by brace count and the RAILS
   * block by the pattern below, and runs the two alone to read back every link its payHref writes.
   * Done here the same way, first and by name: the lifts further down throw rather than fail when
   * that shape goes, and over there it would be a red suite in another repo. */
  {
    let back;
    try {
      const at = appJs.indexOf("function linkOf(");
      const rails = (/var RAILS = \[[\s\S]*?\n  \];/.exec(appJs) || [""])[0];
      if (at < 0 || !rails) throw new Error(at < 0 ? "no function linkOf(" : "no var RAILS block closing on its own '  ];' line");
      let d = 0, j = appJs.indexOf("{", at);
      for (; j >= 0 && j < appJs.length; j++) { if (appJs[j] === "{") d++; else if (appJs[j] === "}" && --d === 0) break; }
      const lifted = new Function(rails + "\n" + appJs.slice(at, j + 1) + "\nreturn linkOf;")();
      back = ["#m/transfer/70.00/k7m2-p9qr", "#m/qr/215.50/0000-0000", "#m/qr/999999.99/k7m2-p9qr"].map((h) => lifted(h));
    } catch (e) { back = String(e && e.message); }
    ok("salt-command can lift linkOf and RAILS out of public/app.js by text and read back what its payHref writes",
      JSON.stringify(back) === JSON.stringify([
        { key: "m", rail: "transfer", amount: "70.00", ref: "k7m2-p9qr" },
        { key: "m", rail: "qr", amount: "215.50", ref: "0000-0000" },
        { key: "m", rail: "qr", amount: "999999.99", ref: "k7m2-p9qr" }]),
      "keep both in their present shape, linkOf needing nothing but RAILS: " + JSON.stringify(back));
  }

  /* THE PAYER'S LINK (24 Sep 2026, the Counter's pay sheet): #<key>/<rail>/<amount>/<reference>.
   * Driven, not read: the shipped functions are lifted out of app.js by name and run against
   * stubs, so a check can fail only if the behaviour does. */
  {
    const fnSrc = (name) => {
      const i = appJs.indexOf("function " + name + "(");
      if (i < 0) return "";
      let d = 0, j = appJs.indexOf("{", i);
      for (; j < appJs.length; j++) { if (appJs[j] === "{") d++; else if (appJs[j] === "}" && --d === 0) break; }
      return appJs.slice(i, j + 1);
    };
    const railsSrc = (/var RAILS = \[[\s\S]*?\n  \];/.exec(appJs) || [""])[0];
    const lift = (names, args, ret) => new Function(...args, railsSrc + "\n" + names.map(fnSrc).join("\n") + "\nreturn " + ret + ";");
    const linkOf = lift(["linkOf"], [], "linkOf")();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    ok("a link names the account, the rail, the amount to the sen and the reference",
      same(linkOf("#maybank/transfer/70/k7m2-p9qr"), { key: "maybank", rail: "transfer", amount: "70.00", ref: "k7m2-p9qr" }) &&
      same(linkOf("#gx/qr/215.5/0000-0000"), { key: "gx", rail: "qr", amount: "215.50", ref: "0000-0000" }) &&
      same(linkOf("#maybank"), { key: "maybank", rail: "", amount: "", ref: "" }) && linkOf("").key === "");
    ok("a part that fails its check is dropped, never repaired, so a crafted link shows only what a genuine one could",
      same(linkOf("#maybank/all/70abc/Send%20it%20to%20another%20account"), { key: "maybank", rail: "", amount: "", ref: "" }) &&
      linkOf("#maybank/qr/0/x").amount === "" && linkOf("#maybank/qr/1234567/x").amount === "" &&
      linkOf("#maybank/qr/1.005/x").amount === "" && linkOf("#maybank/qr/-5/x").amount === "" &&
      linkOf("#maybank/qr/5/" + "a".repeat(21)).ref === "" && linkOf("#maybank/qr/5/a%3Cb").ref === "" &&
      linkOf("#%E0%A4%A/qr").key === "" && linkOf("#maybank/%E0/5/x").rail === "");

    // fillDue against a stub page: what it would show, and what a tap copies.
    const mk = () => ({ kids: [], hidden: true, appendChild(c) { this.kids.push(c); }, addEventListener(t, f) { this.tap = f; } });
    const drive = (hash, a, isDown) => {
      const elDue = mk(), elGoBack = mk(), copied = [];
      Object.defineProperty(elDue, "textContent", { set() { this.kids = []; }, get() { return ""; } });
      const fill = lift(["linkOf", "dueRows", "fillRows", "fillDue"], ["location", "document", "elDue", "elGoBack", "down", "copyValue"], "fillDue")(
        { hash }, { createElement: mk }, elDue, elGoBack, () => !!isDown, (v, what) => copied.push([v, what]));
      fill(a);
      elDue.kids.forEach((k) => k.tap && k.tap());
      return { hidden: elDue.hidden, paid: elGoBack.hidden, rows: elDue.kids.map((k) => k.kids.map((s) => s.textContent)), copied };
    };
    const on = drive("#maybank/transfer/70/k7m2-p9qr", { key: "maybank" });
    ok("the amount and the reference show under the linked account, and a tap copies the figure bare",
      !on.hidden && same(on.rows, [["Amount", "RM 70.00"], ["Reference", "k7m2-p9qr"]]) &&
      same(on.copied, [["70.00", "amount"], ["k7m2-p9qr", "reference"]]), JSON.stringify(on));
    const other = drive("#maybank/transfer/70/k7m2-p9qr", { key: "ambank" });
    const sus = drive("#maybank/transfer/70/k7m2-p9qr", { key: "maybank" }, true);
    const bare = drive("#maybank", { key: "maybank" });
    ok("on any other account, on a suspended one, or from a bare key, nothing shows",
      other.hidden && !other.rows.length && sus.hidden && !sus.rows.length && bare.hidden && !bare.rows.length);
    ok("Paid? Go back and Return to order page show with a link's amount and reference, on that account only, so a payer is never left with Accounts as the one way out",
      on.paid === false && other.paid && sus.paid && bare.paid &&
      /<div class="goback" id="goback" hidden>\s*<button type="button" id="unpaid" class="pill">Return to order page<\/button>\s*<button type="button" id="paid" class="pill save">Paid\? Go back<\/button>\s*<\/div>/.test(indexHtml) &&
      /\.goback\[hidden\]\{display:none;\}/.test(cssCode), JSON.stringify([on.paid, other.paid, sus.paid, bare.paid]));
    // each tap closes the page, and where the browser keeps it open says how to go back and holds the line
    {
      const src = (/function goBack\(line\) \{[\s\S]*?\n  \}\n  document\.getElementById\("paid"\)[\s\S]*?\n  \}\);\n  document\.getElementById\("unpaid"\)[\s\S]*?\n  \}\);/.exec(appJs) || [""])[0];
      const taps = {}, out = [];
      for (const id of ["paid", "unpaid"]) {
        let closed = 0, line = null, later = null;
        new Function("document", "window", "setTimeout", "say", src)(
          { hidden: false, getElementById: (k) => ({ addEventListener: (t, f) => { taps[k] = f; } }) },
          { close() { closed++; } }, (f) => { later = f; }, (m, h) => { line = m + "|" + h; });
        if (taps[id]) taps[id](); if (later) later();
        out.push(closed + " " + line);
      }
      ok("each way back closes the page, and if it stays open says how to go back, held",
        out[0] === "1 Tap Done or close this tab, then tell us on your account|false" && out[1] === "1 Tap Done or close this tab to go back|false", JSON.stringify(out));
    }

    // sayTap against stubs: the label under the strip names its copy too, and only while the strip is there.
    const said = (hash, key, view) => {
      let got = null;
      lift(["linkOf", "dueRows", "sayTap"], ["location", "CODES", "idx", "viewOf", "down", "say"], "sayTap")(
        { hash }, [{ key }], 0, () => view, () => false, (m, hold) => { got = m + "|" + hold; })();
      return got;
    };
    const saying = [said("#maybank/qr/70/k7m2-p9qr", "maybank", "qr"), said("#maybank", "maybank", "qr"),
      said("#maybank/qr/70/k7m2-p9qr", "ambank", "qr"), said("#maybank/transfer/70/k7m2-p9qr", "maybank", "transfer")];
    ok("on the code with a link's amount the label names both taps, the code's save and the strip's copy, and otherwise one",
      same(saying, ["Tap the code to save, a value to copy|false", "Tap to save|false", "Tap to save|false", "Tap a value to copy|false"]),
      JSON.stringify(saying));

    // route against stubs: the link's rail becomes the mode only where the account is on it.
    const routed = (hash) => {
      const seen = [];
      const CODES = [{ key: "maybank", payload: "x", bank: "M", acct: "1" }, { key: "wise", payload: "", bank: "W", acct: "2" }];
      lift(["linkOf", "indexOfKey", "railOf", "onRail", "route"], ["location", "CODES", "setRail", "showCode", "showList"], "route")(
        { hash }, CODES, (r) => seen.push("rail:" + r), (i) => seen.push("code:" + i), () => seen.push("list"))();
      return seen.join(" ");
    };
    ok("a link opens its account at its rail, falls back where the account is not on it, and a bad key lands on the list",
      routed("#maybank/transfer/70/k7m2-p9qr") === "rail:transfer code:0" &&
      routed("#wise/qr/70/k7m2-p9qr") === "code:1" && routed("#maybank") === "code:0" &&
      routed("#nobody/qr/70/x") === "list", [routed("#maybank/transfer/70/k7m2-p9qr"), routed("#wise/qr/70/k7m2-p9qr")].join(" | "));
    ok("the figure is filled on every repaint of the code, and hidden by default in the markup",
      /document\.body\.setAttribute\("data-view", v\);\s*fillDue\(a\);/.test(appJs) &&
      /<div class="due" id="due"[^>]*hidden><\/div>/.test(indexHtml) && /\.due\[hidden\]\{display:none;\}/.test(cssCode));
  }

  ok("the number is embossed rather than printed: a shadow, a highlight and a face",
    /function emboss\(/.test(read(path.join(PUB, "qr-art.js"))) &&
    /rgba\(255,255,255,0\.42\)/.test(read(path.join(PUB, "qr-art.js"))));
  ok("the digits are copied without the spacing that is only there to be read",
    /String\(value\)\.replace\(\/\\s\+\/g, ""\)/.test(appJs));
  ok("copying falls back to execCommand where the clipboard API is refused",
    /navigator\.clipboard\.writeText/.test(appJs) && /execCommand\("copy"\)/.test(appJs));
  ok("the copy never depends on the drawing: it reads the record, not a canvas",
    /var digits = String\(value\)\.replace/.test(appJs) &&
    !/getImageData[\s\S]{0,80}(acct|ref1)/.test(appJs));
  /* ONE COPY PATH FOR BOTH RAILS. Written twice, the half that drifts is the JomPAY half,
   * because it belongs to the single account that has a biller code and so is the one nobody
   * exercises by accident. */
  ok("the account number, the biller code and the reference share one copy path",
    /function copyValue\(value, label\)/.test(appJs) &&
    /function copyAcct\(\)[\s\S]{0,120}?copyValue\(a\.acct, "account number"\)/.test(appJs) &&
    !/function copyRef1\(/.test(appJs));
  /* The confirmation names the value's label, never the value: it is on screen already, and a
   * status line that repeats it says nothing new. */
  ok("the confirmation names what was copied by its label",
    /say\("Copied " \+ label\)/.test(appJs) && !/say\("Copied " \+ digits/.test(appJs));
  /* Unconditionally, not only on a change of account. When this was conditional the very first
   * account you opened had no label at all, because nothing had changed yet. */
  ok("every account arrival writes the hint, not only a change of account",
    /\n    sayTap\(\);/.test(appJs));

  /* The zoom sets its own first frame before the browser can paint the element. Without it the
   * flier is painted once at full size and then snaps small to grow, which is the skipped beat
   * this was reported as. */
  ok("the flier commits its starting transform before it is ever painted",
    /c\.style\.transform = from;\s*\n\s*void c\.offsetWidth;/.test(appJs));

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
  /* The zoom. A tile's badge is the same coin drawn small, and opening an account flies that
   * very image up to full size, so it reads as one object moving. fly() takes RECTS, and each
   * end is measured by its caller, which is what keeps the ordering honest. */
  ok("a tile's thumbnail is the real coin, drawn small",
    /className = "tiledot"/.test(appJs) && /decorative: true/.test(appJs) &&
    /function drawThumbs\(\)/.test(appJs) && /\.tiledot\{/.test(cssCode));
  ok("opening an account flies that same image up to full size",
    /function fly\(fromRect, toRect, image, opts\)/.test(appJs) &&
    /fly\(from, to, pre\.canvas/.test(appJs) && /\.flier\{/.test(cssCode));
  ok("closing flies it down into its tile again",
    /fly\(from, to, shot/.test(appJs) && /function close\(\)/.test(appJs));
  ok("the flier works out its own direction from the two rects",
    /var shrinking = toRect\.width < fromRect\.width;/.test(appJs));
  ok("the flier carries the full-size render and is only ever scaled down",
    /c\.width = image\.width;/.test(appJs) && /var s = small\.width \/ big\.width;/.test(appJs));
  ok("what the flier covers is revealed one frame before it goes, so there is no gap and no " +
     "double image", /onArrive, Math\.max\(0, ms - 32\)/.test(appJs));
  ok("a second tap cannot strand the first zoom", /function killFlier\(\)/.test(appJs) &&
    /killFlier\(\);/.test(appJs));
  ok("a zero-size rect can never start a zoom",
    /function rectOf\(el\)/.test(appJs) && /\(r\.width && r\.height\) \? r : null/.test(appJs));
  ok("if the zoom cannot play, the coin still gets an entrance",
    /oneShot\(elBtn, "enter", MS\.enter\);/.test(appJs));

  /* THE DURATIONS HAVE ONE SOURCE, and it is the stylesheet. Every class the script adds
   * plays a keyframe app.css defines, and the script has to know when to take it off
   * again; two copies of that number in two files drift, and the failure is silent, since
   * a mismatch shows only as a class stripped mid-animation or left on long enough to
   * out-rank the next one. This assertion existed pinning the literal 320, which was that
   * duplication written down a third time. */
  ok("the script reads its timings from the stylesheet rather than restating them",
    /function cssMs\(name, fallback\)/.test(appJs) &&
    /cssMs\("--dur"/.test(appJs) && /cssMs\("--dur-fast"/.test(appJs));
  ok("no motion duration is left hard-coded in the script",
    !/oneShot\([^)]*, \d{3}\)/.test(appJs));

  /* MOTION IS TIERED. One duration for everything was the bug: measured on the real zoom,
   * the old 420ms curve reached 95 per cent of the distance in 203ms and spent the other
   * 217ms creeping through the last five per cent, which reads as a snap and then a
   * pause. Feedback has to answer a finger quickly; a transition may take longer. */
  {
    const dur = (cssCode.match(/--dur:\s*(\d+)ms/) || [])[1];
    const fast = (cssCode.match(/--dur-fast:\s*(\d+)ms/) || [])[1];
    ok("the feedback tier answers a finger inside 160ms, and is faster than a transition",
      fast && dur && Number(fast) <= 160 && Number(fast) < Number(dur),
      "fast " + fast + ", transition " + dur);
    ok("a screen transition stays under 340ms, so it cannot read as lag",
      dur && Number(dur) <= 340, dur + "ms");
  }

  /* The press-and-hold threshold is a GESTURE timing, not a motion one. Shortening the
   * animations must not make the app easier to save by accident, so it does not follow
   * the stylesheet and is named to say so. */
  ok("the hold threshold is independent of the motion tokens",
    /var HOLD_MS = \d+;/.test(appJs) && /}, HOLD_MS\);/.test(appJs));
  ok("the list deals itself in once, not every time it comes back",
    /body\.view-list\.fresh \.tile\{/.test(cssCode) && /classList\.remove\("fresh"\)/.test(appJs));

  /* All thirteen thumbnails are drawn together, before the list is shown. One per idle
   * callback read as a download in progress, which is exactly what it is not. It is affordable
   * because decorative mode draws each module as a plain rect rather than a rounded blob, which
   * at a module of about one pixel is identical to look at and several times cheaper. */
  ok("every thumbnail is drawn at once, not one at a time",
    /for \(var i = 0; i < CODES\.length; i\+\+\) \{[\s\S]{0,1000}?paintFace\(el/.test(appJs) &&
    !/idle\(step\)/.test(appJs));
  ok("a thumbnail's modules are plain rects, which is what makes drawing them all affordable",
    /if \(opts\.decorative\) \{[\s\S]{0,400}?g\.fillRect\(bx, by/.test(read(path.join(PUB, "qr-art.js"))));

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
    /a\.finished\.then\(finish, finish\)/.test(appJs));

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
  /* THE LIGHT IS THE IDENTITY'S, NOT THE ACCOUNT'S (14 Sep 2026). Salt has one accent, copper
   * and brass, and the coin already carries the provider's colour; so the page is never
   * re-tuned per account, and there is no second sky layer to cross-fade to. */
  ok("the aurora is copper and brass for every account, never re-tuned from the brand",
    !/function tune\(/.test(appJs) && !/setProperty\("--s[123]"/.test(appJs) &&
    !/\.sky\.on\{/.test(cssCode) && /rgba\(184,115,51/.test(cssCode) && /rgba\(197,160,89/.test(cssCode));
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

/* -------------------------------------------------- accounts that carry no code */

/* An account with no DuitNow code is paid by naming the bank, the number and the person, and
 * every one of those three has to survive the trip or the account is unusable in a way nobody
 * would notice from looking at it: three quarters of a transfer instruction still draws a
 * perfectly handsome coin. */
{
  const thin = plates.filter((c) => !c.bank || !c.acct);
  ok("every code-less account names its bank and its number (" + plates.length + ")",
    thin.length === 0, thin.map((c) => c.key).join(", "));

  /* THE BANK NOW SHIPS ON EVERY ACCOUNT, THE HOLDER STILL ON ALMOST NONE, and the asymmetry is
   * the assertion rather than an inconsistency to tidy away.
   *
   * This used to demand that a code account carry neither, on the reasoning that a code account
   * says nothing about a bank. That held only while scanning was the sole way to pay one. Since
   * 4 Sep 2026 all fourteen also have an account number at a real institution, so all fourteen
   * are payable by DuitNow Transfer, and a transfer starts by picking that institution from a
   * list. The bank is now the answer to a question the phone is actually asked.
   *
   * The holder is a different field doing a different job and it stays shut. On a code account
   * the receiver is the owner, so a holder there would be his own legal name on a public page.
   * It is only ever set where the receiver is an INSTITUTION a payer would not expect, which is
   * the Wise account and nothing else. The leak check and the stem check below are the belt;
   * this is the brace. */
  const noBank = codes.filter((c) => !c.bank);
  ok("every account names its institution, code or not, because all of them take a transfer",
    noBank.length === 0, noBank.map((c) => c.key).join(", "));

  const named = codes.filter((c) => c.holder);
  ok("an account WITH a code carries no holder; the receiver is the owner and is never printed",
    named.length === 0, named.map((c) => c.key).join(", "));

  const master2 = JSON.parse(read(STORE));
  const want = master2.accounts.filter((a) => !a.payload).map((a) => a.key).sort().join();
  ok("the code-less accounts are exactly the ones the master has no payload for",
    plates.map((c) => c.key).sort().join() === want, "master: " + want);
}

/* THE PERSON'S NAME IS PINNED TO ONE PLACE. The build asserts this too, and it is repeated here
 * because the build can be edited: this reads the finished bundle on disk and counts, so a name
 * that has spread into app.js, the manifest or the service worker's shell list is caught by
 * whichever of the two runs. Exactly once per plate, in data.js, and nowhere else at all. */
{
  const names = [...new Set(plates.map((c) => c.holder).filter(Boolean))];

  /* THE NAME IS NEVER DERIVED, and this is the assertion that says so. The build must not be
   * able to invent a holder out of the owner's legal name: it ships exactly what the master
   * types into `holder`, and nothing sets one today, so nothing is published. Without this the
   * pin below is vacuous whenever the count happens to be zero, which is the state we are in.
   *
   * The forbidden-set sweep earlier in this section is what does the work meanwhile: with no
   * holder shipped, the payee's name is refused outright wherever it appears. */
  const authorised = new Map(JSON.parse(read(STORE))
    .accounts.map((a) => [a.key, String(a.holder || "").trim()]));
  const invented = shipped.filter((c) => c.holder !== (authorised.get(c.key) || ""));
  ok("a holder name ships only where the master explicitly sets one, never derived (" +
     names.length + " in use)", invented.length === 0,
    invented.map((c) => c.key + ": shipped " + JSON.stringify(c.holder) +
                        ", master has " + JSON.stringify(authorised.get(c.key) || "")).join("; "));

  const stray = [];
  for (const f of files) {
    if (!/\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f)) continue;
    let body = read(f);
    for (const p of shipped.map((c) => c.payload).filter(Boolean)) body = body.split(p).join(" P ");
    for (const n of names) {
      const seen = body.split(n).length - 1;
      const allowed = rel(f) === "data.js" ? plates.filter((c) => c.holder === n).length : 0;
      if (seen !== allowed) stray.push(rel(f) + ": " + seen + ", expected " + allowed);
    }
  }
  /* Correct at zero as well as at one. With no holder shipped this passes because there is
   * nothing to find, and the assertion that carries the weight in that state is the one above
   * plus the forbidden-set sweep. The moment a name IS set, this pins it. */
  ok("a holder's name, where one is set, is served once in data.js and nowhere else" +
     (names.length ? "" : " (none set)"),
    stray.length === 0, stray.join("; "));

  /* A HOLDER IS A BENEFICIARY, AND A BENEFICIARY IS NOT THE OWNER.
   *
   * This assertion used to read "no legal name is published at all", which conflated two very
   * different things. A code-less account is paid by naming its receiver, and that receiver is
   * normally an institution: Wise's MYR account is held at JPMorgan Chase in the name of Wise
   * Payments Malaysia Sdn Bhd, and a payer not warned of that aborts the transfer. A company
   * name is not personal data.
   *
   * What must never be published is the OWNER'S OWN name, and that is what this checks: no
   * holder may match the payee or an owner, by exact string or by squashed stem, and the payee's
   * name must appear nowhere outside a payload. The build refuses such a holder outright rather
   * than stripping and pinning it, so this is the second lock on the same door. */
  const doc = JSON.parse(read(STORE));
  const payee = String(doc.payee || "").trim();
  const personStems = [payee, ...(doc.owners || []).flatMap((o) => [o && o.name, o && o.legal])]
    .map((v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12))
    .filter((v) => v.length === 12);
  const squash = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const personal = names.filter((n) => personStems.some((st) => squash(n).includes(st)));
  ok("no published beneficiary name is the owner or the payee",
    personStems.length > 0 && personal.length === 0, personal.join(", "));

  const anywhere = files.filter((f) => /\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f))
    .filter((f) => {
      let body = read(f);
      for (const p of shipped.map((c) => c.payload).filter(Boolean)) body = body.split(p).join(" P ");
      return payee && body.includes(payee);
    });
  ok("the owner's own legal name is published nowhere outside a payload",
    anywhere.length === 0, anywhere.map(rel).join(", "));
}

/* PayNet's mark says a DuitNow code is present. These accounts have none, so putting their
 * artwork on one would be using their brand to label something it does not cover. The plate
 * never reaches for it, and this is what says so. */
{
  const art = read(path.join(PUB, "qr-art.js"));
  const plateFn = art.slice(art.indexOf("function drawPlate("));
  const body = plateFn.slice(0, plateFn.indexOf("\n  function ", 10));
  ok("the code-less face draws no DuitNow mark",
    !/DuitNowMark|duitnow/i.test(body), "drawPlate reaches for PayNet's mark");

  /* THE TRACED MARKS. Path data, never a raster, and that is the load-bearing part: drawing an
   * image would need `img-src data:` adding to a Content-Security-Policy that is
   * `default-src 'none'`, and widening a security header to fit a logo is the wrong trade. */
  {
    const marksSrc = read(path.join(PUB, "marks.js"));
    const scope = {};
    new Function("self", marksSrc).call(scope, scope);
    const MARKS = scope.MARKS || {};

    ok("the marks ship as path data, not as an embedded image",
      !/data:image|base64/i.test(marksSrc) &&
      Object.values(MARKS).every((m) => typeof m.d === "string" && m.d.length > 200));
    /* OUR OWN files, not the vendored encoder: qrcode.js carries unused helpers that emit a GIF
     * data URI and an <img> tag, which nothing in this app ever calls. What matters is that the
     * app itself never asks the browser to fetch an image. */
    const ours = ["index.html", "app.js", "app.css", "qr-art.js", "marks.js", "manifest.webmanifest"];
    const fetchers = ours.filter((f) => /data:image|<img\b/i.test(read(path.join(PUB, f))));
    ok("nothing the app ships asks the browser to fetch an image", fetchers.length === 0,
      fetchers.join(", "));
    /* The policy allows `img-src 'self'` and NOT data:, which is the whole reason the marks are
     * path data. Embedding the source rasters would have meant widening this line. */
    const workerSrc = read(path.join(REPO, "src", "worker.js"));
    ok("the policy still refuses data: images, which is why marks are paths rather than rasters",
      /img-src 'self'/.test(workerSrc) && !/img-src[^",]*data:/.test(workerSrc));

    // Every id a record names must be a mark that actually shipped, or the face draws a gap.
    const wanted = [...new Set(shipped.flatMap((c) => [c.bankMark, c.holderMark]).filter(Boolean))];
    /* EVERY ACCOUNT SHIPS ITS MARK (15 Sep 2026). The build once blanked bankMark on code
     * accounts, so every badge fell back to initials while fourteen marks sat loaded and unused,
     * and nothing said so. A code account without a mark is now a failed build. */
    ok("every shipped account names a bank mark that is actually loaded",
      shipped.every((c) => c.bankMark && MARKS[c.bankMark]),
      "missing: " + shipped.filter((c) => !c.bankMark || !MARKS[c.bankMark]).map((c) => c.key).join(", "));
    ok("every mark an account names is in the bundle (" + wanted.join(", ") + ")",
      wanted.length > 0 && wanted.every((id) => MARKS[id]),
      wanted.filter((id) => !MARKS[id]).join(", "));
    ok("marks.js is stamped with the build id like every other script",
      indexHtml.includes("./marks.js?v=" + rev.id));

    /* And it actually paints. A mark that silently draws nothing is exactly what happened when
     * Path2D was missing from the scope: the layout still reserved its height, so the face came
     * out with a neat empty gap and no error anywhere. */
    const c2 = plates.find((c) => c.bankMark) || plates[0];
    const withMark = createCanvas(8, 8), without = createCanvas(8, 8);
    const o2 = { size: 700, pixelRatio: 1, brand: c2.brand, label: c2.name, seed: c2.key,
                 bank: c2.bank, holder: c2.holder };
    QRArt.drawPlate(withMark, Object.assign({ bankMark: MARKS[c2.bankMark],
                                              holderMark: MARKS[c2.holderMark] }, o2));
    QRArt.drawPlate(without, o2);
    /* Counting opaque pixels proves nothing here: the mark is painted ON a disc that is already
     * opaque, so the alpha count is identical either way. That was the first version of this
     * assertion and it failed while the drawing was perfectly correct. Diff the two renders. */
    const px2 = (cv) => cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    const a2 = px2(withMark), b2 = px2(without);
    let differ = 0;
    for (let i = 0; i < a2.length; i += 4) {
      if (a2[i] !== b2[i] || a2[i + 1] !== b2[i + 1] || a2[i + 2] !== b2[i + 2]) differ++;
    }
    ok("a named mark is actually painted, not merely allotted space", differ > 2000,
      differ + " pixels differ with the marks against without them");

    /* A MARK REPLACES ITS NAME rather than sitting above it, so the legal name must NOT be drawn
     * on a row that has a logo. The name is still in the record and still in the coin's
     * accessibility label, which is where a logo's text alternative belongs. */
    const plateBody = (() => {
      const art = read(path.join(PUB, "qr-art.js"));
      const from = art.indexOf("function drawPlate(");
      return art.slice(from, art.indexOf("\n  /* -----", from + 10));
    })();
    ok("a row with a mark draws the mark instead of the name, not as well as it",
      /if \(row\.mark\) \{[\s\S]{0,220}?continue;/.test(plateBody));
    ok("a row with NO mark still draws its name, so a logoless bank is not a blank space",
      /rows\[r\]\.fit = layoutValue\(/.test(plateBody));
    ok("the full names survive for a screen reader, which cannot see a logo",
      /\["Bank", a\.bank\]/.test(read(path.join(PUB, "app.js"))));
  }

  /* NO FACE DRAWS THE ACCOUNT NUMBER, and this is the last one that did. Taking it off the
   * coin's reverse and leaving it here would have made one account the odd one out: twelve that
   * never show a number and one that does. The number reaches a banking app through the
   * clipboard without ever being displayed. */
  // Comments stripped, for the same reason the mark check strips them: the note explaining why
  // the number is not read names the field, and a guard that trips on its own explanation is a
  // guard nobody can document.
  const plateCode = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("the code-less face does not draw the account number either",
    !/\bacct\b/.test(plateCode), "drawPlate still reads acct");
  {
    const src = read(path.join(PUB, "app.js"));
    ok("nothing in the app hands an account number to a renderer",
      !/acct: a\.acct/.test(src), "a paint call still passes acct");
    ok("a screen reader is not read the number that the screen does not show",
      !/aria-label", a\.name \+ ", account " \+ a\.acct/.test(src));
  }
  ok("the code-less face is drawn by the shared struck face, not a second drawing of one",
    /struckFace\(/.test(body) && /function struckFace\(/.test(art));
}

/* The plate renders, and obeys the same rule as every other face: nothing opaque outside the
 * artwork, because the coin's shadow is cast from its alpha and an opaque fill would put a hard
 * square behind a round object. */
{
  const c = plates[0];
  const cv = createCanvas(8, 8);
  const meta = QRArt.drawPlate(cv, { size: 700, pixelRatio: 1, brand: c.brand, label: c.name,
    seed: c.key, bank: c.bank, holder: c.holder });
  const g = cv.getContext("2d");
  const corners = [[2, 2], [cv.width - 3, 2], [2, cv.height - 3], [cv.width - 3, cv.height - 3]];
  const opaque = corners.filter(([x, y]) => g.getImageData(x, y, 1, 1).data[3] > 8);
  ok("the code-less face draws, at the size the app asks for", meta.size === 700 && cv.width === 700);

  /* TWO COLOURS, AND THE RIGHT ONE IN EACH PLACE. `brand` tints the face, `ring` strikes the
   * band around it. Asserted from the PIXELS rather than from the source, because the failure
   * mode is a palette handed to the wrong call, which reads perfectly well as code. */
  {
    const draw = (opts) => {
      const cv2 = createCanvas(8, 8);
      QRArt.drawPlate(cv2, Object.assign({ size: 700, pixelRatio: 1, label: c.name, seed: c.key,
        bank: c.bank, holder: c.holder }, opts));
      const g2 = cv2.getContext("2d");
      return { cv: cv2, at: (x, y) => [...g2.getImageData(x, y, 1, 1).data].slice(0, 3) };
    };
    const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const greener = (p) => p[1] > p[2] && p[1] > p[0];
    const bluer = (p) => p[2] > p[1] && p[2] > p[0];

    const two = draw({ brand: "#117ACA", ring: "#9FE870" });
    const face = two.at(two.cv.width >> 1, two.cv.height >> 1);
    const band = two.at(two.cv.width >> 1, Math.round(two.cv.height * 0.135));
    ok("the ring takes its own colour while the face takes the brand's tint",
      greener(band) && bluer(face), "face " + face.join(",") + ", ring " + band.join(","));

    /* THE FACE IS PAPER, NOT METAL, and this is the assertion that says so. It was metal while
     * this was the reverse of a coin carrying embossed lettering, where the edges do half the
     * work and 4.5:1 is enough. As the only face, carrying flat-filled logos, it was the one
     * coin in the book at half the contrast of every other. A brand-tinted paper is light; the
     * metal it replaced was not, so luminance alone separates them. */
    ok("the code-less face is light paper like every code coin's field, not dark metal",
      lum(face) > 200, "face luminance " + lum(face).toFixed(0));

    /* And the contrast that change bought, at the same bar a code's ink is held to rather than
     * the 4.5 the embossed reverse used. */
    const inkOn = (brand) => {
      const p = QRArt.palette(brand, QRArt.DEFAULTS.minContrast);
      return QRArt.contrast(QRArt.hex2rgb(p.ink), QRArt.hex2rgb(p.field));
    };
    const thin = ["#5B2F12", "#F5B400", "#C8102E", "#1A2B6B"].filter((b) => inkOn(b) < 8);
    ok("the plate's ink clears the same contrast bar a code's ink does", thin.length === 0,
      thin.map((b) => b + " at " + inkOn(b).toFixed(1) + ":1").join(", "));

    // And with no ring the coin is a single colour, which is every other account.
    const one = draw({ brand: "#117ACA" });
    const oneBand = one.at(one.cv.width >> 1, Math.round(one.cv.height * 0.135));
    ok("without a ring the coin is a single colour, as every other account is",
      bluer(oneBand), oneBand.join(","));
  }
  ok("the code-less face leaves the canvas transparent outside the artwork", opaque.length === 0);

  // Deterministic, for the same reason every other face is: the thumbnail and the full-size
  // render have to be the same object, or the zoom stops being one thing moving.
  const shot = () => {
    const x = createCanvas(8, 8);
    QRArt.drawPlate(x, { size: 300, pixelRatio: 1, brand: c.brand, label: c.name, seed: c.key,
      bank: c.bank, holder: c.holder });
    return crypto.createHash("sha256").update(Buffer.from(
      x.getContext("2d").getImageData(0, 0, 300, 300).data)).digest("hex");
  };
  ok("the code-less face draws the same picture every time", shot() === shot());
}

/* The app must not offer what a plate cannot do. No flip, because there is no second face; no
 * save, because there is no code to scan out of a saved picture. The tap copies instead, which
 * is what the caption on that face promises. */
{
  const appJs = read(path.join(PUB, "app.js"));
  ok("a code-less account is detected by its empty payload, in one place",
    /function plate\(a\) \{ return !!a && !a\.payload; }/.test(appJs));
  ok("every account has the same single control, because every coin has one face",
    !/elFlip|hidden = plate/.test(appJs));
  ok("a hold or tap saves only on the QR view; the other views copy from their rows",
    /if \(viewOf\(a\) !== "qr"\) return;/.test(appJs) &&
    /if \(down\(CODES\[i\]\) \|\| viewOf\(CODES\[i\]\) !== "qr"\) return null;/.test(appJs));
  ok("no card is built for an account with no code",
    /if \(!plate\(a\)\) idle\(function \(\) \{ cardOf\(a\); }\);/.test(appJs));
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

  /* ONE NAMESPACE, READ ONLY, AND NOTHING ELSE.
   *
   * The site was built with no storage at all, and the reason was never storage itself:
   * it was that there must be no route that writes, no secret and nothing to
   * authenticate. QR_STATE keeps that property. The Worker calls .get and never .put,
   * and the value is written from the laptop through the Cloudflare API under the
   * owner's own login, so the public surface gained a JSON file and not a write path.
   * Anything beyond this one binding is still refused. */
  ok("exactly one KV namespace, bound QR_STATE, and no other storage",
    Array.isArray(wrangler.kv_namespaces) && wrangler.kv_namespaces.length === 1 &&
    wrangler.kv_namespaces[0].binding === "QR_STATE" &&
    !wrangler.d1_databases && !wrangler.r2_buckets &&
    !wrangler.durable_objects && !wrangler.queues);
  /* THE GATE'S TWO VARIABLES AND NOTHING ELSE. Neither is a secret: the team domain is in every
   * Access login URL and the audience tag only names an application. What matters is that
   * nothing that IS a secret is declared here, and that the Worker reads exactly these. */
  ok("the config declares ACCESS_TEAM, ACCESS_AUD and an empty MAINTENANCE_UNTIL, all strings, and no secret",
    wrangler.vars && Object.keys(wrangler.vars).sort().join() === "ACCESS_AUD,ACCESS_TEAM,MAINTENANCE_UNTIL" &&
    wrangler.vars.MAINTENANCE_UNTIL === "" &&
    typeof wrangler.vars.ACCESS_TEAM === "string" && typeof wrangler.vars.ACCESS_AUD === "string" &&
    !/KEY|SECRET|TOKEN|PASS/i.test(Object.keys(wrangler.vars).join()));
  ok("the public surface is still read only: the only writes are behind identity()",
    /This site is read only\./.test(workerSrc) &&
    (workerSrc.match(/QR_STATE\.put\(/g) || []).length === 1);
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

/* THE MAINTENANCE GUARD: 503 for everything, assets included, until the stamp passes. */
{
  const at = (iso, url = "/", accept = "text/html") => worker.fetch(
    new Request("https://pay.example" + url, { headers: { accept } }),
    { ...mockEnv(), MAINTENANCE_UNTIL: iso });
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const r = await at(soon);
  const page = await r.text();
  ok("inside the window an HTML request gets the 503 page with Retry-After and no-store",
    r.status === 503 && /^[1-9]\d*$/.test(r.headers.get("retry-after") || "") &&
    r.headers.get("cache-control") === "no-store" && /<title>Maintenance<\/title>/.test(page) &&
    page.includes("The store is currently under maintenance. We are open for business again at 00:01 midnight of October 5.") &&
    r.headers.get("content-security-policy") === "default-src 'none'; style-src 'unsafe-inline'" &&
    !/<script|https?:/i.test(page));
  ok("inside the window an asset path is held too", (await at(soon, "/app.js", "*/*")).status === 503);
  const j = await at(soon, "/state.json", "application/json");
  ok("inside the window a non-HTML request gets the JSON refusal",
    j.status === 503 && (await j.json()).error === "maintenance");
  ok("after the window the Worker serves as normal",
    (await at(new Date(Date.now() - 1000).toISOString())).status === 200);
  ok("an empty value does nothing", (await at("")).status === 200);
  ok("an unparseable value does nothing", (await at("tomorrow-ish")).status === 200);
}

/* THE GATE, with a real key pair. A token is minted here and signed RS256 with a key the test
 * generated, the team's certificate endpoint is mocked to publish that key, and the Worker is
 * asked to verify it exactly as it would verify Cloudflare's. Then the same token is broken in
 * every way that matters: wrong audience, wrong issuer, expired, altered payload, foreign key,
 * and the variables unset. Each must read as nobody. */
{
  const TEAM = "team-under-test", AUD = "aud-" + crypto.randomBytes(8).toString("hex");
  const ISS = "https://" + TEAM + ".cloudflareaccess.com";
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const b64u = (s) => Buffer.from(s).toString("base64url");
  const mint = (claims, key = privateKey, kid = "k1") => {
    const head = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const body = b64u(JSON.stringify(claims));
    const sig = crypto.sign("sha256", Buffer.from(head + "." + body), key).toString("base64url");
    return head + "." + body + "." + sig;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = { aud: [AUD], iss: ISS, exp: now + 300, iat: now, email: "owner@example.test" };
  const token = mint(good);

  const realFetch = globalThis.fetch;
  let certHits = 0;
  globalThis.fetch = async (u) => {
    certHits++;
    if (String(u) !== ISS + "/cdn-cgi/access/certs") return new Response("no", { status: 404 });
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1", use: "sig", alg: "RS256" }] }),
      { headers: { "content-type": "application/json" } });
  };
  const kv = { store: new Map(),
    get: async (k) => kv.store.get(k) || null,
    put: async (k, v) => { kv.store.set(k, v); } };
  const envOn = { ...mockEnv(), QR_STATE: kv, ACCESS_TEAM: TEAM, ACCESS_AUD: AUD };
  const envOff = { ...mockEnv(), QR_STATE: kv };
  const call = (env, url, init) => worker.fetch(new Request("https://pay.example" + url, init), env);
  const withCookie = (t, init) => ({ ...(init || {}), headers: { ...((init || {}).headers || {}), cookie: "CF_Authorization=" + t } });

  ok("with the variables unset, /admin/, /api/me and POST /api/state all answer 401 even with a valid token",
    (await call(envOff, "/admin/", withCookie(token))).status === 401 &&
    (await call(envOff, "/api/me", withCookie(token))).status === 401 &&
    (await call(envOff, "/api/state", withCookie(token, { method: "POST", body: "{}" }))).status === 401);
  ok("nothing was written while the gate was unconfigured", kv.store.size === 0);
  ok("no certificate fetch happens before the cheap checks pass", certHits === 0);

  ok("with no token at all the gated routes answer 401 and the page says how to sign in",
    (await call(envOn, "/api/me")).status === 401 &&
    /Cloudflare Access/.test(await (await call(envOn, "/admin/")).text()));

  const me = await call(envOn, "/api/me", withCookie(token));
  ok("a valid token in the CF_Authorization cookie is verified against the team's key and names the signer",
    me.status === 200 && (await me.json()).email === "owner@example.test");
  const meH = await call(envOn, "/api/me", { headers: { "cf-access-jwt-assertion": token } });
  ok("the same token in the Cf-Access-Jwt-Assertion header is accepted too", meH.status === 200);

  const bad = [
    ["wrong audience", mint({ ...good, aud: ["someone-else"] })],
    ["wrong issuer", mint({ ...good, iss: "https://other.cloudflareaccess.com" })],
    ["expired", mint({ ...good, exp: now - 5 })],
    ["signed by a foreign key", mint(good, other)],
    ["unknown key id", mint(good, privateKey, "k9")],
    ["altered payload", token.split(".")[0] + "." + b64u(JSON.stringify({ ...good, email: "x@y" })) + "." + token.split(".")[2]],
    ["alg none", b64u(JSON.stringify({ alg: "none", kid: "k1" })) + "." + token.split(".")[1] + "."],
    ["garbage", "not.a.token"],
  ];
  for (const [what, t] of bad) {
    ok("a token that is " + what + " is refused", (await call(envOn, "/api/me", withCookie(t))).status === 401);
  }

  const put = await call(envOn, "/api/state", withCookie(token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maintenance: { spay: true, gx: false, "Bad Key": true, wise: "yes" },
                           order: ["gx", "spay", "gx", 7, "no such"], extra: "dropped" }),
  }));
  const putBody = await put.json();
  const stored = JSON.parse(kv.store.get("state") || "null");
  ok("a signed-in POST /api/state writes the namespace once, cleaned: booleans on slug keys, a de-duplicated order, nothing else",
    put.status === 200 && putBody.ok && stored &&
    JSON.stringify(stored.maintenance) === JSON.stringify({ spay: true, gx: false }) &&
    JSON.stringify(stored.order) === JSON.stringify(["gx", "spay", "no such"].filter((k) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(k))) &&
    !("extra" in stored) && typeof stored.at === "string", JSON.stringify(stored));
  ok("what was written is what /state.json now serves, publicly and no-store",
    (await (await call(envOff, "/state.json")).text()) === kv.store.get("state") &&
    (await call(envOff, "/state.json")).headers.get("cache-control") === "no-store, must-revalidate");
  ok("a body that is not JSON is a 400 and a body over the cap is a 413",
    (await call(envOn, "/api/state", withCookie(token, { method: "POST", body: "{nope" }))).status === 400 &&
    (await call(envOn, "/api/state", withCookie(token, { method: "POST", body: "{\"order\":[\"" + "a".repeat(9000) + "\"]}" }))).status === 413);
  ok("a GET on the write route and an unknown /api/ path are not routes",
    (await call(envOn, "/api/state", withCookie(token))).status === 404 &&
    (await call(envOn, "/api/nothing", withCookie(token))).status === 404);
  ok("POST anywhere outside /api/ is still refused with 405, signed in or not",
    (await call(envOn, "/", withCookie(token, { method: "POST" }))).status === 405 &&
    (await call(envOn, "/admin/", withCookie(token, { method: "POST" }))).status === 405);
  ok("the admin page itself is served from the assets once the token checks out, and is never cached",
    (await call(envOn, "/admin/", withCookie(token))).status === 200 &&
    (await call(envOn, "/admin/", withCookie(token))).headers.get("cache-control") === "no-cache");

  globalThis.fetch = realFetch;
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
  ok("the edit surface is not in the shell: no admin file is precached",
    shell.every((u) => !/admin/.test(u)), shell.join(", "));

  /* THE BRAND FACES (22 Sep 2026): the design system's two files, beside the page, named by the
     stylesheet with this build's stamp, precached, and admitted by the policy from self alone. */
  const FONT_FILES = ["newsreader-latin.woff2", "geist-mono-latin.woff2"];
  ok("the brand faces ship beside the page", FONT_FILES.every((f) => fs.existsSync(path.join(PUB, "fonts", f))));
  const cssF = read(path.join(PUB, "app.css"));
  ok("app.css declares both faces from ./fonts/, stamped with this build",
    FONT_FILES.every((f) => cssF.includes("url(./fonts/" + f + "?v=" + rev.id + ")")) && /font-family: 'Newsreader'/.test(cssF));
  ok("the shell precaches both faces", FONT_FILES.every((f) => shell.includes("./fonts/" + f + "?v=" + rev.id)));
  const workerF = read(path.join(PUB, "..", "src", "worker.js"));
  ok("the policy admits the page's own fonts and nothing else's", /font-src 'self'/.test(workerF) && !/font-src[^",]*(data:|http)/.test(workerF));
}

/* THE EDIT SURFACE HOLDS TO THE SAME POLICY as the public page: no inline script, no inline
 * style, stamped assets, and nothing typed into it that the bundle does not already carry. */
{
  const adminHtml = read(path.join(PUB, "admin", "index.html"));
  const adminJs = read(path.join(PUB, "admin.js"));
  ok("admin/index.html has no inline script",
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(adminHtml));
  ok("admin/index.html has no inline style block or style attribute",
    !/<style\b/i.test(adminHtml) && !/\sstyle=/i.test(adminHtml));
  ok("admin/index.html stamps its assets with this build",
    (adminHtml.match(/\?v=([a-f0-9]{12})/g) || []).length >= 3 &&
    adminHtml.split("?v=").slice(1).every((s) => s.startsWith(rev.id)));
  ok("the admin script writes only through POST /api/state and reads only /state.json and /api/me",
    /fetch\("\/api\/state", \{\s*method: "POST"/.test(adminJs) &&
    (adminJs.match(/fetch\(/g) || []).length === 3 &&
    !/QR_STATE|wrangler|localStorage/.test(adminJs));
  ok("the admin script never touches a payload or an account number",
    !/payload|acct|ref1/.test(adminJs));
}

/* ====================================================== 6. the build is coherent */

section("6. One build id, everywhere");

{
  const inHtml = [...indexHtml.matchAll(/\?v=([0-9a-f]{6,})/g)].map((m) => m[1]);
  ok("index.html stamps every asset with the build id", inHtml.length >= 4 && inHtml.every((v) => v === rev.id),
    [...new Set(inHtml)].join(", ") + " vs " + rev.id);
  ok("index.html has no unstamped local script or stylesheet",
    !/(?:src|href)="\.\/(?!favicon|apple-touch|manifest)[^"?]+\.(?:js|css)"/.test(indexHtml));
  /* his word of 24 Oct 2026: the tab is titled QR and its icon has no black ground */
  const adminHtml = read(path.join(PUB, "admin", "index.html"));
  ok("the tab is titled QR, and the list sets the same title when it returns to it",
    /<title>QR<\/title>/.test(indexHtml) && !/<title>QR Command<\/title>/.test(indexHtml) && /document\.title = "QR";/.test(read(path.join(PUB, "app.js"))) && !/document\.title = "QR Command"/.test(read(path.join(PUB, "app.js"))));
  ok("both pages link the clear-ground tab icon, and neither links the opaque 32px tile",
    indexHtml.includes('<link rel="icon" href="./favicon-tab.png" sizes="64x64">') && adminHtml.includes('<link rel="icon" href="../favicon-tab.png" sizes="64x64">')
    && !indexHtml.includes("favicon-32") && !adminHtml.includes("favicon-32"));
  {
    const tab = await loadImage(fs.readFileSync(path.join(PUB, "favicon-tab.png")));
    const cv = createCanvas(64, 64), g = cv.getContext("2d");
    g.drawImage(tab, 0, 0);
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data];
    ok("the tab icon is 64px and its ground is clear: every corner and edge midpoint outside the coin is fully transparent",
      tab.width === 64 && tab.height === 64 && [[0, 0], [63, 0], [0, 63], [63, 63], [0, 32], [63, 32], [3, 3]].every(([x, y]) => at(x, y)[3] === 0), JSON.stringify([at(0, 0), at(3, 3)]));
    ok("and the coin is solid on it: the rim at the top is opaque brass and the eye's salt is opaque at the centre, not the obsidian 5,8,10 ground",
      at(32, 3)[3] === 255 && at(32, 3)[0] > 150 && at(32, 32)[3] === 255 && at(32, 32).slice(0, 3).join() !== "5,8,10", JSON.stringify([at(32, 3), at(32, 32)]));
  }
  ok("data.js records the same build id", new RegExp('QR_BUILD = "' + rev.id + '"').test(dataSrc));
  ok("rev.json counts the codes it actually shipped", rev.codes === shipped.length);
}

{
  // The build id is a hash of everything that ships. Recompute it: a hand-edit inside public/
  // would change a file without changing the id, and that is exactly the state in which the
  // deployed bytes stop being the reviewed bytes.
  //
  // The ORDER and the MEMBERSHIP come from build.mjs itself rather than from a list typed out
  // again here. A second copy of that list goes stale the first time a file joins the bundle,
  // and then this assertion fails on a build that was perfectly correct, which teaches whoever
  // meets it that the check is noise. Read the one list.
  const buildSrc = read(path.join(REPO, "tools", "build.mjs"));
  const decl = (buildSrc.match(/const sources = \[([\s\S]*?)\n\];/) || [])[1] || "";
  const names = [...decl.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
  ok("the hashed bundle is the one build.mjs declares", names.length >= 5 && names.includes("qr-art.js"),
    names.join(", "));
  /* LF, exactly as the build hashes it. write() normalises CRLF on the way into public/, so
   * hashing a source file raw keys the build id to the line endings of the working tree
   * rather than to the bytes that reach the phone. sw.js is the one part read from source
   * here, and an editor that saved it CRLF broke this assertion on a build that was
   * perfectly correct. */
  const lfNorm = (t) => t.split("\r\n").join("\n");
  const parts = names.map((f) => lfNorm(
    // sw.js is the one file public/ holds in stamped form, so the hash takes its source.
    f === "sw.js"
      ? read(path.join(REPO, "src", "app", "sw.js"))
      : read(path.join(PUB, f)).replace(new RegExp("\\?v=" + rev.id, "g"), "?v=__BUILD__")));
  const dataBody = lfNorm(dataSrc.replace(/self\.QR_BUILD = "[^"]*";\n$/, ""));
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p);
  h.update(dataBody);
  // the faces move the id too (22 Sep 2026), in the order the build hashes them
  for (const f of ["newsreader-latin.woff2", "geist-mono-latin.woff2"]) h.update(fs.readFileSync(path.join(PUB, "fonts", f)));
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

{
  /* NO STRAY CONTROL BYTES ANYWHERE. This is not hypothetical tidiness: editing these files
   * through a shell heredoc has twice written a NUL into the middle of a string literal, once
   * in build.mjs and once in the cache key inside qr-art.js. Neither raised anything. A NUL in
   * a JS string is a legal character, so the file parses, the build runs and the suite passes;
   * the only symptom is that a comparison which should match no longer does. Byte 0x00 cannot
   * be intended in any file here, so look for it directly, in the sources AND in what shipped.
   * The escape is the only control byte with a legitimate use, and none of these files has one. */
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p); }
      else if (/\.(js|mjs|css|html|json|jsonc|webmanifest|md)$/i.test(p)) files.push(p);
    }
  })(REPO);
  const dirty = files.filter((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(read(f)))
    .map((f) => path.relative(REPO, f));
  ok("no stray control bytes in any source or shipped file", dirty.length === 0, dirty.join(", "));
  ok("the sweep actually looked at the files it claims to", files.length >= 20, files.length + " files");
}

/* ============================================================ 7. an open page follows the state, and a tap shows a kept code */

section("7. An open page re-reads the state, and a tap shows a code drawn already");

/* THE SHIPPED app.js, RUN, against a stub page. Nothing here reads the source for a shape: the
 * script is loaded from public/ as the phone loads it, its timers and idle callbacks are driven
 * by hand, and the renderer is the one that ships on a headless canvas. A check can fail only
 * if the behaviour does. */
async function runApp(opts) {
  opts = opts || {};
  const accounts = shipped.map((c) => Object.assign({}, c, { maintenance: false }));
  const box = { clientWidth: 390, clientHeight: 700 };
  const calls = { aborted: 0, state: 0, rev: 0, draws: [], reloads: 0 };
  let served = { maintenance: {}, order: [] };
  let gate = null, fontsDone = null;
  let now = 0, nextId = 1;
  const timers = new Map(), idles = [];
  const listeners = { doc: {}, win: {} };
  const store = new Map();
  if (opts.remembered) store.set("pay-state", JSON.stringify({ maintenance: {}, order: [] }));   // a phone that has opened before

  const made = [];   // every canvas the page made for itself
  const cls = (el) => (el.className || "").split(/\s+/).filter(Boolean);
  function stub(tag) {
    const el = tag === "canvas" ? createCanvas(300, 150) : {};
    const attrs = {};
    Object.assign(el, {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, className: "", hidden: false, textContent: "",
      style: { setProperty() {}, removeProperty() {} }, clientWidth: 0, clientHeight: 0, offsetWidth: 0,
      classList: {
        add: (c) => { if (!cls(el).includes(c)) el.className = cls(el).concat(c).join(" "); },
        remove: (c) => { el.className = cls(el).filter((x) => x !== c).join(" "); },
        toggle: (c, on) => { (on === undefined ? !cls(el).includes(c) : on) ? el.classList.add(c) : el.classList.remove(c); },
        contains: (c) => cls(el).includes(c)
      },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
      appendChild(c) {
        if (c.isFragment) { c.children.splice(0).forEach((k) => el.appendChild(k)); return c; }
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = el; el.children.push(c); return c;
      },
      removeChild(c) { el.children = el.children.filter((k) => k !== c); c.parentNode = null; return c; },
      addEventListener(t, f) { (el.on = el.on || {})[t] = f; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const want = sel.replace(/^\./, ""), out = [];
        (function walk(n) { for (const k of n.children || []) { if (cls(k).includes(want)) out.push(k); walk(k); } })(el);
        return out;
      },
      getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }), scrollIntoView() {}
    });
    if (tag === "canvas") {
      /* The headless canvas ignores a width of 0, which a browser honours by freeing the backing
       * store. Report it the browser's way, so a canvas the page shrinks to nothing reads as 0. */
      let p = Object.getPrototypeOf(el);
      while (p && !Object.getOwnPropertyDescriptor(p, "width")) p = Object.getPrototypeOf(p);
      const d = Object.getOwnPropertyDescriptor(p, "width");
      let freed = false;
      Object.defineProperty(el, "width", { configurable: true, enumerable: true,
        get() { return freed ? 0 : d.get.call(el); }, set(v) { freed = Number(v) === 0; if (!freed) d.set.call(el, v); } });
      made.push(el);
    }
    return el;
  }
  const byId = {};
  for (const id of ["coin", "say", "grid", "back", "plate", "due", "goback", "rails", "accounts", "paid", "unpaid"])
    byId[id] = stub(id === "coin" ? "canvas" : "div");
  made.length = 0;   // the page's own coin canvas is not a kept one
  byId.coinbtn = stub("button"); byId.coinbtn.parentNode = box;
  const stage = stub("div");

  const document_ = {
    readyState: "complete", hidden: false, title: "", body: stub("body"),
    fonts: opts.fonts ? { ready: new Promise((r) => { fontsDone = r; }) } : undefined,
    getElementById: (id) => byId[id], querySelector: (s) => (s === ".stage" ? stage : stub("div")),
    createElement: stub, createDocumentFragment: () => Object.assign(stub("div"), { isFragment: true }),
    addEventListener(t, f) { listeners.doc[t] = f; }
  };
  const plainDraw = QRArt.draw;
  const art = Object.assign({}, QRArt, {
    draw(canvas, payload, o) { if (!o.decorative) calls.draws.push(o.seed); return plainDraw(canvas, payload, o); }
  });
  const sched = (fn, ms, every) => { const id = nextId++; timers.set(id, { at: now + (ms || 0), fn, every: every ? ms : 0 }); return id; };
  const self_ = {
    AbortController, QR_CODES: accounts, QR_BUILD: "testbuild", QRArt: art, MARKS: {}, devicePixelRatio: 3,   // a phone: a coin, not the plain code a small store falls back to
    matchMedia: () => ({ matches: true }),     // motion off: nothing waits on an animation
    requestIdleCallback: (fn) => { idles.push(fn); return idles.length; },
    fetch: async (url, init) => {
      if (/^state\.json/.test(url)) { calls.state++;
        if (gate) await Promise.race([gate, new Promise((_, no) => { if (init && init.signal) init.signal.addEventListener("abort", () => { calls.aborted++; no(new Error("aborted")); }); })]);
        return { ok: true, json: async () => JSON.parse(JSON.stringify(served)) }; }
      if (/^rev\.json/.test(url)) { calls.rev++; return { ok: true, json: async () => ({ id: opts.newBuild || "testbuild" }) }; }
      return { ok: false, json: async () => null };
    },
    addEventListener(t, f) { listeners.win[t] = f; }
  };
  const nav = { share: async (d) => { nav.shared = d; }, canShare: () => true };
  const loc = { hash: "", reload() { calls.reloads++; } };
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  new Function("self", "window", "document", "localStorage", "history", "location", "navigator", "fetch",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "getComputedStyle",
    read(path.join(PUB, "app.js")))(
    self_, self_, document_, ls, { pushState() {}, replaceState() {}, back() {}, state: null }, loc, nav, self_.fetch,
    (f, ms) => sched(f, ms, false), (id) => timers.delete(id), (f, ms) => sched(f, ms, true), (id) => timers.delete(id),
    (f) => sched(f, 16, false), () => ({ getPropertyValue: () => "" }));

  const flush = () => new Promise((r) => setImmediate(r));
  const api = {
    calls, accounts, box, document: document_, coin: byId.coin, body: document_.body, nav, loc, served: (s) => { served = s; },
    reads: () => calls.state,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, t] of timers) if (t.at <= end && (!pick || t.at < pick[1].at)) pick = [id, t];
        if (!pick) break;
        now = pick[1].at;
        if (pick[1].every) pick[1].at = now + pick[1].every; else timers.delete(pick[0]);
        pick[1].fn();
        await flush();
      }
      now = end; await flush();
    },
    // the warm-up: its first second, then an account to an idle callback with a gap between
    // a state read that hangs until released, as on a slow network
    hold() { let rel; gate = new Promise((r) => { rel = r; }); return async () => { gate = null; rel(); await flush(); }; },
    async fontsLoaded() { fontsDone(); await flush(); },
    async drain() { while (idles.length) { idles.shift()(); await flush(); } },
    async idle() {
      await api.advance(1100);
      for (let k = 0; k < codes.length * 2 + 4; k++) { while (idles.length) { idles.shift()(); await flush(); } await api.advance(40); }
    },
    // the coins held: full-size canvases the page made and has not shrunk away
    held: () => made.filter((c) => c.width >= 1000).length,
    fullDraws: (key) => calls.draws.filter((k) => !key || k === key).length,
    async openKey(key) { loc.hash = "#" + key; listeners.win.popstate(); await flush(); },
    show(hidden) { document_.hidden = hidden; listeners.doc.visibilitychange(); },
    pixels: () => byId.coin.toBuffer("image/png"),
    blank: () => byId.coin.width === 8 && byId.coin.getContext("2d").getImageData(0, 0, 8, 8).data.every((v) => v === 0)
  };
  await api.advance(100);   // the two animation frames that paint and warm
  return api;
}

{
  const A = codes[0].key, B = codes[1].key;
  const live = {};
  const suspend = (...keys) => ({ maintenance: Object.fromEntries(keys.map((k) => [k, true])), order: [] });

  /* R3 (owner, 19 Oct 2026): while the page is showing, state is re-read every 15 seconds. */
  {
    const app = await runApp();
    const r0 = app.reads(), v0 = app.calls.rev;
    await app.advance(14800);
    const early = app.reads() - r0;
    await app.advance(200);
    const first = app.reads() - r0;
    await app.advance(30000);
    const later = app.reads() - r0;
    ok("an open, visible page re-reads the state every 15 seconds, and not before",
      early === 0 && first === 1 && later === 3, [early, first, later].join(" "));
    ok("the timer reads state only: the page is not asked whether it is the newest build, so a code shown to a payer never reloads under them",
      app.calls.rev === v0 && app.calls.reloads === 0, "rev reads " + (app.calls.rev - v0));

    app.show(true);
    const h0 = app.reads(), hv0 = app.calls.rev;
    await app.advance(120000);
    ok("while the page is hidden nothing is read at all",
      app.reads() === h0 && app.calls.rev === hv0, "reads " + (app.reads() - h0));
    app.show(false);
    await app.advance(0);
    const back0 = app.reads();
    ok("coming back to the front reads state and the build at once, as before",
      back0 === h0 + 1 && app.calls.rev === hv0 + 1, [back0 - h0, app.calls.rev - hv0].join(" "));
    await app.advance(15000);
    ok("and the timer starts again from the return", app.reads() === back0 + 1, "reads " + (app.reads() - back0));
  }

  // reads never overlap: a return to the front while one is still in flight starts no second
  {
    const app = await runApp();
    const release = app.hold();
    const r0 = app.reads();
    await app.advance(15000);                 // the timer starts a read, which hangs
    app.show(true); app.show(false);          // the phone is put down and picked up
    await app.advance(0);
    ok("a return to the front while a read is still in flight starts no second read", app.reads() === r0 + 1, "reads " + (app.reads() - r0));
    await release();
    app.show(true); app.show(false);
    await app.advance(0);
    ok("and once it has answered, the next return reads again", app.reads() === r0 + 2, "reads " + (app.reads() - r0));
  }

  // a read that never answers is abandoned at 10 s, so it cannot hold up the reads after it
  {
    const app = await runApp();
    await app.openKey(A);
    app.served(suspend(A));
    const release = app.hold();
    const r0 = app.reads();
    await app.advance(15000);                 // the timer starts a read, which hangs
    await app.advance(9000);
    app.show(true); app.show(false);
    const early = app.reads() - r0;
    ok("a read still hanging at 9 s is not yet abandoned: the return starts no second one", early === 1 && app.calls.aborted === 0,
      "reads " + early + ", aborted " + app.calls.aborted);
    await app.advance(1500);
    ok("at 10 s the hanging read is aborted, and changes nothing: the code on screen stands", app.calls.aborted === 1 && !app.blank(),
      "aborted " + app.calls.aborted);
    await release();   // the network is back
    app.show(true); app.show(false);
    await app.advance(0);
    ok("and the next return's read goes out and applies what it finds, here a suspension", app.reads() === r0 + 2 && app.blank(),
      "reads " + (app.reads() - r0) + ", blank " + app.blank());
  }

  /* A suspension reaches an open code view within 15 seconds, and takes the code off. */
  {
    const app = await runApp();
    await app.openKey(A);
    const before = app.pixels();
    ok("the open account shows its code", app.coin.width > 8 && app.body.className.includes("view-code") && !app.blank());
    app.served(suspend(A));
    await app.advance(14000);
    const stillUp = !app.blank();
    await app.advance(1100);
    ok("a suspension made while the code is open takes the code off the screen within 15 seconds, and not earlier",
      stillUp && app.blank() && app.body.className.includes("maintenance"),
      JSON.stringify({ stillUp, blank: app.blank(), cls: app.body.className }));
    app.served(live);
    await app.advance(15000);
    ok("and lifting it brings the code back, the same drawing", !app.blank() && app.pixels().equals(before));
  }

  /* Q1 (owner, 19 Oct 2026): each live code is drawn once in idle time and kept. */
  {
    const app = await runApp({ remembered: true });
    const n0 = app.fullDraws();
    await app.advance(800); await app.drain();
    ok("nothing is drawn full size in the app's first second: the opening list has it to itself", n0 === 0 && app.fullDraws() === 0,
      "drawn " + app.fullDraws());
    await app.idle();
    const warmed = app.fullDraws();
    ok("in idle time the first six live codes in list order are drawn once, and no more (" + codes.length + " accounts)",
      warmed === 6 && codes.slice(0, 6).every((c) => app.fullDraws(c.key) === 1) && app.held() === 6, "drawn " + warmed);
    await app.openKey(A);
    ok("a tap on an account draws nothing: it shows the kept drawing", app.fullDraws() === warmed && !app.blank(),
      "drawn " + (app.fullDraws() - warmed) + " more");
    const fresh = createCanvas(8, 8);
    QRArt.draw(fresh, codes[0].payload, { brand: codes[0].brand, label: codes[0].name, seed: codes[0].key, size: 390, pixelRatio: 3 });
    ok("the kept code is the fresh drawing byte for byte, and it is a coin at the phone's pixel ratio, not the plain fallback",
      app.coin.width >= 1000 && app.pixels().equals(fresh.toBuffer("image/png")));

    // press and hold still saves the same image: the card is drawn on its own, never from the kept coin
    const held = app.document.getElementById("coinbtn");
    held.on.pointerdown({ clientX: 0, clientY: 0 });
    await app.advance(500);
    const card = createCanvas(8, 8);
    QRArt.drawCard(card, codes[0].payload, { brand: codes[0].brand, label: codes[0].name, seed: codes[0].key, plain: false });
    const saved = app.nav.shared && app.nav.shared.files && app.nav.shared.files[0];
    ok("press and hold saves the card image, the same bytes as a fresh draw of it",
      !!saved && Buffer.from(await saved.arrayBuffer()).equals(card.toBuffer("image/png")));

    // a suspension drops what is kept, on the account that is not open as well as the one that is
    await app.openKey(B);
    const keyB = app.fullDraws(B);
    // all but four are suspended, so the warm-up's six would reach the suspended ones if it did not skip them
    const gone = [B].concat(codes.slice(5).map((c) => c.key));
    const goneBefore = gone.map((g) => app.fullDraws(g));
    app.served(suspend(...gone));
    await app.advance(15000);
    await app.idle();
    ok("a suspended account is drawn nowhere: nothing is kept for it and the warm-up skips it",
      gone.every((g, n) => app.fullDraws(g) === goneBefore[n]) && app.blank(),
      "drawn " + gone.map((g, n) => app.fullDraws(g) - goneBefore[n]).join(","));
    app.served(live);
    await app.advance(15000);
    const afterLift = app.fullDraws(B);
    ok("a restored account's code is drawn afresh, the kept one having been dropped with the suspension",
      afterLift > keyB, "draws " + keyB + " then " + afterLift);

    // the same for an account that is not on screen: suspended and lifted, its old drawing is not shown
    {
      const C = codes[2].key;
      await app.openKey(A);
      await app.idle();
      const c0 = app.fullDraws(C);
      app.served(suspend(C));
      await app.advance(15000);
      app.served(live);
      await app.advance(15000);
      await app.openKey(C);
      ok("an account suspended and lifted while it was off screen is drawn afresh when opened, not from what was kept before",
        app.fullDraws(C) === c0 + 1 && !app.blank(), "draws " + c0 + " then " + app.fullDraws(C));
    }

    // a changed payload finds nothing kept
    await app.idle();
    const kept = app.fullDraws(A);
    app.accounts.find((c) => c.key === A).payload = codes[1].payload;
    await app.openKey(B);
    await app.openKey(A);
    const swapped = createCanvas(8, 8);
    QRArt.draw(swapped, codes[1].payload, { brand: codes[0].brand, label: codes[0].name, seed: codes[0].key, size: 390, pixelRatio: 3 });
    ok("a changed payload is drawn afresh, never taken from the kept code",
      app.fullDraws(A) === kept + 1 && app.pixels().equals(swapped.toBuffer("image/png")) && !app.pixels().equals(fresh.toBuffer("image/png")),
      "draws " + kept + " then " + app.fullDraws(A));

    // a different size finds nothing kept
    app.box.clientWidth = 420; app.box.clientHeight = 420;
    const sized = app.fullDraws(B);
    await app.openKey(B);
    ok("a different size is drawn afresh", app.fullDraws(B) === sized + 1 && app.coin.width > 0,
      "draws " + sized + " then " + app.fullDraws(B));
  }

  /* THE STORE IS CAPPED AT SIX (owner, 19 Oct 2026): about 3 MB a coin at a ratio of 3. */
  {
    const app = await runApp({ remembered: true });
    await app.idle();
    const k = (n) => codes[n].key;
    const freshOf = (n) => {
      const c = createCanvas(8, 8);
      QRArt.draw(c, codes[n].payload, { brand: codes[n].brand, label: codes[n].name, seed: codes[n].key, size: 390, pixelRatio: 3 });
      return c.toBuffer("image/png");
    };
    const shows = async (n) => { const d = app.fullDraws(); await app.openKey(k(n)); return app.fullDraws() - d; };

    // five are shown again and the sixth is left longest unshown; the seventh account is then tapped
    for (const n of [1, 2, 3, 4, 5, 0]) await shows(n);   // account 1 is now the one shown longest ago
    let peak = app.held();
    const seventh = await shows(6);
    peak = Math.max(peak, app.held());
    ok("a tap on a seventh account draws it, and the store still holds six", seventh === 1 && app.held() === 6, "drew " + seventh + ", holds " + app.held());
    const again = [];
    for (const n of [6, 0, 5, 4, 3, 2]) again.push(await shows(n));
    ok("the one shown longest ago was dropped, and the other five and the seventh are still kept",
      again.every((d) => d === 0), "redrawn: " + again.join(","));
    const evicted = await shows(1);
    ok("the evicted account's next tap draws it afresh, and the drawing is the fresh one byte for byte",
      evicted === 1 && app.pixels().equals(freshOf(1)), "drew " + evicted);

    // however many are visited, the store never passes six
    for (let n = 0; n < codes.length; n++) { await app.openKey(k(n)); peak = Math.max(peak, app.held()); }
    for (let n = codes.length - 1; n >= 0; n--) { await app.openKey(k(n)); peak = Math.max(peak, app.held()); }
    ok("opening every account, forwards and back, never leaves more than six coins held", peak === 6 && app.held() === 6, "peak " + peak);
    const lastSix = codes.slice(0, 6).map((c) => c.key);   // the backward walk ended on these
    let hits = 0;
    for (const key of lastSix.slice().reverse()) { const d = app.fullDraws(); await app.openKey(key); if (app.fullDraws() === d) hits++; }
    ok("and what it holds is the six shown most recently", hits === 6, hits + " of 6 kept");

    // a canvas let go is shrunk to nothing first: a drawing replaced for a new size, and the whole store on a change of state
    app.box.clientWidth = 420; app.box.clientHeight = 420;
    await app.openKey(k(0));
    ok("a coin replaced because its size changed is shrunk, so six are still held and not seven", app.held() === 6, "holds " + app.held());
    await app.openKey("");   // back to the list, so nothing repaints a coin
    app.served(suspend(k(12)));
    await app.advance(15000);
    ok("after a change of state every coin that was kept is shrunk to nothing", app.held() === 0, "holds " + app.held());
  }

  // and when the faces load, which draws everything again
  {
    const app = await runApp({ remembered: true, fonts: true });
    await app.idle();
    const before = app.held();
    await app.fontsLoaded();
    ok("when the faces load every coin kept before them is shrunk to nothing", before === 6 && app.held() === 0, before + " then " + app.held());
  }
}

/* Counter Batch C (20 Oct 2026, his item 20): section and field labels at 600, as salt-ds 1.9.0 raised its eyebrow and label */
{
  const css = read(path.join(PUB, "app.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const weight = (sel) => { const m = new RegExp("(^|\\})\\s*" + sel.replace(".", "\\.") + "\\s*\\{([^}]*)\\}").exec(css); const f = m && /font-weight:\s*(\d+)/.exec(m[2]); return f ? +f[1] : 0; };
  ok("the eyebrow and the plate's labels weigh 600", weight(".atitle") === 600 && weight(".plabel") === 600, weight(".atitle") + " and " + weight(".plabel"));
}

/* --------------------------------------------------------------------- verdict */

console.log("\n" + (fail ? "FAILED: " : "ok: ") + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
