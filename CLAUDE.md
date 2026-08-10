# QR Command

The payment-QR consolidator, read-only, on the phone. A Cloudflare Worker serving a static
bundle built from the Cow-Fin06 master. Two screens: the accounts, which is where it opens, and
one code drawn on the device as a struck coin. Nothing else is shown and nothing else is
shipped.

## Hard rules

1. **This repository is a DEPLOY SURFACE, not a source.** The master is
   `C:\Users\maakm\Claude\Projects\Personal\Cow-Fin06_QR Consolidator\pay-afif-site`, and it is
   the only place an account is added, edited or removed. `public/` here is a build output of
   it. A hand-edit inside `public/` is overwritten by the next `npm run build` and lost, and
   the suite fails in the meantime because the build id no longer hashes the files on disk.
2. **Never rewrite a `payload` string.** Not trimmed, not normalised, not re-cased. The
   trailing four characters are a CRC over everything before them, so a payload that has been
   tidied can still scan and still pay, just to somebody else. The build copies payloads across
   as strings and checks them; it never repairs one. This is the master's rule 2 and it applies
   here unchanged.
3. **Payload validation is IMPORTED from the master, never reimplemented.**
   `tools/build.mjs` imports `functions/_lib/store.js` from the master and asks it. The master's
   own CLAUDE.md records that `serve.py` and `store.js` are two implementations of one contract
   with no test asserting they agree, and an audit later found ten places where they had already
   drifted. A third copy here would be the same mistake again, and a first attempt at one
   rejected all thirteen live payloads over a prefix it had guessed wrong. If the master moves,
   the build fails loudly rather than falling back to a guess.
4. **The bundle carries four fields per account and no more:** `key`, `name`, `brand`,
   `payload`. The account number, the owner, the group, the DuitNow member number and the
   payee's legal name stay on the laptop. The build reads `public/` back and searches it for
   every dropped value; the suite repeats the search. Adding a field to the page means adding it
   to `SHIP` in `tools/build.mjs` deliberately, in one place, where it is visible.
5. **The name IS inside the codes, and that is not this repo's to fix.** A DuitNow payload is an
   EMVCo TLV string with the account-holder name as a mandatory field (tag 59), and for six of
   the thirteen the account identifier sits in tag 26 in the clear as well. Anyone who scans a
   code sees those in their banking app, which is what that field is for. The leak check
   therefore strips payloads out before searching, and the build prints the disclosure on every
   run. Do not "fix" this by hiding it; the page not printing the name is the only part that is
   in our gift, and it does not.
6. **No dependency reaches the browser.** No CDN, no fonts, no inline script, no inline style.
   The Content-Security-Policy is `default-src 'none'` with `script-src 'self'` and no
   `unsafe-inline` anywhere, which is only possible because every script and stylesheet is an
   external same-origin file. An inline `<script>` or a `style=` attribute in `index.html` is a
   blank page on the phone, so the build refuses to finish if it finds one.
7. **British English, no em-dashes,** in code, comments, docs and UI copy alike.

## The renderer, and the three numbers behind it

`src/app/qr-art.js` draws the coin. Everything it does is a change of appearance, never of
data: the payload goes to the encoder untouched and every module is drawn at its exact grid
position. Three measured facts hold it up, and all three are re-asserted by `npm test` so none
of them can quietly go stale.

**Error correction is M, and higher would be worse.** The instinct is to ask for the most error
correction the payload will take, on the reasoning that a decorated code needs the redundancy.
Measured, that is backwards. Raising the level adds modules, and adding modules shrinks each
one; for a code read off a screen, module size binds and redundancy does not. Decoding every
real payload at descending sizes, the worst code in the book stopped reading below 880 pixels at
H and 370 at M, and one code was stuck at 540 even drawn as plain black squares purely because H
had pushed it to 61 modules. The stylisation costs no error correction anyway, because it is
faithful at every module centre outside the eyes. M is also what the master page and the printed
card use, so all three now agree.

**Below 560 physical pixels the coin is not drawn at all.** The worst measured floor is 370, so
`safePhysicalPx` is that with half again on top. Under it the renderer draws the plain code
instead and says so. What matters is the PHYSICAL size on the glass, not the backing store: a
large buffer shown small proves nothing, and an early version of the test measured the buffer
and so passed while the displayed code would not have read.

**Module edges are snapped to whole device pixels.** Left fractional, boundaries drift in and
out of phase with the pixel lattice and paint half-lit rows a binariser reads as neither dark
nor light. The signature was decode failure that came and went with size rather than shrinking
steadily with it.

The eyes are the only place the drawing departs from the matrix, and only at the outermost
diagonal corners of each, which is what a rounded eye is. The suite names those cells and fails
on any other. It also measures the 1:1:3:1:1 run ratio through each eye out of the painted
pixels, because a finder carries no error correction: a decoder that cannot see one does not
recover from it, it never finds the code at all.

**The decoration is free, and that is measured too.** Colour, the scalloped edge, the rim
legend, the ring sheen and the ink gradient all sit outside the quiet zone or affect only
contrast, and none of them moved the decode floor: the worst code read from 370 pixels before
the coin was redesigned and 360 after. So the fun is not a risk being run, it is part of the
picture the decoder never looks at. The scallop count and phase come from a hash of the
provider key, so every account has its own outline with nothing stored to remember it.

**The field is flat, on purpose, twice over.** A smooth wash across it was the single most
expensive thing in the saved image, because PNG cannot compress a gradient: every row differs
slightly so its filters find nothing to fold away. Measured on the card, a gradient background
cost 1,244 KB against 45 KB flat, and flattening the coin's field as well took the saved file
from 1.9 MB to under 1 MB. It is also the safer choice: `palette()` measures the ink's contrast
against one field colour, and with a wash part of the field is lighter than the number that was
checked and part is darker.

**`drawCard` is what reaches the gallery**, at 1,200 pixels, which is over three times the
floor. It is the one image nobody can pinch and zoom: it is scanned out of somebody else's
photo library, often after a messaging app has recompressed it. The suite decodes every card,
and decodes one halved to 700 pixels to stand in for that recompression.

The pupil is a rounded square rather than a circle. A circle cannot satisfy both bounds a 3x3
centre imposes: reach the corner module centres at 1.414 modules, and stay three modules wide
through the middle so the ratio still measures 3. 1.5 satisfied both by a twentieth of a module,
which is under a pixel once snapped, and flipped those corners on ten of the thirteen codes;
1.68 fixed the corners and stretched the middle run to 3.8.

## Files

| Path | What it is |
|---|---|
| `src/worker.js` | The Worker. Serves `public/` and sets every security header itself. |
| `src/app/index.html` | The page. Markup only, no inline script or style. |
| `src/app/app.css` | Liquid Glass, presentation density. Tuning comes from the brand colour. |
| `src/app/app.js` | The app: rail, keyboard, swipe, hash, the per-account page tuning. |
| `src/app/qr-art.js` | The coin, and `drawCard` for the gallery. Read the note at the top before touching it. |
| `src/app/sw.js` | Service worker template. `__BUILD__` and `__SHELL__` are stamped by the build. |
| `src/vendor/qrcode.js` | The encoder, copied from the master unchanged. |
| `tools/build.mjs` | Master store in, `public/` out, with the leak check and the disclosure. |
| `test/verify.mjs` | The whole suite. No network, no browser. |
| `test/vendor/jsqr.js` | The decoder. **Test only, never shipped.** |
| `public/` | Build output, committed so the deployed bytes are the reviewed bytes. |
| `wrangler.jsonc` | Worker plus assets. No KV, no secrets, no vars: there is nothing to write. |

## Working on it

```
npm run build     # master -> public/
npm test          # 90 assertions, a couple of minutes, no network
npm run check     # both
npm run dev       # build, then wrangler dev
npm run deploy    # build, test, then wrangler deploy. The test is not optional here.
```

`QR_MASTER` overrides the master path for both the build and the suite.

Four things that will bite:

- **`compatibility_date` must not exceed what the installed runtime supports.** wrangler 4.120.0
  tops out at 2026-08-08 and refuses to start on anything later, locally and on deploy.
- **The suite is slow because it decodes.** Roughly a thousand renders go through jsQR on every
  run. That is the point of it; do not trim the size sweep to make it quick.
- **The saved image is built with `toDataURL`, not `toBlob`, and that is load-bearing.** iOS
  only allows `navigator.share` from inside the gesture that triggered it, and awaiting
  `toBlob` is enough to lose that permission. The failure is silent: the share sheet simply
  never appears. `cardOf()` is synchronous and cached for that reason, and the suite asserts
  `toBlob` does not come back.
- **The grid's `minmax` is 132px and must not grow.** At 148px, `auto-fill` dropped to a single
  column on a 375px phone, which made the list scroll. Two columns must fit the narrowest phone
  so all thirteen accounts are on screen at once with nothing to hunt for.
- **There is no Save button, and that is a decision to defend rather than an omission.** The
  affordance carries it: the coin is drawn as a physical token, with a contact shadow, a lit rim
  and a press state, and the action is press-and-hold, which is the gesture a phone has already
  taught for keeping a picture. A tap does the same for the other instinct, and `.tuck` plays on
  save so the motion explains itself the first time. Three attempts got here: a rail nobody could
  reach the end of, then a grid hidden behind the title with a row of colour dots, which was
  worse because five of the thirteen brands are near-identical reds and two are exactly the same
  colour, so the dots could never say which was which. Colour was the only signal, and it was not
  enough to be one.

## Deploying

`npm run deploy`. There is no first-time setup beyond a Cloudflare login: no KV namespace, no
secret, no binding to attach. After a deploy that changes anything user-facing, check the
headers survived:

```
curl -sI https://<host>/ | grep -iE "x-robots-tag|content-security-policy"
```

The Worker sets those rather than a `_headers` file, deliberately: `_headers` support under
Workers static assets is asserted by a sibling repo's comment rather than by any test, and
`X-Robots-Tag` is the only thing keeping this address out of a search index. Set in the Worker
it is asserted offline by the suite and by that curl afterwards.

## What is deliberately not here

- **No edit path.** No `edit.html`, no `POST`, no KV, no `EDIT_KEY`. Editing is a laptop job,
  against the master, through `serve.py`. That decision is what removes the entire write-guard
  surface: there is no key to leak, no revision race and nothing to authenticate.
- **No Cloudflare Access.** The site is public by decision, because a DuitNow code can only
  receive money. `X-Robots-Tag: noindex` still keeps it out of search. This repo stays private
  regardless: GitHub is scraped and archived, and "reachable at a URL" and "indexed for ever"
  are not the same exposure.
- **No `_headers` file.** See above.
- **jsQR is not shipped.** It is 130 KB and the decode proof happens at build and test time. The
  runtime safety net is the plain-code fallback, which is a tap away and automatic below the
  safe size.
