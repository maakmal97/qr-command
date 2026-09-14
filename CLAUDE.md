# QR Command

Standing facts only. Root `CLAUDE.md` governs voice, structure, verification and
precedence; this file adds what a session here would otherwise rediscover, and
never repeats a root rule. British English, no em-dashes, in files, code and copy.
Correct stale facts in place; the dated record is the project changelog / journal.
Set 6 Sep 2026. Ceiling 15 KB.

The payment-QR consolidator on the phone: a Cloudflare Worker serving a static bundle built
from `data/accounts.json` in this repo. Two screens: the accounts list, and one account shown
the way the chosen rail pays it: on QR a code drawn on the device as a struck coin held in a
gravitational lens (one side, a tap saves it), on Transfer the bank and the number, on JomPAY
the biller code and the references, each value copying on a tap (owner, 14 Sep 2026). Since
8 Sep 2026 there is one edit surface, `/admin/`, behind Cloudflare Access, for the two things
that change: which accounts are shown and what order they stand in. The reasoning and the
measurements behind every line below are in `docs/NOTES.md`.

## Hard rules

1. **`public/` is build output.** A hand edit there is overwritten by `npm run build` and
   the suite fails meanwhile because the build id no longer hashes the files on disk.
   **The store is `data/accounts.json`, committed** (owner, 8 Sep 2026; the laptop master
   `Code\pay-afif-site` is retired and this private repo is the store's only home). Adding
   or removing an account is an edit there, `npm run deploy`, nothing else.
2. **Never rewrite a `payload` string.** The trailing four characters are a CRC, so a
   tidied payload can still scan and pay somebody else. The build copies and checks;
   it never repairs. A payload is never typed into a page: `/admin/` cannot add an account.
3. **Payload validation is `tools/store.js`,** one copy, imported by build and suite, never
   reimplemented: a third copy once rejected all thirteen live payloads over a guessed prefix.
4. **The bundle carries fourteen fields:** `key`, `name`, `brand`, `payload`, `acct`,
   `maintenance`, `bank`, `holder`, `bankMark`, `holderMark`, `tag`, `ring`, `biller`, `ref1`.
   Owner, group and DuitNow member number stay in the repo and never ship. Build and suite
   search `public/` for every dropped value, and assert every account number IS there. A new
   field is added in `SHIP` in `tools/build.mjs` and nowhere else.
   - `acct` ships (owner, 11 Aug 2026): every account number is readable as text by
     anyone with the address. The build prints that disclosure on every run.
   - `holder` is the beneficiary, never the owner. The owner's name, by exact string or
     by twelve-character stem, kills the build; the sanctioned name is pinned to exactly
     once per entitled record in `data.js`. Keys are provider-named; a person-named slug
     kills the build (a truncated slug of the payee got through once, 13 Aug 2026). A
     `holder` on a code account kills the build too.
5. **The name is inside the codes** (EMVCo tag 59, and tag 26 carries the account id in
   the clear for six of them). Not this repo's to fix; the leak check strips payloads
   before searching.
6. **No dependency reaches the browser.** CSP `default-src 'none'`, `script-src 'self'`,
   no `unsafe-inline`; an inline script or a `style=` attribute is a blank page and the
   build refuses it. Logos are `Path2D` data, never rasters, because `img-src` refuses
   `data:` and the suite asserts it still does.

## The renderer, `src/app/qr-art.js`

Every number here is re-asserted by `npm test`.

- **Error correction M.** Higher adds modules and shrinks each; the worst code read down
  to 370 px at M against 880 at H. Master, card and phone agree on M.
- **Below `safePhysicalPx` (580 physical px) the plain code is drawn instead.** Measured
  floor 380 with the lens, 440 without, plus half again. The suite downscales to the size
  the glass would show before decoding; decoding the backing store passes vacuously.
- Module edges snap to whole device pixels. The eyes depart from the matrix only at their
  outer diagonal corners; the 1:1:3:1:1 finder ratio is measured from painted pixels;
  the pupil is a rounded square at 1.68.
- **The lens.** Disc at `lensScale` 0.78; arcs, ring and stars come from
  `randOf(seedOf(key))`, `Math.random` appears nowhere; both faces share one diameter.
  Nothing is painted over the light field (the rim glow is clipped out of it); the canvas
  stays transparent outside the artwork and carries no `border-radius`; the shadow is
  `filter: drop-shadow` from alpha; the field is flat (a gradient cost 1,244 KB against
  45 KB); `draw()` reports `meta.grid` from the options it actually used.
- `drawCard` renders 1,200 px for the gallery; the suite decodes every card and one
  halved to 700 px.
- **Encoding is cached in `plan()`**: 4.8 ms to encode against 2 ms to draw; a coin went
  6.8 to 1.59 ms. Never batch modules into one `Path2D`: 25.8 ms against 1.84 ms for
  individual fills, asserted.
- **Code-less accounts** draw `drawPlate()`: a paper face in the code coin's field and
  ink (luminance asserted), rows BANK and RECEIVER, marks traced by `tools/vectorise.mjs`
  in place of names (owner, 26 Aug 2026), width-matched, flat, even-odd. `ring` strikes
  the band in a second colour (JPMorgan brown `#5B2F12` measured from the artwork, Wise
  green ring); the rim and face use separate palettes, asserted from pixels. `drawPlate`
  never reads `acct` and never draws the DuitNow mark, asserted on its body. The suite
  passes `Path2D` into the renderer scope, and proves a mark painted by diffing with and
  without. Values wrap by rendered width, never shrink past legibility.
- An empty payload decodes to `""` and passes; the suite walks `codes` only, `plates`
  separately. `filter(Boolean)` on the payload list is load-bearing in `build.mjs`,
  `verify.mjs` and `live.mjs`.

## The number, the rails, maintenance

- **One face since 25 Aug 2026.** `drawBack`, `drawMark`, the flip and PayNet's artwork are
  removed completely, asserted as complete. The coin never carries the number.
- **The number is on screen again, on the Transfer view only (owner, 14 Sep 2026,
  reversing 25 Aug).** `fillPlate()` writes a plate into `#plate` from the record: BANK and
  ACCOUNT (spaced in fours, RECEIVER when `holder` is set) on Transfer; BILLER CODE, REF-1
  and REF-2 `nil` on JomPAY. Each value is a button that copies through the one
  `copyValue(value, label)`; the toast names the label. Nothing hands the number to a
  renderer, asserted. A suspended account empties the plate and refuses to copy.
- **The rail is a mode (14 Sep 2026), not only a filter.** Three rails, DuitNow QR,
  DuitNow Transfer, JomPAY, no "All". A rail is a property of an account, derived never
  stored (`qr` = payload, `transfer` = bank and number, `jompay` = biller code and Ref-1).
  The chosen rail filters the list and decides what an opened account shows (`viewOf()`;
  an account reached by hash that is not on the rail shows the first rail it is on); it is
  remembered in `localStorage` `pay:rail`, default QR. `body[data-view]` switches the coin
  and the plate; only a coin flies, a plate fades in. Steps and swipes walk `shownOrder`,
  the visible tiles in display order, never the build order. Chips filter by hiding, never
  rebuilding, so `tiles[i]` stays aligned with `CODES[i]`; the chip row wraps and
  `overflow-x:auto` is asserted absent. `bank` ships for every account and is what the row
  and the plate show: the institution's name as the DuitNow list has it (the member code
  the store keeps as `mid`; Touch 'n Go and Touch 'n Go Business share 890053, told apart
  by the `tag` sub-line).
- **Suspended accounts draw no code at all:** canvases cleared to 8x8, `prerender()`
  null, no miniature, copy and save refused. Three sources, in this precedence:
  `/state.json` from KV first (seconds, no deploy), the state this phone last read from it
  (`localStorage` `pay-state`, restored before the first frame, what an offline phone
  reads), the baked `maintenance` flag last (only a first-ever open). A failed fetch leaves
  the override untouched; only booleans on known keys are trusted, and only known keys in
  the order. `/state.json` is `no-store` and bypassed by the service worker, as are
  `/admin/` and `/api/`. `drawThumbs` runs on every state change and must CLEAR a suspended
  tile's miniature (`el.width = 8`); it only skipped, and GX Bank showed a readable code on
  a suspended tile (3 Sep 2026).

## The edit surface, `/admin/` (8 Sep 2026)

- **One value in KV, `state`:** `{maintenance: {key: bool}, order: [keys], at}`. Written by
  `POST /api/state`, read by `/state.json`. The admin writes it COMPLETE: every account gets
  a boolean and the order names every key, so after the first save the baked flag is moot.
- **The gate is the token, not the header.** `identity()` in `src/worker.js` verifies the
  Access JWT (RS256 against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`,
  issuer, audience, expiry) from the `CF_Authorization` cookie or the
  `Cf-Access-Jwt-Assertion` header, on `/admin`, `/admin/*` and `/api/*`. The suite mints
  tokens with its own key pair and breaks them eight ways. **Fails closed:** `ACCESS_TEAM`
  and `ACCESS_AUD` empty in `wrangler.jsonc` means every gated route is 401 and nothing
  is written. Neither variable is a secret; there are no secrets in this Worker.
- **The Access application** is Self-hosted, domain the workers.dev host, path `admin`,
  policy Allow for the owner's address. `QR_STATE.put` appears exactly once, after the
  identity check, asserted.
- `src/app/admin.html` ships as `public/admin/index.html`; `admin.js` is stamped, never
  precached. Rows drag by the handle or move with the arrow keys; Hidden/Shown per row;
  one Save. The page reads `/state.json` and `/api/me` and writes `/api/state`, nothing
  else, asserted. The public page's `Sign in` is a plain link to `/admin/`.
- **Retired with the laptop master:** `maintenance.py`, `push_kv`, `deploy_runner.py`, the
  design sync, `QR_MASTER`. Nothing deploys after a state change any more.

## Motion, zoom, layout

- Two tiers: `--dur`/`--ease` 300 ms `cubic-bezier(.22,.8,.36,1)` for screens, zoom and
  flip; `--dur-fast`/`--ease-fast` 140 ms `cubic-bezier(.22,1,.36,1)` for anything
  answering a finger. `cssMs()` reads them once; the press-and-hold threshold is not
  derived from them.
- Both views are always laid out and cross-faded by opacity, `visibility` delayed by the
  duration; never `display`. The hash is the only state; `depth` counts our own entries.
- Nothing waits on `animationend` (reduced motion collapses `after()` to zero); one-shot
  classes remove themselves via `oneShot()`; `morph()` and `fly()` take rects measured
  while their view is visible; `goBack()` renders the list before measuring; thumbnails
  are `decorative: true` exactly once and drawn together at startup.
- The aurora is two gradient layers cross-faded, no filter; the coin transitions
  `transform` only with `will-change`; a step pre-renders offscreen.
- One column of rows, 72 px, coin left and the institution's name beside it in mono caps,
  a `tag` sub-line under it (owner, 14 Sep 2026; the two-column tile grid and the featured
  full-width JPMorgan row are gone, no account is featured); rows fixed so the list scrolls
  (owner, 25 Aug 2026); store order until `/admin/` sets one; suspended accounts sink at run
  time through `orderTiles()`,
  which moves rather than rebuilds and renumbers `--i`; `classOf()` is the one place a
  tile's classes are built; `--thumb` and `THUMB` are one number, 56 px; `.accounts` adds
  the safe-area insets back with `calc()`; closing scrolls the tile into view with
  `block:"nearest"`; `.tiledot` is `border-radius:50%` until `.drawn`. No pill, no title
  above the coin, no Save button: press-and-hold saves and `.tuck` plays.
- `shipped[0]` is not necessarily a code; tests use `codes[0]`.

## Files

| Path | What it is |
|---|---|
| `src/worker.js` | The Worker. Serves `public/` and sets every security header itself |
| `data/accounts.json` | **The store.** Committed; every private field lives here and only here |
| `tools/store.js` | The validator, one copy, imported by build and suite |
| `src/app/index.html` | Markup only, no inline script or style |
| `src/app/admin.html`, `admin.js` | The edit surface, shipped under `/admin/` |
| `src/app/app.css` | The Salt identity (14 Sep 2026), applied by hand from `Code\salt-ds`: obsidian ground, one copper-and-brass aurora for every account, mono caps for every label and control, Fraunces for the two sentences, ghosts everywhere and one brass-to-copper pill (admin Save). No web fonts under the self-only CSP, so Georgia and a system mono stand in. The page no longer takes its light from the account; the coin alone carries the brand |
| `src/app/app.js` | The app: rail, keyboard, swipe, hash, per-account tuning |
| `src/app/qr-art.js` | The coin and `drawCard`. Read the note at the top first |
| `src/app/sw.js` | Service worker template; `__BUILD__` and `__SHELL__` stamped by the build |
| `src/vendor/qrcode.js` | The encoder, copied from the master unchanged |
| `src/vendor/*-mark.js` | **Generated, do not edit.** Traced logos registering on `self.MARKS` |
| `tools/vectorise.mjs` | Bitmap logo in, path data out; run by hand when a mark is added |
| `tools/build.mjs` | Master store in, `public/` out, with the leak check and the disclosure |
| `public/marks.js` | Every traced mark in one file |
| `test/verify.mjs` | The whole suite, no network, no browser |
| `test/vendor/jsqr.js` | The decoder, **test only, never shipped** |
| `public/` | Build output, committed so the deployed bytes are the reviewed bytes |
| `wrangler.jsonc` | Worker, assets, one read-only KV namespace; no secrets, no vars |
| `docs/NOTES.md` | The reasoning behind this file, verbatim |

## Working on it

```
npm run build     # data/accounts.json -> public/
npm test          # about 180 assertions, ten seconds, no network
npm run check     # both
npm run dev       # build, then wrangler dev
npm run deploy    # build, test, then wrangler deploy; the test is not optional
```

Things that bite:

- `compatibility_date` must not exceed the installed runtime: wrangler 4.120.0 tops out
  at 2026-08-08.
- **Never edit these files through a shell heredoc.** The Bash tool collapses one level
  of backslash, so `"\x00"` arrives as a literal NUL and the file still parses. Twice
  bitten; the suite sweeps every file for control bytes. Use the editing tools.
- The suite decodes about a thousand renders per run. Do not trim the size sweep.
- The saved image uses `toDataURL`, not `toBlob`: iOS allows `navigator.share` only
  inside the gesture, and awaiting `toBlob` loses it silently. `cardOf()` is synchronous
  and cached, asserted.

## Deploying

`npm run deploy`; no setup beyond a Cloudflare login. After any user-facing change check
the headers survived, since the Worker sets them itself and `X-Robots-Tag` is the only
thing keeping the address out of a search index:

```
curl -sI https://<host>/ | grep -iE "x-robots-tag|content-security-policy"
```

## Deliberately not here

No edit path (`serve.py` on the laptop is the only writer); no Cloudflare Access (public
by decision, a DuitNow code can only receive money; the repo stays private regardless);
no `_headers` file; jsQR not shipped (130 KB; the runtime safety net is the plain-code
fallback).

## iPhone standard (28 Aug 2026)

`env(safe-area-inset-*)` read once into `--safetop`/`--safebot` (bare `env()` is zero on
desktop and cannot be measured; a probe forces 59 px and 34 px); `viewport-fit=cover` with
`black-translucent` makes the top inset mandatory; the Dynamic Island is centred, so pad
the strip, never move sideways; 44 px minimum from `--tap`; no field under 16 px; `dvh`
never `vh`. This app already met all of it; the master's `edit.html` did not and was fixed
2 Sep 2026.

## Design sync (2 Sep 2026, retired 8 Sep 2026)

This app was the reference design for the laptop master, and three files flowed out of it
through the master's `sync-design.mjs`. With the master retired nothing flows anywhere:
this repo is the only design. The lesson stands: shared tokens alone do not make one
design, and drift reaches through call sites. `paintFace` is still the one place
assembling the coin's options, with the `acct`-is-absent note attached.
