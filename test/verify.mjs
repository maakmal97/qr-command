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
import { createCanvas, Path2D } from "@napi-rs/canvas";

/* The DuitNow mark is drawn from the official SVG path data, which needs Path2D. Browsers have
 * it as a global; Node does not, so the headless canvas's implementation goes where the shipped
 * code looks for it. Nothing else in the renderer uses Path2D: the code's modules are filled
 * individually on purpose, and that is asserted separately. */
globalThis.Path2D = Path2D;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PUB = path.join(REPO, "public");
const MASTER = process.env.QR_MASTER ||
  "C:/Users/maakm/Claude/Code/pay-afif-site";

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
    /override\[a\.key\] === true/.test(appJsSrc));
  ok("a failed or malformed state read leaves the previous state alone",
    /\.catch\(function \(\) { return false; \}\);/.test(appJsSrc) &&
    /if \(!j \|\| typeof j !== "object"\) return false;/.test(appJsSrc));
  ok("only booleans against known account keys are trusted from the wire",
    /typeof m\[k\] === "boolean"/.test(appJsSrc));
  ok("the state file is fetched no-store and never precached",
    /fetch\("state\.json", { cache: "no-store"/.test(appJsSrc) &&
    /if \(url\.pathname === "\/state\.json"\) return;/.test(read(path.join(REPO, "src", "app", "sw.js"))));
  ok("the Worker only ever reads the namespace, and answers {} when it cannot",
    (function () {
      const w = read(path.join(REPO, "src", "worker.js"));
      return /env\.QR_STATE\.get\("state"\)/.test(w) &&
             !/QR_STATE\.(?:put|delete)/.test(w) && /body = "{}";/.test(w);
    })());
  ok("the build normalises the flag rather than shipping whatever the master had",
    /rec\.maintenance = a\.maintenance === true;/.test(read(path.join(REPO, "tools", "build.mjs"))));
  ok("a suspended account is cleared off the canvas, not merely covered",
    /if \(down\(a\)\) \{[\s\S]{0,400}?elCoin\.width = 8; elCoin\.height = 8;/.test(appJsSrc));
  ok("nothing is pre-rendered for a suspended account either",
    /function prerender\(i\) \{[\s\S]{0,40}?if \(down\(CODES\[i\]\)\) return null;/.test(appJsSrc));
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
    /function classOf\(a\) \{[\s\S]{0,160}?a\.tag \? " wide" : ""/.test(appJs) &&
    !/tiles\[i\]\.className = down\(/.test(appJs));

  /* SUSPENDED ACCOUNTS SINK, AT RUNTIME. It cannot be the master's order: /state.json suspends
   * an account in seconds with no deploy, so a baked order would leave it among the live ones
   * until the next release. The tiles are MOVED rather than rebuilt, so tiles[i] stays aligned
   * with CODES[i] and every index the app holds keeps its meaning. */
  ok("suspended accounts are sorted to the end, and re-sorted when the state changes",
    /function orderTiles\(\)/.test(appJs) &&
    /\(down\(CODES\[i\]\) \? held : live\)\.push\(i\)/.test(appJs) &&
    /orderTiles\(\);[\s\S]{0,900}?if \(idx >= 0\) paint\(\);/.test(appJs));
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

  /* A TAGGED ACCOUNT IS THE FEATURED ONE and takes a row to itself. `1 / -1` spans whatever
   * auto-fill resolved to rather than assuming two columns, so this survives a wider screen. */
  ok("a tagged account takes a row of its own and shows its tag",
    /\(a\.tag \? " wide" : ""\)/.test(appJs) &&
    /tg\.className = "tiletag"/.test(appJs) &&
    /\.tile\.wide\{[^}]*grid-column:1 \/ -1/.test(cssCode));
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
  ok("the coin says what a tap does, and the label does not time out",
    /say\(plate\(CODES\[idx\]\) \? "Tap to copy" : "Tap to save", false\);/.test(appJs) &&
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

  /* COPY WITHOUT SHOWING is the whole point of the change, so it is asserted directly: the
   * button reads the number out of the record and writes it to the clipboard, and no code path
   * draws it onto a canvas or into the DOM. */
  ok("the control copies rather than flips, and says so",
    /id="copybtn" class="pill">Copy account number</.test(indexHtml) &&
    /elCopy\.addEventListener\("click"/.test(appJs) &&
    /copyAcct\(\);/.test(appJs));
  ok("the account number is never drawn or written to the page, only to the clipboard",
    !/textContent = a\.acct|innerHTML = a\.acct/.test(appJs));
  ok("a suspended account refuses to hand out its number either",
    /elCopy\.disabled = true;/.test(appJs) && /if \(down\(a\)\) \{ say\("Under maintenance"\); return; }/.test(appJs));

  ok("the number is embossed rather than printed: a shadow, a highlight and a face",
    /function emboss\(/.test(read(path.join(PUB, "qr-art.js"))) &&
    /rgba\(255,255,255,0\.42\)/.test(read(path.join(PUB, "qr-art.js"))));
  /* The press must not fall through to the coin behind it, or one tap would copy AND save. */
  ok("the button copies, and the coin saves, and neither does the other's job",
    /elCopy\.addEventListener\("click"/.test(appJs) &&
    /e\.stopPropagation\(\);[\s\S]{0,40}?copyAcct\(\);/.test(appJs));
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
  ok("the account number and the JomPAY reference share one copy path",
    /function copyValue\(value, label\)/.test(appJs) &&
    /function copyAcct\(\)[\s\S]{0,120}?copyValue\(a\.acct/.test(appJs) &&
    /function copyRef1\(\)[\s\S]{0,400}?copyValue\(a\.ref1/.test(appJs));
  /* THE REFERENCE IS NEVER ECHOED. On Instapay Ref-1 is a mobile number, so a confirmation
   * reading "Copied 6011111809738" would put it on screen and into any screenshot, which is the
   * whole thing copying instead of drawing exists to avoid. The account number IS echoed, and
   * that difference is deliberate: putting numbers in the bundle was decided on 11 Aug 2026,
   * a mobile number is a reachable identifier rather than an address that can only receive. */
  ok("the JomPAY confirmation names the rail, never the reference",
    /copyValue\(a\.ref1, "JomPAY Ref-1"\)/.test(appJs));
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
    /for \(var i = 0; i < CODES\.length; i\+\+\) \{[\s\S]{0,400}?paintFace\(el/.test(appJs) &&
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

  const master2 = JSON.parse(read(path.join(MASTER, "accounts.json")));
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
  const authorised = new Map(JSON.parse(read(path.join(MASTER, "accounts.json")))
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
  const doc = JSON.parse(read(path.join(MASTER, "accounts.json")));
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
      /aria-label", "Bank, " \+ a\.bank/.test(read(path.join(PUB, "app.js"))));
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
  ok("a hold or tap on a code-less account copies the number instead of saving nothing",
    /if \(plate\(a\)\) \{ copyAcct\(\); return; }/.test(appJs));
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
  ok("exactly one KV namespace, bound QR_STATE, and no other storage or secret",
    Array.isArray(wrangler.kv_namespaces) && wrangler.kv_namespaces.length === 1 &&
    wrangler.kv_namespaces[0].binding === "QR_STATE" &&
    !wrangler.vars && !wrangler.d1_databases && !wrangler.r2_buckets &&
    !wrangler.durable_objects && !wrangler.queues);
  ok("the Worker never writes to it, so there is still nothing to authenticate",
    !/QR_STATE\.(?:put|delete|list)/.test(workerSrc) &&
    /This site is read only\./.test(workerSrc));
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

/* --------------------------------------------------------------------- verdict */

console.log("\n" + (fail ? "FAILED: " : "ok: ") + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
