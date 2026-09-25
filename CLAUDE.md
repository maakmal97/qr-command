# QR Command

Standing facts for this repo. The root `CLAUDE.md` governs everything else and is not
repeated here; British English and no em or en dashes hold in files, code and copy too.
Mechanism and measured numbers: `docs/DETAIL.md`. The 6 Sep 2026 reasoning, written for the
retired `pay-afif-site` design: `docs/NOTES.md`.

The payment-QR consolidator on the phone: a Cloudflare Worker serving a static bundle built
from `data/accounts.json`. Two screens: the accounts list, and one account shown the way the
chosen rail pays it. On QR, a code drawn on the device as a one-sided coin; press and hold
saves it. On Transfer, the bank and the number; on JomPAY, the biller code and references;
each value copies on a tap. One edit surface, `/admin/`, behind Cloudflare Access, sets which
accounts show and their order.

## Hard rules

Numbers are fixed: `test/verify.mjs` cites rule 4.

1. **`public/` is build output**, committed so the deployed bytes are the reviewed bytes. A hand
   edit there is overwritten by `npm run build`, and the suite fails meanwhile because the build
   id no longer hashes the files on disk. **The store is `data/accounts.json`, committed**; this
   private repo is its only home. Adding or removing an account is an edit there, then `npm run
   deploy`.
2. **Never rewrite a `payload` string.** The trailing four characters are a CRC, so a tidied
   payload can still scan and pay somebody else. The build copies and checks; it never repairs.
   A payload is never typed into a page: `/admin/` cannot add an account.
3. **Payload validation is `tools/store.js`,** one copy, imported by build and suite, never
   reimplemented.
4. **The bundle carries fourteen fields:** `key`, `name`, `brand`, `payload`, `acct`,
   `maintenance`, `bank`, `holder`, `bankMark`, `holderMark`, `tag`, `ring`, `biller`, `ref1`.
   Owner, group and DuitNow member number stay in the repo. Build and suite search `public/` for
   every dropped value, and assert every account number IS there. A new field is added in `SHIP`
   in `tools/build.mjs` and nowhere else.
   - `acct` ships, by his decision: every account number is readable by anyone with the
     address. The build prints that disclosure on every run.
   - `holder` is the beneficiary, never the owner. The owner's name, by exact string or by
     twelve-character stem, kills the build; the sanctioned name is pinned to exactly once per
     entitled record in `data.js`. Keys are provider-named: a person-named key kills the build,
     and so does a `holder` on a code account.
5. **The name is inside the codes** (EMVCo tag 59; tag 26 carries the account id in the clear
   for six of them). Not this repo's to fix; the leak check strips payloads before searching.
6. **No dependency reaches the browser.** CSP `default-src 'none'`, `script-src 'self'`, no
   `unsafe-inline`: an inline script or a `style=` attribute is a blank page, and the build
   refuses it. Logos are `Path2D` data, never rasters; `img-src` refuses `data:`, asserted.
7. **The identity's tokens in `src/app/app.css` are generated** from the `:root` of
   `Code\salt-ds\src\styles.css` (his own Salt Commodities system, not JPMorgan's Salt) by `node
   tools/designsync.mjs --pull`, between the DESIGN markers; the build refuses to ship on drift.
   The rest of `app.css` is this app's own and restates no colour the identity names. The two
   fonts in `src/app/fonts/` are pulled the same way; the build copies, hashes, stamps and
   precaches them.

## The renderer, `src/app/qr-art.js`

Read the note at the top of the file first; `npm test` re-asserts every number.

- **Error correction M**; the printed card and the phone agree on it.
- **Below `safePhysicalPx` the plain code is drawn instead.** The suite downscales to the size
  the glass would show before decoding; decoding the backing store passes vacuously.
- No `Math.random`: the lens is seeded from the key. Nothing is painted over the light field;
  the canvas stays transparent outside the artwork, carries no `border-radius`, and the field
  is flat.
- **Encoding is cached in `plan()`. Never batch modules into one `Path2D`**, asserted.
- `paintFace` is the one place assembling the coin's options, with the `acct`-is-absent note.
- **Code-less accounts** draw `drawPlate()`, which never reads `acct` or draws the DuitNow
  mark, asserted on its body. Values wrap by rendered width, never shrink past legibility.
- An empty payload decodes to `""` and passes, so the suite walks `codes` and `plates`
  separately. `filter(Boolean)` on the payload list is load-bearing in `build.mjs`,
  `verify.mjs` and `live.mjs`. `shipped[0]` is not necessarily a code; tests use `codes[0]`.

## The number, the rails, maintenance

- **The coin never carries the number.** It is on screen on the **Transfer view only**. Each
  plate value is a button copying through the one `copyValue(value, label)`. Nothing hands the
  number to a renderer, asserted. A suspended account empties the plate and refuses to copy.
- **The rail is a mode, not only a filter.** Three rails, DuitNow QR, DuitNow Transfer and
  JomPAY, no "All". A rail is derived from the account, never stored. The chosen rail filters
  the list and decides what an opened account shows (`viewOf()`); it is kept in `localStorage`
  `pay:rail`, default QR. Code miniatures show on the QR rail only; any other rail strikes the
  badge.
- **A payer's link is `#<key>/<rail>/<amount>/<reference>`.** `linkOf()` checks each part and
  DROPS, never repairs, one that fails; the rail becomes the mode where the account is on it;
  the amount and reference show under the coin or plate, each copying, on that account only.
  salt-command's `stmt/pay.js` `payHref` writes it and its suite reads it back through this
  `linkOf`: a format change is both repos, this one shipped first. **That suite lifts
  `function linkOf(` and the `var RAILS = [` block by text from `public/app.js` in this
  checkout on disk**, not GitHub: keep both in their present shape, `linkOf` needing nothing
  but `RAILS`, and fast-forward this checkout after any push from a worktree.
- **Every account carries a `bankMark`, and the build ships it for every account**; the suite
  fails a code account without one. `holderMark` stays plate-only. `bank` ships for every
  account and is what the row and the plate show.
- **Adding or replacing a logo:** artwork from the institution's official site, never redrawn
  from memory; `node tools/vectorise.mjs <image> <id> src/vendor/<id>-mark.js`;
  `"bankMark": "<id>"` on the record; rebuild.
- Steps and swipes walk `shownOrder`, the visible tiles in display order, never the build
  order. Chips filter by hiding, never rebuilding, so `tiles[i]` stays aligned with `CODES[i]`.
- **Suspended accounts draw no code at all:** no miniature; copy and save refused.
  `drawThumbs` runs on every state change and must CLEAR a suspended tile's miniature
  (`el.width = 8`), never skip it. State precedence: `/state.json` from KV (seconds, no
  deploy), then this phone's last read (`localStorage` `pay-state`), then the baked
  `maintenance` flag. A failed fetch leaves the override untouched; only booleans on known
  keys, and only known keys in the order, are trusted.
- `/state.json`, `/admin/`, `/api/` and `/rev.json` are `no-store` and bypassed by the service
  worker. **An open page follows the build:** `followBuild()` reloads once when `/rev.json`'s id
  is not `QR_BUILD`, remembering the id first, so a mismatch costs one reload, never a loop.

## The edit surface, `/admin/`

- **One value in KV, `state`:** `{maintenance: {key: bool}, order: [keys], at}`, written by
  `POST /api/state`, read by `/state.json`. The admin writes it COMPLETE: every account a
  boolean and every key in the order, so after the first save the baked flag is moot.
- **The gate is the token, not the header.** `identity()` in `src/worker.js` verifies the
  Access JWT and **fails closed**: `ACCESS_TEAM` or `ACCESS_AUD` empty in `wrangler.jsonc`
  makes every gated route 401. Neither is a secret; this Worker has none. `QR_STATE.put`
  appears exactly once, after the identity check, asserted.
- The page reads `/state.json` and `/api/me` and writes `/api/state`, nothing else, asserted.
  Nothing deploys after a state change.

## Motion, zoom, layout

- Two motion tiers, `--dur`/`--ease` and `--dur-fast`/`--ease-fast`, read once by `cssMs()`.
  When motion is reported as not smooth, measure the easing tail (time to 95 per cent) before
  blaming frames.
- Both views are always laid out and cross-faded by opacity, never `display`. The hash is the
  only state.
- Nothing waits on `animationend` (reduced motion collapses `after()` to zero); one-shot
  classes remove themselves via `oneShot()`; `morph()` and `fly()` take rects measured while
  their view is visible; `goBack()` renders the list before measuring.
- Measuring in a hidden browser pane reads the harness, not the page: transitions freeze at
  time zero. Finish them first with `getAnimations().forEach(a => a.finish())`.
- One column of rows, no account featured; store order until `/admin/` sets one; suspended
  accounts sink at run time through `orderTiles()`, which moves rather than rebuilds.
  `classOf()` is the one place a tile's classes are built; `--thumb` and `THUMB` are one
  number, 56 px. No pill, no title above the coin, no Save button: press and hold saves, and
  `.tuck` plays.

## iPhone standard

`env(safe-area-inset-*)` read once into `--safetop`/`--safebot`; `viewport-fit=cover` with
`black-translucent` makes the top inset mandatory; the Dynamic Island is centred, so pad the
strip, never move sideways; 44 px minimum from `--tap`; no field under 16 px; `dvh`, never
`vh`.

## Files that carry a rule

Beyond `data/accounts.json`, `tools/store.js` and `public/` (rules 1 and 3):

| Path | Rule |
|---|---|
| `src/app/index.html` | Markup only, no inline script or style |
| `src/vendor/*-mark.js` | **Generated, do not edit.** Traced logos registering on `self.MARKS` |
| `test/vendor/jsqr.js` | The decoder, **test only, never shipped** |

The rest: `docs/DETAIL.md`.

## Working on it

```
npm run build     # data/accounts.json -> public/
npm test          # about 250 assertions, no network
npm run check     # both
npm run dev       # build, then wrangler dev
npm run deploy    # build, test, then wrangler deploy; the test is not optional
```

Things that bite:

- `compatibility_date` must not exceed the installed runtime: wrangler 4.120.0 tops out at
  2026-08-08.
- **Edit with the Edit and Write tools, never a Bash heredoc.** It collapses one backslash, so
  `"\x00"` lands as a literal NUL and the file still parses; the suite sweeps every file for
  control bytes.
- The suite decodes about a thousand renders per run. Do not trim the size sweep.
- The saved image uses `toDataURL`, not `toBlob`: iOS allows `navigator.share` only inside the
  gesture, and awaiting `toBlob` loses it silently. `cardOf()` is synchronous and cached,
  asserted.

## Deploying

**A green suite deploys and pushes, no ask:** `npm run deploy`, commit the `rev.json` stamp it
writes, `git push origin main`. His standing exception, for this repo only, to root §7 on
pushes and deploys. After any user-facing change, check from the Bash tool that the live
`/rev.json` id matches and the headers survived: the Worker sets them itself, and
`X-Robots-Tag` alone keeps the address out of a search index.

```
curl -sI https://<host>/ | grep -iE "x-robots-tag|content-security-policy"
```

## Deliberately not here

No Cloudflare Access on the public page: a DuitNow code can only receive money, and the repo
stays private regardless. No `_headers` file: the Worker sets every header. jsQR is not
shipped (130 KB); the runtime safety net is the plain-code fallback.
