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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_CSS = resolve(REPO, "src", "app", "app.css");
const DS_SRC = resolve(process.env.SALT_DS || resolve(REPO, "..", "salt-ds"), "src", "styles.css");
export const BEGIN = "/* ==== DESIGN tokens: generated from Code/salt-ds src/styles.css (:root) by tools/designsync.mjs --pull. Edit the design system, --pull; never this block. ==== */";
export const END = "/* ==== END DESIGN tokens ==== */";

/** The design system's :root block, verbatim, or null when the system is not on this machine. */
export function tokens() {
  if (!existsSync(DS_SRC)) return null;
  const css = readFileSync(DS_SRC, "utf8").replace(/\r\n/g, "\n");
  const m = /:root\s*\{[\s\S]*?\n\}/.exec(css);
  if (!m) throw new Error("designsync: no :root block in " + DS_SRC);
  return m[0];
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
    console.log("  ok    pulled " + want.split("\n").length + " lines of tokens into src/app/app.css");
  } else if (mode === "--check") {
    if (!matches()) {
      console.log("  FAIL  the tokens in src/app/app.css are not the design system's :root; run: node tools/designsync.mjs --pull");
      process.exit(1);
    }
    console.log("  ok    src/app/app.css carries the design system's tokens, byte for byte");
  } else {
    console.log("usage: node tools/designsync.mjs [--pull|--check]");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
