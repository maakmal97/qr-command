/* icons.mjs - the app's own icon set, drawn in the Salt identity (15 Sep 2026).
 *
 *   node tools/icons.mjs          the five icons below
 *   node tools/icons.mjs --tab    favicon-tab.png alone, the coin on a clear ground
 *
 * Writes favicon-32, apple-touch-icon (180), icon-192, icon-512 and icon-maskable-512 into
 * public/. Run by hand when the icon changes, like vectorise.mjs; the build does not touch
 * them. One drawing at every size: an obsidian ground, a coin struck in brass and copper, and
 * on its slate face the eye of a QR code in salt, which is the one shape that says "code"
 * at sixteen pixels. The maskable icon keeps everything inside the inner 80 per cent, which
 * is the safe zone Android crops to; the others fill the square, since iOS rounds it itself.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(HERE, "..", "public");

const OBSIDIAN = "#05080a", SLATE = "#0b1215", BRASS = "#c5a059", COPPER = "#b87333", SALT = "#f2f4f5";

function draw(size, maskable, tab) {
  const cv = createCanvas(size, size);
  const g = cv.getContext("2d");
  /* the browser tab's icon (24 Oct 2026, his word: no black background) is the same coin on a CLEAR ground, drawn larger
     in its canvas so it reads at sixteen pixels; the others keep their obsidian ground, which a home screen would fill black anyway */
  if (!tab) {
    g.fillStyle = OBSIDIAN;
    g.fillRect(0, 0, size, size);
  }

  const c = size / 2;
  const R = size * (tab ? 0.48 : maskable ? 0.36 : 0.42);   // the coin's outer radius
  const rim = R * 0.14;

  // The rim: brass at the top left falling to copper at the bottom right, as every mark does.
  const grad = g.createLinearGradient(c - R, c - R, c + R, c + R);
  grad.addColorStop(0, BRASS);
  grad.addColorStop(1, COPPER);
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();

  // The face.
  g.beginPath();
  g.arc(c, c, R - rim, 0, Math.PI * 2);
  g.fillStyle = SLATE;
  g.fill();

  // The eye: a 7-module finder pattern, 1:1:3:1:1, in salt.
  const eye = (R - rim) * 1.1;          // the eye's full width
  const m = eye / 7;                     // one module
  const x0 = c - eye / 2, y0 = c - eye / 2;
  g.fillStyle = SALT;
  g.fillRect(x0, y0, eye, eye);
  g.fillStyle = SLATE;
  g.fillRect(x0 + m, y0 + m, eye - 2 * m, eye - 2 * m);
  g.fillStyle = SALT;
  g.fillRect(x0 + 2 * m, y0 + 2 * m, eye - 4 * m, eye - 4 * m);
  return cv.toBuffer("image/png");
}

const out = [
  ["favicon-32.png", 32, false],
  ["apple-touch-icon.png", 180, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
];
/* `--tab` writes the tab icon alone: redrawing the others could move bytes the shell cache and the manifest already hold */
if (process.argv.includes("--tab")) {
  fs.writeFileSync(path.join(PUB, "favicon-tab.png"), draw(64, false, true));
  console.log("  wrote favicon-tab.png");
} else {
  for (const [name, size, maskable] of out) {
    fs.writeFileSync(path.join(PUB, name), draw(size, maskable));
    console.log("  wrote " + name);
  }
}
