# QR Command

Standing facts only. Root `CLAUDE.md` governs voice, structure, verification and
precedence; this file adds what a session here would otherwise rediscover, and
never repeats a root rule. British English, no em-dashes, in files, code and copy.
Correct stale facts in place; the dated record is the project changelog / journal.
Set 6 Sep 2026.

The payment-QR consolidator on the phone: a Cloudflare Worker serving a static bundle built
from `data/accounts.json` in this repo. Two screens: the accounts list, and one account shown
the way the chosen rail pays it: on QR a code drawn on the device as a coin (one side, a tap
saves it), on Transfer the bank and the number, on JomPAY the biller code and the references,
each value copying on a tap (owner, 14 Sep 2026). One edit surface since 8 Sep 2026,
`/admin/`, behind Cloudflare Access, for which accounts are shown and their order. Mechanism
and measured numbers: `docs/DETAIL.md`. Reasoning: `docs/NOTES.md`.

## Hard rules

Rule 4 is cited by number in `test/verify.mjs`; never renumber.

1. **`public/` is build output.** A hand edit there is overwritten by `npm run build`, and the
   suite fails meanwhile because the build id no longer hashes the files on disk. **The store
   is `data/accounts.json`, committed** (owner, 8 Sep 2026): this private repo is its only
   home. Adding or removing an account is an edit there, `npm run deploy`, nothing else.
2. **Never rewrite a `payload` string.** The trailing four characters are a CRC, so a tidied
   payload can still scan and pay somebody else. The build copies and checks; it never
   repairs. A payload is never typed into a page: `/admin/` cannot add an account.
3. **Payload validation is `tools/store.js`,** one copy, imported by build and suite, never
   reimplemented.
4. **The bundle carries fourteen fields:** `key`, `name`, `brand`, `payload`, `acct`,
   `maintenance`, `bank`, `holder`, `bankMark`, `holderMark`, `tag`, `ring`, `biller`, `ref1`.
   Owner, group and DuitNow member number stay in the repo and never ship. Build and suite
   search `public/` for every dropped value, and assert every account number IS there. A new
   field is added in `SHIP` in `tools/build.mjs` and nowhere else.
   - `acct` ships (owner, 11 Aug 2026): every account number is readable as text by anyone
     with the address. The build prints that disclosure on every run.
   - `holder` is the beneficiary, never the owner. The owner's name, by exact string or by
     twelve-character stem, kills the build; the sanctioned name is pinned to exactly once per
     entitled record in `data.js`. Keys are provider-named; a person-named slug kills the
     build. A `holder` on a code account kills the build too.
5. **The name is inside the codes** (EMVCo tag 59, and tag 26 carries the account id in the
   clear for six of them). Not this repo's to fix; the leak check strips payloads before
   searching.
6. **No dependency reaches the browser.** CSP `default-src 'none'`, `script-src 'self'`, no
   `unsafe-inline`; an inline script or a `style=` attribute is a blank page and the build
   refuses it. Logos are `Path2D` data, never rasters, because `img-src` refuses `data:` and
   the suite asserts it still does.

7. **The identity's tokens in `src/app/app.css` are generated** (22 Sep 2026): the `:root` of
   `Code\salt-ds\src\styles.css`, written between the DESIGN markers by
   `node tools/designsync.mjs --pull`, and the build refuses to ship on drift. Everything else in
   `app.css` is this app's own, and nothing in it restates a colour the identity has a word for.

## The renderer, `src/app/qr-art.js`

Read the note at the top of the file first. Every number is re-asserted by `npm test`.

- **Error correction M**; master, card and phone agree on it.
- **Below `safePhysicalPx` the plain code is drawn instead.** The suite downscales to the size
  the glass would show before decoding; decoding the backing store passes vacuously.
- `Math.random` appears nowhere; the lens is seeded from the key. Nothing is painted over the
  light field; the canvas stays transparent outside the artwork and carries no
  `border-radius`; the field is flat.
- **Encoding is cached in `plan()`. Never batch modules into one `Path2D`**, asserted.
- `paintFace` is the one place assembling the coin's options, with the `acct`-is-absent note
  attached.
- **Code-less accounts** draw `drawPlate()`, which never reads `acct` and never draws the
  DuitNow mark, asserted on its body. Values wrap by rendered width, never shrink past
  legibility.
- An empty payload decodes to `""` and passes; the suite walks `codes` only, `plates`
  separately. `filter(Boolean)` on the payload list is load-bearing in `build.mjs`,
  `verify.mjs` and `live.mjs`.

## The number, the rails, maintenance

- **The coin never carries the number.** It is on screen on the **Transfer view only** (owner,
  14 Sep 2026). Each plate value is a button that copies through the one `copyValue(value,
  label)`. Nothing hands the number to a renderer, asserted. A suspended account empties the
  plate and refuses to copy.
- **The rail is a mode, not only a filter** (14 Sep 2026). Three rails, DuitNow QR, DuitNow
  Transfer, JomPAY, no "All". A rail is a property of an account, derived never stored. The
  chosen rail filters the list and decides what an opened account shows (`viewOf()`); it is
  remembered in `localStorage` `pay:rail`, default QR. Code miniatures appear on the QR rail
  only; any other rail strikes the badge.
- **Every account carries a `bankMark`, and the build ships it for every account**; the suite
  fails a code account without one. `holderMark` stays plate-only. **Adding or replacing a
  logo:** artwork from the institution's official site, never redrawn from memory, then `node
  tools/vectorise.mjs <image> <id> src/vendor/<id>-mark.js`, `"bankMark": "<id>"` on the
  record, rebuild. `bank` ships for every account and is what the row and the plate show.
- Steps and swipes walk `shownOrder`, the visible tiles in display order, never the build
  order. Chips filter by hiding, never rebuilding, so `tiles[i]` stays aligned with
  `CODES[i]`.
- **Suspended accounts draw no code at all:** no miniature, copy and save refused.
  `drawThumbs` runs on every state change and must CLEAR a suspended tile's miniature
  (`el.width = 8`), never skip it. Three sources, in this precedence: `/state.json` from KV
  (seconds, no deploy), the state this phone last read (`localStorage` `pay-state`), the baked
  `maintenance` flag. A failed fetch leaves the override untouched; only booleans on known keys
  are trusted, and only known keys in the order. `/state.json`, `/admin/`, `/api/` and
  `/rev.json` are `no-store` and bypassed by the service worker.
- **An open page follows the build** (owner, 15 Sep 2026): `followBuild()` reloads once when
  `/rev.json`'s id is not `QR_BUILD`, remembering the id first, so a disagreement costs one
  reload, never a loop.

## The edit surface, `/admin/` (8 Sep 2026)

- **One value in KV, `state`:** `{maintenance: {key: bool}, order: [keys], at}`. Written by
  `POST /api/state`, read by `/state.json`. The admin writes it COMPLETE: every account gets a
  boolean and the order names every key, so after the first save the baked flag is moot.
- **The gate is the token, not the header.** `identity()` in `src/worker.js` verifies the
  Access JWT. **Fails closed:** `ACCESS_TEAM` or `ACCESS_AUD` empty in `wrangler.jsonc` means
  every gated route is 401 and nothing is written. Neither is a secret; there are no secrets in
  this Worker. `QR_STATE.put` appears exactly once, after the identity check, asserted.
- The page reads `/state.json` and `/api/me` and writes `/api/state`, nothing else, asserted.
  Nothing deploys after a state change.

## Motion, zoom, layout

- Two motion tiers, `--dur`/`--ease` and `--dur-fast`/`--ease-fast`, read once by `cssMs()`.
- Both views are always laid out and cross-faded by opacity; never `display`. The hash is the
  only state.
- Nothing waits on `animationend` (reduced motion collapses `after()` to zero); one-shot
  classes remove themselves via `oneShot()`; `morph()` and `fly()` take rects measured while
  their view is visible; `goBack()` renders the list before measuring.
- One column of rows, no account featured; store order until `/admin/` sets one; suspended
  accounts sink at run time through `orderTiles()`, which moves rather than rebuilds.
  `classOf()` is the one place a tile's classes are built; `--thumb` and `THUMB` are one
  number, 56 px. No pill, no title above the coin, no Save button: press-and-hold saves and
  `.tuck` plays.
- `shipped[0]` is not necessarily a code; tests use `codes[0]`.

## iPhone standard (28 Aug 2026)

`env(safe-area-inset-*)` read once into `--safetop`/`--safebot`; `viewport-fit=cover` with
`black-translucent` makes the top inset mandatory; the Dynamic Island is centred, so pad the
strip, never move sideways; 44 px minimum from `--tap`; no field under 16 px; `dvh` never
`vh`.

## Files that carry a rule

| Path | Rule |
|---|---|
| `data/accounts.json` | **The store.** Committed; every private field lives here and only here |
| `tools/store.js` | The validator, one copy, imported by build and suite |
| `src/app/index.html` | Markup only, no inline script or style |
| `src/vendor/*-mark.js` | **Generated, do not edit.** Traced logos registering on `self.MARKS` |
| `test/vendor/jsqr.js` | The decoder, **test only, never shipped** |
| `public/` | Build output, committed so the deployed bytes are the reviewed bytes |

The rest: `docs/DETAIL.md`.

## Working on it

```
npm run build     # data/accounts.json -> public/
npm test          # about 180 assertions, ten seconds, no network
npm run check     # both
npm run dev       # build, then wrangler dev
npm run deploy    # build, test, then wrangler deploy; the test is not optional
```

Things that bite:

- `compatibility_date` must not exceed the installed runtime: wrangler 4.120.0 tops out at
  2026-08-08.
- **Never edit these files through a shell heredoc.** The Bash tool collapses one level of
  backslash, so `"\x00"` arrives as a literal NUL and the file still parses; the suite sweeps
  every file for control bytes. Use the editing tools.
- The suite decodes about a thousand renders per run. Do not trim the size sweep.
- The saved image uses `toDataURL`, not `toBlob`: iOS allows `navigator.share` only inside the
  gesture, and awaiting `toBlob` loses it silently. `cardOf()` is synchronous and cached,
  asserted.

## Deploying

**A green suite deploys and pushes, no ask (owner, 15 Sep 2026):** `npm run deploy`, commit the
`rev.json` stamp it writes, `git push origin main`. This repo's standing exception to the root
rule on public actions; no setup beyond a Cloudflare login. After any user-facing change check
the headers survived, since the Worker sets them itself and `X-Robots-Tag` is the only thing
keeping the address out of a search index:

```
curl -sI https://<host>/ | grep -iE "x-robots-tag|content-security-policy"
```

## Deliberately not here

No Cloudflare Access on the public page (public by decision: a DuitNow code can only receive
money; the repo stays private regardless); no `_headers` file, the Worker sets every header;
jsQR not shipped (130 KB; the runtime safety net is the plain-code fallback).
