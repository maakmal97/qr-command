/* mark.mjs - the official DuitNow QR mark, turned into something canvas can draw.
 *
 * Run it when PayNet issues a new logo pack. It reads the OFFICIAL SVG files and writes
 * src/vendor/duitnow-mark.js. The mark is never traced, redrawn or approximated: the path data
 * below is byte for byte what is in the file PayNet supplied, which is the only way to satisfy
 * "use only official logo files provided by PayNet" while still drawing to a canvas.
 *
 *   node tools/mark.mjs
 *
 * The brand guidelines are unusually strict and the relevant rules are quoted into the output
 * so they travel with the data:
 *   DO NOT outline the logo.        DO NOT use shadows or other effects.
 *   DO NOT rotate or stretch it.    DO NOT change the colour of the logo.
 *   DO NOT create unbranded holding shapes.   DO NOT use it as a mask.
 *   Minimum size, digital: 40px width.
 *   Clear space: 1.5X all round, X = height of the letter 'D' in the logotype.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const PACK = process.env.DUITNOW_PACK ||
  "C:/Users/maakm/Claude/Vault/Personal/Cow-Fin05_QR Command/DuitNow Assets";

const die = (m) => { console.error("\nmark.mjs failed: " + m + "\n"); process.exit(1); };

/* The Vault holds the pack as PayNet delivered it, which is a zip. Unpack it here rather than
 * asking anyone to extract it by hand, so the archive stays the one copy and there is no loose
 * second version to drift from it. */
function svgDir() {
  const direct = path.join(PACK, "DuitNow QR-Logo-v2", "DuitNow QR Logo", "SVG");
  if (fs.existsSync(direct)) return direct;

  const zip = path.join(PACK, "DuitNow QR-Logo-v2.zip");
  if (!fs.existsSync(zip)) die("cannot find the logo pack, as a folder or as " + zip);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duitnow-"));
  let unpacked = false;
  for (const attempt of [
    () => execFileSync("tar", ["-xf", zip, "-C", tmp], { stdio: "pipe" }),
    () => execFileSync("powershell", ["-NoProfile", "-Command",
      "Expand-Archive -LiteralPath '" + zip + "' -DestinationPath '" + tmp + "' -Force"], { stdio: "pipe" }),
  ]) {
    try { attempt(); unpacked = true; break; } catch (e) { /* try the next */ }
  }
  if (!unpacked) die("could not unpack " + zip + " with either tar or Expand-Archive");

  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^01_DuitNowQR Logo_BLK\.svg$/i.test(e.name)) found.push(path.dirname(p));
    }
  })(tmp);
  if (!found.length) die("the pack unpacked but has no 01_DuitNowQR Logo_BLK.svg in it");
  return found[0];
}

const SVG_DIR = svgDir();

function readSvg(file) {
  const p = path.join(SVG_DIR, file);
  if (!fs.existsSync(p)) die("cannot find the official asset " + p);
  const s = fs.readFileSync(p, "utf8");
  const vb = (s.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) die(file + " has no viewBox");
  /* Each path keeps ITS OWN colour. The brand graphic is three colours at once: white for the
   * container, ruby for the logomark, black for the logotype. That combination is the point,
   * because it is one of the three the palette page sanctions. Flattening it to a single fill
   * would be "changing the colour of the logo". */
  const classFill = {};
  const style = (s.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  for (const m of style.matchAll(/\.([A-Za-z0-9_-]+)\s*\{\s*fill:\s*([^;\s}]+)/g)) {
    classFill[m[1]] = m[2].toLowerCase();
  }
  const norm = (c) => (c === "#fff" ? "#ffffff" : c === "#000" ? "#000000" : c);
  const ds = [...s.matchAll(/<path([^>]*?)\sd="([^"]+)"/g)].map((m) => {
    const attrs = m[1];
    const cls = (attrs.match(/class="([^"]+)"/) || [])[1];
    const direct = (attrs.match(/fill="([^"]+)"/) || [])[1];
    // A path with no fill declared is black by default, which is what the logotype relies on.
    return { d: m[2], fill: norm((direct || (cls && classFill[cls]) || "#000000").toLowerCase()) };
  });
  if (!ds.length) die(file + " has no paths");
  const fills = [...new Set(ds.map((x) => x.fill))];
  // Anything beyond plain filled paths would not survive being drawn as Path2D, so refuse
  // rather than ship a mark that is subtly wrong.
  for (const feature of ["linearGradient", "radialGradient", "clipPath", "mask", "<image", "filter"]) {
    if (s.includes(feature)) die(file + " uses " + feature + ", which this route cannot reproduce faithfully");
  }
  return { file, viewBox: vb.trim().split(/\s+/).map(Number), paths: ds, fills };
}

/* THE BRAND GRAPHIC, not the bare logo, and that is the whole point of this file.
 *
 * The coin's face is a different brand colour for every account. Dropping a bare mark onto it
 * breaks two stated rules at once: "DO NOT create unbranded holding shapes for the logo", since
 * a plain coloured disc with a logo centred on it is exactly that; and the palette rule that the
 * official combinations are "White on ruby", "White or/and ruby on black" and "Black or/and ruby
 * on white", none of which is a white mark on Maybank gold.
 *
 * Section 1.4.2 (a) supplies the answer directly: the brand graphic is to be used "as a
 * container for the DuitNow/sub-brand logos". Inside it the logo sits on white, which IS a
 * sanctioned combination, and the only thing touching the account's colour is PayNet's own
 * container. The 1.5X clear space is already built into the file, so it must never be re-inset. */
const blk = readSvg("03_DuitNowQR Logo Brand Graphic_CLR.svg");
const clr = blk;

if (!blk.fills.includes("#ffffff")) die("the brand graphic has no white container path in it");
if (!blk.fills.some((f) => f !== "#ffffff" && f !== "#000000")) die("the brand graphic has lost its ruby");
if (Math.abs(blk.viewBox[2] / blk.viewBox[3] - 1) > 0.02) die("the brand graphic is no longer square");

const out = `/* duitnow-mark.js - GENERATED by tools/mark.mjs. Do not edit.
 *
 * The official DuitNow QR logo, path for path, from the pack PayNet supplied:
 *   ${blk.file}
 * White container, ruby logomark, black logotype, each path in its own official colour.
 *
 * THE BRAND GUIDELINES ARE STRICT, and this is the whole of what they allow (v2.0, section
 * 1.1.2 "DuitNow QR", pages 6, 7 and 19):
 *   "DO NOT outline the logo"          "DO NOT use shadows or other effects"
 *   "DO NOT rotate the logo"           "DO NOT stretch the logo"
 *   "DO NOT change the colour of the logo"
 *   "DO NOT create unbranded holding shapes for the logo"
 *   "DO NOT use the logo as a mask"    "DO NOT change the typeface used for the wordmark"
 *   Minimum size, digital: 40px width.
 *   Clear space: 1.5X all round, where X = the height of the letter 'D' in the logotype.
 *
 * THIS IS THE BRAND GRAPHIC, the container the guidelines supply for exactly this situation,
 * not the bare logo. Section 1.4.2 (a): "Use as a container for the DuitNow/sub-brand logos".
 * Inside it the logo sits on white, which is one of the three sanctioned combinations, and the
 * only thing touching the account's own colour is PayNet's container. A bare mark dropped onto
 * a gold or navy disc would break two rules at once: the unbranded-holding-shape rule, and the
 * palette rule that the official combinations are "White on ruby", "White or/and ruby on black"
 * and "Black or/and ruby on white", none of which is a white mark on Maybank gold.
 *
 * It is drawn flat, at its own aspect ratio, each path in the colour the official file gives
 * it. It is NOT embossed, unlike the account number beneath it, which is our own typography and
 * ours to treat. The 1.5X clear space is already built into this file, so it is never re-inset.
 */
self.DuitNowMark = {
  viewBox: [${blk.viewBox.join(", ")}],
  aspect: ${(blk.viewBox[2] / blk.viewBox[3]).toFixed(6)},          // width / height
  /* Each path with the colour the official file gives it: white container, ruby logomark,
   * black logotype. Filled in that order, exactly as supplied. */
  paths: ${JSON.stringify(blk.paths, null, 2).split("\n").join("\n  ")},

  /* The palette, recorded so nobody has to guess it. */
  black: "#000000",
  white: "#ffffff",
  ruby: ${JSON.stringify(clr.fills.find((f) => f !== "#000000" && f !== "#ffffff") || "#e5005b")},

  /* The 1.5X clear space is INSIDE this artwork already: the logo is inset 41.68 units within a
   * 256.63 unit graphic, which is 1.5X to within four hundredths of a unit. Do not add to it,
   * do not crop it. What is left to us is the band of undisturbed metal OUTSIDE the container,
   * kept at a quarter of its width so it matches the internal proportion. */
  xRatio: 0.166,
  clearRatio: 0.25,

  /* 40px is the logo's minimum width, and the logo occupies 164.65 of the graphic's 256.63
   * units, so the CONTAINER must be at least 40 * 256.63 / 164.65 = 62.3px wide for the logo
   * inside it to clear that floor. Rounded up. */
  minWidthPx: 64
};
`;

const dest = path.join(REPO, "src", "vendor", "duitnow-mark.js");
fs.writeFileSync(dest, out.replace(/\r\n/g, "\n"), "utf8");
console.log("wrote src/vendor/duitnow-mark.js");
console.log("  from   " + blk.file);
console.log("  paths  " + blk.paths.length + " in " + blk.fills.length + " colours (" + blk.fills.join(", ") + ")");
console.log("  viewBox " + blk.viewBox.join(" "));
console.log("  ruby   " + (clr.fills.find((f) => f !== "#000000" && f !== "#ffffff") || "?"));
