#!/usr/bin/env node
/* designsync.mjs: the identity's tokens in app.css are the design system's own, never a copy typed here.
 *
 * Pay applies salt-ds by hand, because nothing here may load off another origin, and until 22 Sep
 * 2026 its :root carried eight of the identity's colours transcribed, so a retune upstream never
 * reached it and the two drifted (the hairline "strong" alpha was named here and nowhere else).
 * The :root block of Code/salt-ds/src/styles.css is now written into src/app/app.css between two
 * markers, exactly as salt-command's master carries the whole stylesheet and the statements site
 * carries the same block, and the build refuses to ship while the copy differs from the file.
 *
 *   node tools/designsync.mjs --pull     write the block from ../salt-ds (or $SALT_DS)
 *   node tools/designsync.mjs --check    non-zero if the block is not the design system's :root
 *
 * THE FILE IS THE SOURCE. Edit the design system, --pull, build. An edit inside the markers is
 * overwritten by the next --pull and fails --check until then. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_CSS = resolve(REPO, "src", "app", "app.css");
const DS_ROOT = resolve(process.env.SALT_DS || resolve(REPO, "..", "salt-ds"));
const DS_SRC = resolve(DS_ROOT, "src", "styles.css");
const DS_FONTS_CSS = resolve(DS_ROOT, "src", "fonts-local.css");
const DS_FONTS = resolve(DS_ROOT, "src", "fonts");   /* beside fonts-local.css since 22 Sep 2026 */
/* The brand faces (22 Sep 2026): the design system's files, copied into src/app/fonts/ by --pull,
   built into public/fonts/, hashed into the build id and precached with the shell. */
export const FONT_FILES = ["fraunces-latin.woff2", "jetbrains-mono-latin.woff2"];
const APP_FONTS = resolve(REPO, "src", "app", "fonts");
export const BEGIN = "/* ==== DESIGN tokens: generated from Code/salt-ds src/styles.css (:root) by tools/designsync.mjs --pull. Edit the design system, --pull; never this block. ==== */";
export const END = "/* ==== END DESIGN tokens ==== */";

/** The design system's :root block, verbatim, or null when the system is not on this machine. */
export function tokens() {
  if (!existsSync(DS_SRC)) return null;
  const css = readFileSync(DS_SRC, "utf8").replace(/\r\n/g, "\n");
  const m = /:root\s*\{[\s\S]*?\n\}/.exec(css);
  if (!m) throw new Error("designsync: no :root block in " + DS_SRC);
  /* the faces' @font-face rules follow the tokens, each file stamped with the build so the stylesheet
     and the shell's precache name the same URL */
  const fonts = readFileSync(DS_FONTS_CSS, "utf8").replace(/\r\n/g, "\n")
    .replace(/url\(fonts\/([^)]+)\)/g, "url(./fonts/$1?v=__BUILD__)");
  if (/https?:\/\//.test(fonts)) throw new Error("designsync: fonts-local.css names another origin");
  return m[0] + "\n" + fonts.trim();
}

/** True when every font file in src/app/fonts/ is the design system's, byte for byte. */
export function fontsMatch() {
  return FONT_FILES.every((f) => {
    const mine = resolve(APP_FONTS, f);
    return existsSync(mine) && readFileSync(mine).equals(readFileSync(resolve(DS_FONTS, f)));
  });
}

function locate(css) {
  const i = css.indexOf(BEGIN);
  if (i < 0) return null;
  const j = css.indexOf(END, i);
  if (j < 0) throw new Error("designsync: begin marker without an end marker");
  if (css.indexOf(BEGIN, i + 1) >= 0) throw new Error("designsync: the begin marker appears twice");
  return { i, j: j + END.length };
}

/** The block app.css carries now, between the markers, or null. */
export function carried() {
  const css = readFileSync(APP_CSS, "utf8").replace(/\r\n/g, "\n");
  const at = locate(css);
  return at ? css.slice(at.i + BEGIN.length + 1, at.j - END.length - 1) : null;
}

/** True when the block in app.css is the design system's :root. Throws when the system is absent. */
export function matches() {
  const want = tokens();
  if (want == null) throw new Error("designsync: no design system at " + DS_SRC + " (set SALT_DS)");
  return carried() === want;
}

function main() {
  const mode = process.argv[2] || "--check";
  if (mode === "--pull") {
    const want = tokens();
    if (want == null) { console.log("  FAIL  no design system at " + DS_SRC + " (set SALT_DS)"); process.exit(1); }
    const css = readFileSync(APP_CSS, "utf8").replace(/\r\n/g, "\n");
    const at = locate(css);
    if (!at) { console.log("  FAIL  app.css carries no DESIGN tokens markers"); process.exit(1); }
    writeFileSync(APP_CSS, css.slice(0, at.i) + BEGIN + "\n" + want + "\n" + END + css.slice(at.j), "utf8");
    console.log("  ok    pulled " + want.split("\n").length + " lines of tokens and faces into src/app/app.css");
    mkdirSync(APP_FONTS, { recursive: true });
    for (const f of FONT_FILES) copyFileSync(resolve(DS_FONTS, f), resolve(APP_FONTS, f));
    console.log("  ok    pulled " + FONT_FILES.length + " font files into src/app/fonts/");
  } else if (mode === "--check") {
    if (!matches()) {
      console.log("  FAIL  the tokens in src/app/app.css are not the design system's :root; run: node tools/designsync.mjs --pull");
      process.exit(1);
    }
    if (!fontsMatch()) {
      console.log("  FAIL  src/app/fonts/ is not the design system's fonts/; run: node tools/designsync.mjs --pull");
      process.exit(1);
    }
    console.log("  ok    src/app/app.css carries the design system's tokens and faces, and src/app/fonts/ its files, byte for byte");
  } else {
    console.log("usage: node tools/designsync.mjs [--pull|--check]");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
