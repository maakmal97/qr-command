# QR Command: how the rules are built

`CLAUDE.md` carries the rules; this file carries the mechanism and the measured numbers behind
them, moved out on 16 Sep 2026 under the root token test. Read on demand. `docs/NOTES.md`
stays the verbatim reasoning of 6 Sep 2026 and is not edited.

## The renderer, `src/app/qr-art.js`

Every number here is re-asserted by `npm test`.

- **Error correction M**: the worst code read down to 370 px at M against 880 at H.
- **`safePhysicalPx` is 580 physical px**: measured floor 380 with the lens, 440 without, plus
  half again.
- Module edges snap to whole device pixels. The eyes depart from the matrix only at their
  outer diagonal corners; the 1:1:3:1:1 finder ratio is measured from painted pixels; the
  pupil is a rounded square at 1.68.
- **The lens**: disc at `lensScale` 0.78; arcs, ring and stars come from
  `randOf(seedOf(key))`; both faces share one diameter. The rim glow is clipped out of the light
  field; the shadow is `filter: drop-shadow` from alpha; a gradient field cost 1,244 KB against
  45 KB flat; `draw()` reports `meta.grid` from the options it actually used.
- `drawCard` renders 1,200 px for the gallery; the suite decodes every card and one halved to
  700 px.
- **Timings**: 4.8 ms to encode against 2 ms to draw, so encoding is cached in `plan()` (a coin
  went 6.8 to 1.59 ms). One `Path2D` for all modules cost 25.8 ms against 1.84 ms for individual
  fills.
- **`drawPlate()`**: a paper face in the code coin's field and ink (luminance asserted), rows
  BANK and RECEIVER, marks traced by `tools/vectorise.mjs` in place of names (owner, 26 Aug
  2026), width-matched, flat, even-odd. `ring` strikes the band in a second colour (JPMorgan
  brown `#5B2F12` measured from the artwork, Wise green ring); the rim and face use separate
  palettes, asserted from pixels. The suite passes `Path2D` into the renderer scope, and proves
  a mark painted by diffing with and without. Since 15 Sep 2026 it paints only the suite's
  renders, never the list.

## The rails, the plate and the badge

- **One face since 25 Aug 2026**: `drawBack`, `drawMark`, the flip and PayNet's artwork are
  removed completely, asserted as complete.
- **`fillPlate()`** writes a plate into `#plate` from the record: BANK and ACCOUNT (spaced in
  fours, RECEIVER when `holder` is set) on Transfer; BILLER CODE, REF-1 and REF-2 `-` on
  JomPAY. The toast names the label.
- **A rail is derived**: `qr` = payload, `transfer` = bank and number, `jompay` = biller code
  and Ref-1. An account reached by hash that is not on the chosen rail shows the first rail it
  is on. `body[data-view]` switches the coin and the plate; only a coin flies, a plate fades in.
  `setRail()` redraws.
- **A payer's link** (24 Sep 2026): `linkOf()` reads `#<key>/<rail>/<amount>/<reference>`;
  `route()` makes a named rail the mode where the account is on it, and `fillDue()` writes AMOUNT
  (`RM 70.00`, copying `70.00`) and REFERENCE into `#due` under the coin or the plate, through the
  plate's own `fillRows()`, on the linked account only and never on a suspended one.
- **The badge** (`drawBadge()`, struck by `drawThumbs()` on any rail but QR): the brand disc
  carrying the institution's traced `bankMark` through `QRArt.drawMark` where one exists, else
  initials derived from `name` (`initialsOf()`: up to three words' initials, or the first two
  letters of one word). The code-less account wears it too since 15 Sep 2026.
- **Marks**: the build blanked `bankMark` on code accounts until 15 Sep 2026, so the live badges
  showed initials while the marks sat loaded. Each is traced from the logo on the institution's
  own website on the owner's instruction. The tracer keeps one ink: a two-colour logo is
  flattened to black on white first, as Setel's and Instapay's were; Maybank's is the corporate
  tiger-and-wordmark SVG from maybank.com, whose yellow ground was dropped, reached through the
  browser pane because the site's bot protection refuses curl. Both Touch 'n Go accounts share
  `tng`.
- **`bank`** is the institution's name as the DuitNow list has it (the member code the store
  keeps as `mid`; Touch 'n Go and Touch 'n Go Business share 890053, told apart by the `tag`
  sub-line). The chip row wraps and `overflow-x:auto` is asserted absent.

## Suspended accounts, and following the build

- A suspended account's canvases are cleared to 8x8, `prerender()` is null, and there is no
  miniature. `drawThumbs` once only skipped, and GX Bank showed a readable code on a suspended
  tile (3 Sep 2026).
- `localStorage` `pay-state` is restored before the first frame and is what an offline phone
  reads; the baked `maintenance` flag matters only on a first-ever open.
- `followBuild()` (owner, 15 Sep 2026) reads `/rev.json` on load and on every return to the
  front; the id is remembered in `pay:reloaded` first. The service worker already
  `skipWaiting`s and claims, so the reload lands on the new bundle.

## The edit surface, `/admin/`

- `identity()` in `src/worker.js` verifies RS256 against
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, with issuer, audience and expiry,
  from the `CF_Authorization` cookie or the `Cf-Access-Jwt-Assertion` header, on `/admin`,
  `/admin/*` and `/api/*`. The suite mints tokens with its own key pair and breaks them eight
  ways.
- **The Access application** is Self-hosted, domain the workers.dev host, path `admin`, policy
  Allow for the owner's address.
- `src/app/admin.html` ships as `public/admin/index.html`; `admin.js` is stamped, never
  precached. Rows drag by the handle or move with the arrow keys; Hidden/Shown per row; one
  Save. The public page's `Sign in` is a plain link to `/admin/`.
- **Retired with the laptop master (8 Sep 2026):** `maintenance.py`, `push_kv`,
  `deploy_runner.py`, the laptop's design sync (not today's `tools/designsync.mjs`),
  `QR_MASTER`. Nothing deploys after a state change.

## Motion and layout

- Two tiers: `--dur`/`--ease` 300 ms `cubic-bezier(.22,.8,.36,1)` for screens, zoom and flip;
  `--dur-fast`/`--ease-fast` 140 ms `cubic-bezier(.22,1,.36,1)` for anything answering a
  finger. `cssMs()` reads them once; the press-and-hold threshold is not derived from them.
- `visibility` is delayed by the duration; `depth` counts our own entries; thumbnails are
  `decorative: true` exactly once and drawn together at startup.
- The aurora is two gradient layers cross-faded, no filter; the coin transitions `transform`
  only with `will-change`; a step pre-renders offscreen.
- One column of rows, 72 px, coin left and the institution's name beside it in mono caps, a
  `tag` sub-line under it (owner, 14 Sep 2026; the two-column tile grid and the featured
  full-width JPMorgan row are gone); rows fixed so the list scrolls (owner, 25 Aug 2026).
  `orderTiles()` renumbers `--i`; `.accounts` adds the safe-area insets back with `calc()`;
  closing scrolls the tile into view with `block:"nearest"`; `.tiledot` is
  `border-radius:50%` until `.drawn`.
- **Saving**: a dismissed share sheet rejects with `AbortError`, a cancel, not a failure; a
  swipe and a long press each swallow the click that follows, or one gesture saves twice. A
  FLIP element gets its starting transform before its first paint, or it flashes full size.

## The iPhone standard (28 Aug 2026)

Bare `env()` is zero on desktop and cannot be measured, so a probe forces 59 px and 34 px.
The laptop master's `edit.html` missed the standard and was fixed 2 Sep 2026.

## Files, beyond the ones `CLAUDE.md` names

| Path | What it is |
|---|---|
| `src/worker.js` | The Worker. Serves `public/` and sets every security header itself |
| `src/app/admin.html`, `admin.js` | The edit surface, shipped under `/admin/` |
| `src/app/app.css` | The Salt identity from `Code\salt-ds`, tokens generated (`CLAUDE.md` rule 7), the rest this app's own: obsidian ground, one copper-and-brass aurora for every account, mono caps for every label and control, Fraunces for the two sentences, ghosts everywhere and one brass-to-copper pill (admin Save). Fraunces and JetBrains Mono ship from `src/app/fonts/` under `font-src 'self'`. The page no longer takes its light from the account; the coin alone carries the brand |
| `src/app/app.js` | The app: rail, keyboard, swipe, hash, per-account tuning |
| `src/app/sw.js` | Service worker template; `__BUILD__` and `__SHELL__` stamped by the build |
| `src/vendor/qrcode.js` | The encoder, copied from the retired laptop master unchanged |
| `tools/vectorise.mjs` | Bitmap logo in, path data out; run by hand when a mark is added |
| `tools/icons.mjs` | The app's own icon set, the Salt coin with a code's eye, written into `public/` by hand; the build does not touch the PNGs. Title and manifest name are "QR Command" (owner, 15 Sep 2026; was "Pay") |
| `tools/build.mjs` | `data/accounts.json` in, `public/` out, with the leak check and the disclosure |
| `public/marks.js` | Every traced mark in one file |
| `test/verify.mjs` | The whole suite, no network, no browser |
| `wrangler.jsonc` | Worker, assets, one KV namespace (`QR_STATE`, written only by `/api/state`), vars `ACCESS_TEAM` and `ACCESS_AUD`; no secrets |
