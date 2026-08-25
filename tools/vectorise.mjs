/* vectorise.mjs - a bitmap logo in, path data out.
 *
 *   node tools/vectorise.mjs <image> <name> [outfile]
 *
 * WHY THIS EXISTS, and why it is not the thing this repo refused to do.
 *
 * CLAUDE.md records that a trademark REDRAWN FROM MEMORY comes out subtly wrong, which is why
 * PayNet's mark was taken path for path out of the official pack rather than traced by eye.
 * That rule is about invention. This tool invents nothing: it thresholds the actual pixels of
 * the supplied artwork, walks the boundary between ink and ground, and emits those boundaries.
 * The output is a faithful outline of the input, not somebody's recollection of it.
 *
 * It is still a DERIVATIVE of a raster, so it inherits the raster's limits: what is a smooth
 * bezier in the original becomes a fine polygon here, and the source's resolution sets the
 * ceiling on quality. At the size a coin draws a wordmark, roughly a twelfth of the source
 * width, that difference is well under a pixel. An official SVG would still be better and
 * should replace this the day one is available.
 *
 * PATH DATA, NOT A RASTER, and that is the whole point of bothering. Drawing an image on a
 * canvas needs `img-src data:` in the Content-Security-Policy, which is `default-src 'none'`
 * here; a Path2D built from a string needs nothing at all. So this keeps the security header
 * closed and the artwork sharp at every size.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const die = (m) => { console.error("\nvectorise failed: " + m + "\n"); process.exit(1); };

const [, , srcArg, nameArg, outArg] = process.argv;
if (!srcArg || !nameArg) die("usage: node tools/vectorise.mjs <image> <name> [outfile]");
if (!fs.existsSync(srcArg)) die("cannot find " + srcArg);

const img = await loadImage(srcArg);
const W = img.width, H = img.height;
const cv = createCanvas(W, H);
const g = cv.getContext("2d");
g.drawImage(img, 0, 0);
const px = g.getImageData(0, 0, W, H).data;

const at = (x, y) => {
  const i = (y * W + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
};

/* THE GROUND IS MEASURED, NOT ASSUMED. These are screenshots, so the logo may be light on dark
 * or dark on light and may sit on a tint rather than on white. The border ring is background by
 * construction, so its median is the ground, and ink is whatever is far from it. That makes the
 * tool work on both a white-on-brown and a green-on-green source with no flag to get wrong. */
const border = [];
for (let x = 0; x < W; x++) { border.push(at(x, 0)); border.push(at(x, H - 1)); }
for (let y = 0; y < H; y++) { border.push(at(0, y)); border.push(at(W - 1, y)); }
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const ground = [0, 1, 2].map((c) => median(border.map((p) => p[c])));

const dist = (p) => Math.abs(p[0] - ground[0]) + Math.abs(p[1] - ground[1]) + Math.abs(p[2] - ground[2]);
// Half way between the ground and the furthest thing from it, which for a two-tone mark is ink.
let far = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) far = Math.max(far, dist(at(x, y)));
const CUT = far * 0.5;
if (far < 60) die("the image has no clear ink: it is nearly all one colour");

const ink = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = at(x, y);
    ink[y * W + x] = (p[3] > 128 && dist(p) > CUT) ? 1 : 0;
  }
}

// Trim to what is actually drawn, so the viewBox is the mark rather than the screenshot.
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) {
  if (x < x0) x0 = x; if (x > x1) x1 = x;
  if (y < y0) y0 = y; if (y > y1) y1 = y;
}
if (x1 < 0) die("no ink found");

const on = (x, y) => (x < x0 || x > x1 || y < y0 || y > y1) ? 0 : ink[y * W + x];

/* Every edge between an ink cell and a non-ink cell, as a directed segment. Stitched into
 * closed loops below. Holes come out as loops of their own, which is exactly right: the paths
 * are filled EVEN-ODD, so a counter inside a P subtracts itself without anyone tracking
 * winding order. */
const edges = new Map();          // "x,y" -> [[x,y], ...] ends reachable from that point
const key = (x, y) => x + "," + y;
const addEdge = (ax, ay, bx, by) => {
  const k = key(ax, ay);
  if (!edges.has(k)) edges.set(k, []);
  edges.get(k).push([bx, by]);
};
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    if (!on(x, y)) continue;
    // Wound so ink is on the left of travel; consistency is what lets the loops stitch.
    if (!on(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!on(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) addEdge(x, y + 1, x, y);
  }
}

const loops = [];
while (edges.size) {
  const startKey = edges.keys().next().value;
  let [cx, cy] = startKey.split(",").map(Number);
  const loop = [[cx, cy]];
  for (;;) {
    const k = key(cx, cy);
    const outs = edges.get(k);
    if (!outs || !outs.length) break;
    const [nx, ny] = outs.pop();
    if (!outs.length) edges.delete(k);
    cx = nx; cy = ny;
    loop.push([cx, cy]);
    if (cx === loop[0][0] && cy === loop[0][1]) break;
  }
  if (loop.length > 8) loops.push(loop);
}

/* Ramer-Douglas-Peucker. The loops are pixel staircases; this is what turns them back into the
 * straight runs and long curves the artwork actually has. The tolerance is in SOURCE pixels,
 * and the mark is drawn at roughly a twelfth of the source width, so 1.2 here is a tenth of a
 * pixel on the glass. */
const TOL = Number(process.env.VEC_TOL || 1.2);
function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const den = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / den;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(rdp(pts.slice(idx), tol));
}

/* RDP IS DEGENERATE ON A CLOSED RING, and it fails silently, which is the dangerous part.
 *
 * The algorithm measures every point against the line from the first to the last. On a ring
 * those are the SAME point, so that line has no length and the perpendicular distance to it is
 * zero for every point in between. Every letter therefore "simplified" to two coincident points
 * and the whole mark came out as four empty subpaths: `M557 0Z`, and so on. No error, no
 * warning, just an invisible logo.
 *
 * A ring has to be cut into two open arcs first. Cutting at the point FARTHEST from the start
 * guarantees both arcs have a real baseline to measure against. */
function rdpRing(ring, tol) {
  const pts = ring.length > 1 &&
              ring[0][0] === ring[ring.length - 1][0] &&
              ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 4) return pts;
  let far = -1, fi = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1];
    const d = dx * dx + dy * dy;
    if (d > far) { far = d; fi = i; }
  }
  const a = rdp(pts.slice(0, fi + 1), tol);
  const b = rdp(pts.slice(fi).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

const num = (v) => {
  const r = Math.round(v * 10) / 10;
  return String(r === Math.round(r) ? Math.round(r) : r);
};
let points = 0;
const d = loops.map((loop) => {
  const simple = rdpRing(loop, TOL);
  points += simple.length;
  let s = "M" + num(simple[0][0] - x0) + " " + num(simple[0][1] - y0);
  for (let i = 1; i < simple.length; i++) s += "L" + num(simple[i][0] - x0) + " " + num(simple[i][1] - y0);
  return s + "Z";
}).join("");
// A mark that traced to almost nothing is the degenerate-ring bug coming back, and it is
// invisible rather than loud, so it is caught here rather than on the coin.
if (points < loops.length * 8) die("the trace collapsed: " + points + " points across " +
  loops.length + " loops. See the note above rdpRing().");

const vw = x1 - x0 + 1, vh = y1 - y0 + 1;
const out = outArg || path.join(REPO, "src", "vendor", nameArg + "-mark.js");
const body =
  "/* GENERATED by tools/vectorise.mjs from " + path.basename(srcArg) + ". Do not edit.\n" +
  " *\n" +
  " * An outline of the supplied artwork, traced from its pixels rather than redrawn by eye.\n" +
  " * Filled EVEN-ODD in one flat colour, so counters subtract themselves and no winding order\n" +
  " * has to be maintained. Replace with an official vector the day one is available. */\n" +
  "self.MARKS = self.MARKS || {};\n" +
  "self.MARKS[" + JSON.stringify(nameArg) + "] = {\n" +
  "  viewBox: [0, 0, " + vw + ", " + vh + "],\n" +
  "  aspect: " + (Math.round((vw / vh) * 10000) / 10000) + ",\n" +
  "  d: " + JSON.stringify(d) + "\n" +
  "};\n";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body, "utf8");

console.log("traced " + path.basename(srcArg));
console.log("  ground rgb(" + ground.join(",") + "), ink cut at " + Math.round(CUT));
console.log("  " + vw + "x" + vh + " from a " + W + "x" + H + " source, " + loops.length + " loops");
console.log("  tolerance " + TOL + " source px, path " + (d.length / 1024).toFixed(1) + " KB");
console.log("  -> " + path.relative(REPO, out));
