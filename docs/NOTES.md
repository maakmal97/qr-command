# QR Command: the reasoning behind the rules

The former body of `CLAUDE.md`, moved here verbatim on 6 Sep 2026 when that file was cut to a fact sheet. Every measurement, decision and its date is kept. Nothing here has been edited since; correct facts in `CLAUDE.md`, not here.

The payment-QR consolidator, read-only, on the phone. A Cloudflare Worker serving a static
bundle built from the master at `Code\pay-afif-site`. Two screens: the accounts, which is where
it opens, and one code drawn on the device as a struck coin held in a gravitational lens: light
from behind it smeared into arcs, and the one closed Einstein ring. The coin has ONE side: a tap
saves it, and `Copy account number` puts the number on the clipboard without ever showing it.
Nothing else is shown and nothing else is shipped.

## Hard rules

1. **This repository is a DEPLOY SURFACE, not a source.** The master is
   `C:\Users\maakm\Claude\Code\pay-afif-site`, and it is
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
4. **The bundle carries twelve fields per account and no more:** `key`, `name`, `brand`,
   `payload`, `acct`, `maintenance`, `bank`, `holder`, `bankMark`, `holderMark`, `tag`, `ring`.
   The owner, the group and the DuitNow member number stay on the laptop. The build reads `public/` back and searches it for every
   dropped value; the suite repeats the search, and also asserts the other way, that every
   account number IS there, so a feature cannot vanish silently either. Adding a field means
   adding it to `SHIP` in `tools/build.mjs` deliberately, in one place, where it is visible.

   `acct` was added on 11 Aug 2026 at the owner's request. **It is a
   real widening of what a stranger with the address can read** and it was made deliberately:
   before it, an account number was recoverable only by decoding a code, and only for six of the
   thirteen; now all thirteen are in the page as text. The build prints that on every run.

   **`holder` IS THE BENEFICIARY, AND A BENEFICIARY IS NOT THE OWNER.** Added 25 Aug 2026 for
   accounts with no DuitNow code. Such an account is paid by picking a bank and confirming a
   receiver name, and that receiver is normally an institution rather than a person: Wise's MYR
   account is held at JPMorgan Chase in the name of Wise Payments Malaysia Sdn Bhd, and a payer
   who is not warned of that aborts the transfer half way through. A company name is not personal
   data, and publishing one is not what this guard exists to police.

   **THE OWNER'S OWN NAME IS REFUSED OUTRIGHT**, and that is the rule, not "no name at all",
   which is what this said for a few hours and was wrong. A `holder` matching the payee or any
   owner, by exact string or by squashed stem, KILLS THE BUILD with a message saying so. It is
   not stripped and pinned like a sanctioned name; it simply cannot ship. Mutation tested with
   `Muhammad Afif Akmal`, a partial name in different casing that matches nothing byte for byte,
   and the stem check caught it.

   **IT IS NEVER DERIVED, and that is the load-bearing part.** The first version resolved it
   from the owner's `legal`, so every code-less account would have printed the owner's name
   automatically. That is the wrong default for a field that puts a name on a public page: it
   makes publication a side effect of adding an account rather than a decision about it. It ships
   exactly what the master types, and nothing else.

   **THE SANCTIONED NAME IS PINNED, NOT EXEMPTED.** The lazy way to allow any name through is to
   drop the payee from the forbidden set, which would disable the stem check described below.
   Instead the expected occurrences are stripped exactly as payloads are, and then asserted:
   **exactly once per entitled record, in `data.js`, and nowhere else at all.** A name reaching
   `app.js`, the manifest or the service worker's shell list still kills the build. Mutation
   tested by leaking a name into `app.js`: build and suite both die.

   **A name also travels as a SLUG, and exact matching cannot see one.** On 13 Aug 2026 the
   master keyed a new account `muhammad-afif-akmal-bin`, a truncated lowercase slug of the
   payee. It matched no forbidden string byte for byte, so it passed the leak check in both the
   build and the suite, and it would have become the public URL of the page. Both now also
   compare STEMS: strip everything that is not a letter or a digit from each side and look for
   the first twelve characters of the name. Keys are provider-named, never person-named, and the
   build dies rather than shipping one that is not.
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

**Below 580 physical pixels the coin is not drawn at all.** The worst measured floor is 380 with
the lens and 440 without it, so `safePhysicalPx` is 380 with half again on top. Under it the
renderer draws the plain code instead and says so.

**THE DOWNSCALE IS THE MEASUREMENT, and leaving it out disabled the guard for a while.** What
matters is the PHYSICAL size on the glass, not the backing store. The backing store is never
allowed below `minDeviceFor()`, about 530 pixels for a typical code, so a canvas rendered for a
200px display is still a 530px buffer: decode that and it succeeds at every size. `decode()` in
the suite did exactly that, so the floor sweep reported whichever size its loop started at, and
the assertion that `safePhysicalPx` still clears the floor was passing on a number it had never
measured. It now draws as the app draws, scales to the size the glass would show, and decodes
that. The numbers above are from the corrected measurement; the old 370 was not comparable.

**Module edges are snapped to whole device pixels.** Left fractional, boundaries drift in and
out of phase with the pixel lattice and paint half-lit rows a binariser reads as neither dark
nor light. The signature was decode failure that came and went with size rather than shrinking
steadily with it.

The eyes are the only place the drawing departs from the matrix, and only at the outermost
diagonal corners of each, which is what a rounded eye is. The suite names those cells and fails
on any other. It also measures the 1:1:3:1:1 run ratio through each eye out of the painted
pixels, because a finder carries no error correction: a decoder that cannot see one does not
recover from it, it never finds the code at all.

## The lens

The coin sits in a gravitational lens: the disc is a mass, and the light behind it is bent into
arcs that sweep around the rim, closing at one radius into the Einstein ring. How many arcs,
where they fall and how far they sweep all come from a hash of the provider key, so this is
where the per-provider identity now lives. It has to live somewhere: a lens has a smooth
horizon, so the scalloped outline is gone, and Boost Bank and Boost are the same `#ED1C24` to
the byte, so colour cannot tell them apart. They get different skies, and nothing is stored to
remember which.

**The frame is free; the ROOM it needs is not.** Ablated one at a time, the stars, the arcs, the
ring and the rim glow each cost the decode exactly nothing, because none of them touches the
light field. What does cost is `lensScale`, which holds the disc to 0.78 of the canvas to make
room: a smaller disc is a smaller code. Measured properly, at 0.78 the worst code reads from 380
physical pixels against 440 for the full-bleed coin, so the lens is slightly BETTER, because the
backing store grows with it and the downscale has more to work from.

**Three rules, all asserted.**

1. **Nothing is painted over the field.** The rim glow is the only piece drawn after the coin
   and it is clipped out of the light disc. Unclipped it washes the outer modules, and the
   contrast `palette()` measured stops being the contrast that is actually there.
2. **The canvas stays transparent outside the artwork.** No opaque backdrop is painted on it.
   The coin's shadow is cast from its alpha by `filter: drop-shadow`, so an opaque fill would
   put a hard square shadow behind a round object. The dark of space belongs to the page, in
   `app.css`, where it also covers the whole screen rather than one box. The suite reads the
   corner pixels and fails if any of them is opaque.
3. **Nothing is random.** `Math.random` appears nowhere in the renderer; the sky comes from
   `randOf(seedOf(key))`. An account must draw the same picture every time, or the thumbnail and
   the full-size render would disagree and the zoom would stop being one object moving.

**Both faces are drawn at the same diameter.** The reverse wears the lens too. Left full-bleed
while the front wore it, the coin grew as it turned over and shrank as it turned back, which
reads as two pictures being swapped rather than one thing rotating.

**Two things bit while fitting PayNet's mark into it.** The 0.78 scale took the container to 58
CSS px at phone size, under its 64px floor, so the rule correctly removed the mark from every
reverse; raising it to 0.32 of the face put it back at 79 CSS px, and that taller block then
pushed the caption onto the rim legend. The stack measured its own height but never checked it
against the room, so it now does, and what shrinks is our typography rather than PayNet's mark,
which has a stated minimum and no permission to go under it.

**`draw()` reports where it drew.** `meta.grid` gives the module grid in canvas pixels. The coin
no longer fills the canvas, so anything inspecting the painted pixels has to ask rather than
re-derive it from the canvas width. It must also be computed from the options the drawing
actually used: deriving it with the scallop still set, while the lens draws with `scallop: 0`,
put every reported position out by the scallop depth, and the symptom was finder ratios of
0.33:1.44:1.33 and a quiet zone measuring dark, which reads like a broken renderer rather than
a bad measurement.

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

## The number, and why the coin has one side

**The coin no longer turns over.** It used to: the reverse was struck metal carrying PayNet's
DuitNow QR brand graphic and the account number embossed into it, and you got at the number by
flipping the coin, which meant **copying it required putting it on screen first**.

`Copy account number` puts it straight on the clipboard instead. It copies the DIGITS,
`1571 5788 9482` going across as `157157889482`, because that is what a banking app wants pasted
into it. The number never has to be displayed, so it cannot be read over a shoulder or caught in
a screenshot of the code, and that removed the only reason the coin had a second face. Owner's
decision, 25 Aug 2026.

**WHAT WENT WITH IT, and none of it is coming back by halves.** `drawBack`, `drawMark`, the
preserve-3d wrapper, the second canvas, `setFlipped`, `paintBack`, and the vendored artwork in
`src/vendor/duitnow-mark.js` along with `tools/mark.mjs` that generated it. The suite asserts the
removal is COMPLETE rather than partial, because a half-removed flip is a coin that can be
rotated to a blank face.

**PayNet's artwork is deleted, not merely unused, and that is the point.** It is their
trademark, its use is governed by their guidelines, and 8.6 KB of it shipped to every phone that
nothing draws is a compliance surface with no benefit whatever. Everything the old section here
recorded about containers, the 40px floor, clear space and the three sanctioned fills was
correct and is now moot; read it in git if PayNet's mark is ever wanted again, and re-derive it
rather than half-remembering it.

**THE NUMBER IS OUT OF SIGHT, NOT OUT OF THE BUNDLE.** `acct` still ships in `data.js`, because
a copy has to have something to copy and the phone works with the radio off. Anyone who views
source still reads every account number, exactly as before. This change is about the screen, and
saying otherwise would be the wrong kind of comfort.

**A suspended account refuses to copy too**, and the button is disabled rather than hidden. The
number may be the one being changed on the laptop, and handing out a stale account number is the
same failure as showing a stale code.

## The three rails (4 Sep 2026)

Malaysia has three ways to be paid and this book now carries all of them: **DuitNow QR** (scan
the coin), **DuitNow Transfer** (pick the institution, paste the number, confirm the receiver)
and **JomPAY** (type a biller code and Ref-1).

**A RAIL IS A PROPERTY OF AN ACCOUNT, NOT A CATEGORY OF ACCOUNT, and that one fact decides the
whole shape of the list.** Thirteen of fourteen are payable BOTH by scanning and by transfer;
Instapay is payable all three ways. Three separate books, or a landing page with three doors,
would list nearly everything twice and add a tap to the common case for the sake of two doors
opening onto one item each. So there is one wallet and the rails FILTER it, as chips above the
grid built from the data so a count cannot go stale.

**The rails are DERIVED, never stored.** A stored `rail` field would be a second opinion about
data the record already carries and free to disagree with it. `qr` is a payload, `transfer` is
a bank and a number, `jompay` is a biller code and a reference.

**The filter HIDES, it does not rebuild**, for the same reason the suspended sort moves rather
than rebuilds: `tiles[i]` must stay aligned with `CODES[i]` or the hash, `open(i)`, the
thumbnails and the zoom's rects all silently change meaning. The `--i` stagger counts VISIBLE
tiles, or a filter showing one account in fourteen deals it in on the fourteenth beat and reads
as a hang.

**The chip row WRAPS and must never scroll sideways.** This app's navigation used to be a
sideways rail nobody could find the end of, and the suite asserts `overflow-x:auto` appears
nowhere in `app.css`. Measured at 375px the four chips come to about 321px inside 343px, so
they sit on one line on the narrowest phone anyway.

**`bank` now ships for EVERY account, and the build used to blank it on the code ones.** The
old line read `if (rec.payload) rec.bank = ""`, reasoning that a code account says nothing
about a bank. True while scanning was the only way to pay one, false the moment all fourteen
became transferable. The symptom was silent: thirteen bank strings were written to the master
and the build id did not move. The institution itself is not a guess, it is tag `26.01` of each
payload, the six-digit PayNet member code the master keeps as `mid`, and **two accounts share
one** (Touch 'n Go and Touch 'n Go Business, both 890053). What the master types is the DISPLAY
string a payer sees in their app's list.

**`holder` on a code account KILLS THE BUILD**, and it used to be discarded in silence. The
asymmetry with `bank` is the point: on a code account the receiver is the owner, so a `holder`
would be his own legal name on a public page. Blanking it was safe but silent, and mutation
tested by putting his full name on Maybank the build sailed through and shipped a clean bundle,
leaving whoever typed it with no idea whether it had published or been dropped.

**REF-1 IS NOT ANOTHER ACCOUNT NUMBER, and the difference is why it is never drawn.** A biller
code is public by design: PayNet issues it to a registered biller and it is printed on every
bill, and 11445 is INSTAPAY rather than the owner. Ref-1 here is his mobile number, which
unlike an account number can be called, messaged, and matched against a messaging app or an
account-recovery flow. It ships, because a copy needs something to copy and the phone works
with the radio off, and it is drawn nowhere. **The confirmation names the rail, not the value**:
"Copied JomPAY Ref-1", never the digits, because putting them in the toast would put them on
screen and into any screenshot, which is the whole thing copying instead of drawing avoids. The
account number IS echoed, and that difference is deliberate.

**One copy path serves both**, `copyValue(value, label)`. Written twice the half that drifts is
the JomPAY half, because it belongs to the single account with a biller code and so is the one
nobody exercises by accident.

## Accounts with no code at all

Some accounts have no DuitNow code and are paid by picking a bank, pasting an account number and
confirming a receiver name. `payload` became optional on 25 Aug 2026 to allow it, and **that is a change to the master's
contract, so it had to be made in `store.js` and `serve.py` together.** They are two
implementations of one rule with nothing asserting they agree, and they have drifted before;
the two were checked against seven documents, message for message, after the change.

**THE FACE IS PAPER, NOT METAL, and that is what keeps this coin in the same book as the rest.**
Metal was right while this was the REVERSE of a coin: struck lettering, embossed, where the edges
carry half the legibility and `faceInk`'s 4.5:1 fill is enough. It became wrong the moment it was
the only face and its content was flat-filled logos, because then the fill carries everything.
Rendered side by side with the whole book, the one coin without a code was also the only one that
was dark, and measurement backed the eye up: 4.6:1 against 8.3 to 10.6:1 for every code coin's
ink on its field. It now takes the code coin's own field and ink, so it reads as a sibling and
clears the same bar. Asserted by luminance, and mutation tested by putting the metal back.

The field is FLAT, for the same reason the code's field is: `palette()` measures the ink against
one field colour, and a wash makes part of the face darker than the number that was checked.

**THE FACE IS AN INSTRUCTION, not a label.** `drawPlate()` draws the same struck coin inscribed
with two headed rows, in the order a payer needs them: **BANK**, the bank to pick from the list,
and **RECEIVER**, the name their app will show them before they confirm. The provider is already
around the rim so it is not repeated.

**The RECEIVER row is the point of the whole face.** For an account like this the receiver is an
institution, not the owner: Wise's MYR account is held at JPMorgan Chase in the name of Wise
Payments Malaysia Sdn Bhd. A payer who taps confirm and sees a company they have never heard of
stops, so being told in advance is the difference between a transfer that completes and one that
does not.

**That the owner's name does not appear is the POINT of this account, not a side effect.** It is
kept for discreet transfers, where the receiver showing as an institution rather than as him is
exactly what is wanted (owner, 25 Aug 2026). Which is also why the guard above matters more here
than anywhere: a future change that helpfully filled `holder` in from the owner record would
quietly undo the whole reason the account exists.

**THE NUMBER IS NOT DRAWN HERE, and `acct` is deliberately not read by `drawPlate`.** It used to
be the largest thing on this face. Once the coin's reverse stopped showing a number, leaving it
on this one would have made a single account the odd one out: twelve that never show a number
and one that does, which reads as an oversight rather than a decision. The number reaches a
banking app through `Copy account number` without being displayed, so the face carries what you
cannot copy instead. Owner's decision, 25 Aug 2026. The suite reads `drawPlate`'s body with
comments stripped and fails if it so much as mentions `acct`.

**VALUES WRAP RATHER THAN SHRINK PAST LEGIBILITY, because a circle punishes long text twice
over.** A chord is the widest thing this face has, so fitting a 30-character name to one line
drives the type down to about a fifth of what the vertical room would allow: measured,
"WISE PAYMENTS MALAYSIA SDN BHD" comes out near 10 CSS px on one line against about 18 broken at
its most balanced word boundary. Height was never the constraint here, width was, and a second
line buys width back. The split is chosen by RENDERED WIDTH, not word count: splitting down the
middle of the word list left "WISE" alone above the rest, which reads as a mistake rather than a
line break.

**A MARK REPLACES ITS NAME, it does not sit above it.** Owner's instruction, 26 Aug 2026: "no
need for bank name and receiver name". What that costs is worth naming rather than glossing: the
name was there to be MATCHED, letter for letter, against the string a payer's banking app shows
at the confirm step, and a logo cannot be compared to a string. What it buys is a face readable
at a glance instead of four lines of legal name. The brands stay unambiguous, the rim still reads
JPMORGAN CHASE, and the full names remain in the coin's accessibility label, which is where a
logo's text alternative belongs anyway. A row with no traced mark still draws its name, so a bank
without a logo is not a blank space.

**TWO COLOURS, AND THE RING IS THE SECOND.** `brand` strikes the face and everything inscribed
on it; `ring` strikes the band around it and the legend struck into that band. It exists because
this account is two brands at once, held at one bank and received by another, and the coin can
say so without a word: JPMorgan brown face, Wise green ring (owner, 26 Aug 2026). Absent, the
ring is the brand and the coin is one colour, which is every other account.

**THE BROWN IS MEASURED, NOT CHOSEN, and the first attempt was neither.** It was set to Chase
blue `#117ACA` on the reasoning that JPMorgan Chase is a blue brand. The owner corrected it: the
current JPMorgan mark is brown, which the supplied artwork had said all along, since the logo
came white-on-brown. `#5B2F12` is the ground `tools/vectorise.mjs` measured out of that very
file while tracing the mark. It is the median of the image's BORDER, and the image was
vignetted, so it is the darker end of that brown rather than its middle; the source file is
gone, so re-measuring means re-supplying it. The lesson is the cheap one: the artwork carried
its own colour and it was there for the reading.

**The two palettes are not decoration, they are what keeps the lettering readable.** The rim's
legend is measured against the RIM and the face's inscriptions against the FACE, which is why
`struckFace` takes two palettes rather than one colour. It paid for itself immediately: the
face is dark, so `palette()` flipped its inscriptions to light on its own, while the green ring
kept dark lettering, and it did the same again when the face changed from blue to brown. Pick either from the wrong palette and half the coin goes unreadable.
Asserted from the PIXELS, because a palette handed to the wrong call reads perfectly well as code.

**`ring` is validated in BOTH master validators**, like `brand`. A colour is presentational, but
`store.js` and `serve.py` are one contract and letting them diverge on a field is how they came
to differ in ten places before. Re-checked against nine documents after the change, word for word.

**MARKS ARE MATCHED ON WIDTH, NOT HEIGHT**, which falls out of the circle rather than being a
preference: the cap is set high and the chord limits both to the same width, so two wordmarks of
very different proportions sit as one column. Matched on height, Wise at 4.4:1 would run to the
rim while JPMC at 2.8:1 looked half empty.

**Each row carries its brand's MARK, traced from the artwork rather than redrawn.** Added 26 Aug
2026 on the owner's instruction, after a version that set the wordmarks in type was rejected:
"just vectorise them, no need for recreation".

**THIS IS NOT THE THING THIS REPO REFUSED.** The rule recorded when PayNet's mark was vendored
is about a trademark REDRAWN FROM MEMORY, which comes out subtly wrong. `tools/vectorise.mjs`
invents nothing: it measures the ground from the border ring, thresholds the actual pixels,
walks the boundary between ink and ground and emits those boundaries. It is still a derivative
of a raster, so an official vector should replace it the day one exists, and the generated file
says so at the top.

**PATH DATA, NOT A RASTER, and that is the whole reason it is affordable.** Drawing an image
would need `img-src data:` added to a policy that is `default-src 'none'` with `img-src 'self'`;
a `Path2D` built from a string needs nothing. The suite asserts the policy still refuses `data:`
images, so the reasoning cannot rot. Both marks together are about 2.3 KB.

**Filled FLAT and EVEN-ODD.** Even-odd means a counter inside a P subtracts itself with no
winding order to maintain. Flat means never embossed: embossing is our own typographic treatment
applied to our own lettering, and somebody else's logotype gets no effects.

**TWO WAYS A MARK DRAWS NOTHING AND SAYS NOTHING, both of which happened.** `Path2D` is a browser
global that the headless canvas does not install, so `drawMark` returned false and the face came
out with a neat empty gap where the logo should be, no error anywhere; the suite now passes
`Path2D` into the renderer's scope for exactly that reason. And an id naming a file that does not
exist would do the same, so the build checks every id against `src/vendor/` and dies on a typo.

**Counting opaque pixels cannot prove a mark painted**, because it is painted onto a disc that is
already opaque: the alpha count is identical either way, and the first version of that assertion
passed while proving nothing. The suite renders the face with and without its marks and diffs the
two.

**The screen reader is not told the number either.** A label describes what is drawn, and out
loud is the last place you want an account number in a room with other people. The button says
how to get it.

**Only the lines that exist take up room.** Counting the holder's height when there is no holder
made the block taller than its contents, so what was drawn sat visibly above the middle of the
face while the space it was centred in ran off the bottom. The height is summed from what is
actually drawn, gaps included.

**NO DUITNOW MARK, and that is a rule rather than an oversight.** The mark is PayNet's and it
says a DuitNow code is present. These accounts have none, so putting their artwork on one would
be using their brand to label something it does not cover. The suite reads `drawPlate`'s body
and fails if it so much as mentions the mark.

**The tap copies rather than saves.** A saved image exists to be scanned out of somebody's photo
library, and a picture of a number is not that. So `save()` diverts to `copyAcct()`, no card is
built, and the caption reads "Tap to copy" rather than "Tap to save".

**`struckFace()` is shared, and that is why.** The reverse of a coin and the single face of a
code-less account are the same object down to the pixel; only the inscription differs. Drawn
twice they would drift, and invisibly, because the two are never on screen together to compare.

**AN EMPTY PAYLOAD PASSES A DECODE TEST, and that nearly bought thirteen false assertions.**
Handed `""` the encoder happily encodes the empty string, jsQR reads back `""`, and
`got.data === c.payload` compares `""` with `""` and PASSES. Every decode assertion in section 1
would have been vacuously true for that account while claiming to prove something about a code
that is never drawn. The suite now splits `codes` from `plates` and section 1 walks `codes`
only; `live.mjs` skips it the same way.

**`filter(Boolean)` on the payload list is load-bearing in three files.** The leak checks strip
payloads out of each file before searching, and `body.split("")` splits a string into its
individual characters. One empty entry would blow every file apart into fragments and leave the
search finding nothing at all, silently. `build.mjs`, `verify.mjs` and `live.mjs` each filter.

## Under maintenance

An account can be suspended, and the phone then **draws no code for it at all**. That is the
whole rule and it is not cosmetic: an account is marked while it is being changed on the laptop,
so the payload on the phone may already be the wrong one, and a wrong DuitNow code still scans
and still pays, just to somebody else. Both canvases are cleared to 8x8, `prerender()` returns
null, and no 36px miniature is drawn on the tile either. A coin drawn and then covered by a
panel is a screenshot away from being scanned, and the panel is a stylesheet away from not being
there. Saving and copying are refused too, because the number may be the one being changed.

**Two sources, and the precedence is the point.**

| Where | Reaches the phone | What it is |
|---|---|---|
| `/state.json`, from KV | seconds, no deploy | the fast path. Consulted FIRST |
| `maintenance` in the bundle | next deploy | the durable truth, and what an offline phone reads |

`down()` asks the override first; where the override says nothing about an account, the baked
flag stands. A failed, malformed or missing fetch leaves the previous override **untouched**
rather than clearing it, because treating a dropped connection as "nothing is suspended" would
put a suspended code back on screen. Only real booleans against known account keys are trusted
off the wire.

**KV did not reopen the write path, and that was the condition for adding it.** `src/worker.js`
calls `QR_STATE.get` and nothing else. There is no route that writes, no secret and nothing to
authenticate, which is the property the site was built around. The value is written from the
laptop by wrangler under the owner's own Cloudflare login. A stranger with the address gains a
JSON file of account keys and booleans, and the keys are already public in `data.js`.

**`/state.json` is never cached, anywhere.** `no-store` at the edge, and the service worker
returns early for that path so it can neither serve nor store a copy. A suspended code still
being served from a cache is the one failure the whole mechanism exists to prevent.

**KV is eventually consistent.** A write is usually visible within seconds but the edge can
serve the previous value briefly; observed here at about twenty seconds. That is why the local
switch writes the durable flag first and KV second: if the order were reversed, a crash between
the two would leave the fast path saying one thing and the bundle another.

The switch is on the local page, and it is the only place either value can be changed:
`maintenance.py` writes `accounts.json`, then pushes the whole suspended set to KV, and reports
which of the two landed.

**A STATE CHANGE MUST UNDRAW THE MINIATURE, and for a long time it only ever drew one
(found live, 3 Sep 2026).** `drawThumbs` skipped a suspended account and moved on, which is
right on the first pass, when nothing has been painted yet. But it also runs when `/state.json`
changes what is suspended, and there skipping is silently wrong in both directions:

- An account baked **LIVE** and then suspended from the laptop went grey and sank to the bottom
  **with its code still drawn on the tile**. That is exactly what this whole mechanism exists to
  prevent, and the rule above says it in as many words: a coin that is drawn and then merely
  dimmed is one screenshot away from being scanned. Seen on the live phone as GX Bank, class
  `tile down`, `.tiledot.drawn`, a readable 56px code on a tile the app was calling suspended.
- The reverse was quieter: an account baked **suspended** and then restored kept a blank brand
  disc until the next deploy, because nothing came back to paint it.

The clear is a real clear, `el.width = 8`, which discards the backing store rather than covering
it with a CSS rule, for the same reason the code view resizes its canvas instead of hiding it.
`watchState` now calls `drawThumbs()` alongside `orderTiles()`. The old assertion, "no miniature
is drawn for a suspended account", was pinning `if (down(a)) continue;` and so passed all along
while describing the fault; it now asserts the CLEAR and is mutation tested against that exact
line.

**THIS ORDERING ONLY APPEARS WHEN THE TWO SOURCES DISAGREE**, which is why it went unseen: it
needs the bundle to say live and KV to say suspended at the same moment. It happened because a
restore on the laptop wrote `accounts.json` and lost the KV half to a transient
"The request to Cloudflare's API timed out". `push_kv` retries three times now.

## Motion

**MOTION IS TIERED, and one curve for everything was the bug rather than the discipline.**
Measured on the real zoom in the browser, `cubic-bezier(.32,.72,0,1)` over 420ms reached 95 per
cent of the distance in 203ms and then spent the remaining 217ms creeping through the last five
per cent. Fifty-two per cent of the duration went on motion the eye cannot see, and what it can
see is a snap followed by a dead pause. That is what "barely working, not smooth at all"
described; it was never dropped frames.

Two tiers now, taken from salt-command, which tiers the same way:

| Token | Value | For |
|---|---|---|
| `--dur` / `--ease` | 300ms `cubic-bezier(.22,.8,.36,1)` | screen transitions, the zoom, the flip |
| `--dur-fast` / `--ease-fast` | 140ms `cubic-bezier(.22,1,.36,1)` | anything answering a finger: press, hover, colour |

The transition curve spends 41 per cent on its tail against the old 52, and finishes in three
fifths of the time. The fast tier matters more than it sounds: feedback slower than about 160ms
stops feeling connected to the touch that caused it, which is the easiest way to make an
interface feel broken.

Measured before and after, across opening an account, both flips, a step and going back: twelve
dropped frames became three. The remainder is compositor hiccup, not main-thread work. There are
no long tasks at all during a transition and a forced layout read costs 0.1ms, so every frame is
compositor-only, which is the precondition for 120Hz.

**The script reads its durations from the stylesheet.** Every class `app.js` adds plays a
keyframe `app.css` defines, and the script has to know when to remove it again. Two copies of
that number drift, and the failure is silent: a class stripped mid-animation, or left on long
enough to out-rank the next one. `cssMs()` reads `--dur` and `--dur-fast` once at startup and
everything else is derived, so retuning the motion is a change to one file. The press-and-hold
threshold is deliberately NOT one of them: it is a gesture timing, and shortening the animations
must not make the app easier to save by accident.

**Save is now as quiet as copy.** Copy is nothing but the dip; save was the dip plus a ring at
70 per cent opacity expanding 28 per cent behind a 2px stroke. The dip is the confirmation in
both, and the ring is a hint at the edge of vision: 34 per cent, 12 per cent, one pixel.

**Both views are always laid out and cross-faded; they are never switched with `display`.** This
is the change that fixed the transition rather than decorating it. A `display` swap cannot be
animated, so the list vanished in a single frame while the coin was still flying, which reads as
a glitch and not a transition. Worse, an element inside a `display:none` view reports a zero
rect, so every measurement the zoom needed was conditional on which screen happened to be up,
and it silently cancelled the zoom more than once. Laid out permanently and faded by opacity,
either end can be measured at any moment and the change of screen is something the compositor
does on its own. `visibility` is what takes the hidden view out of hit-testing and the
accessibility tree, delayed by the duration so it does not disappear mid-fade.

**The hash is the only state.** Nothing reads `history.state` to decide what to draw. It did
once, and after a reload that state is stale: `Accounts` called `history.back()` and landed on
whatever entry happened to sit behind, which could be another code, so the app appeared to jump
sideways. `depth` counts only the entries this page session pushed, so back either unwinds one
of ours or rewrites the hash in place, and can never walk off into somebody else's history.

Three further rules, and all three are asserted:

1. **Nothing may be load-bearing.** `prefers-reduced-motion` switches the lot off, in the sheet
   and in `app.js`, so any step that waited on `animationend` would wait for ever on a phone
   that had it set. Every step runs on a timer that collapses to zero instead (`after()`).
2. **One-shot classes remove themselves.** `enter`, `tuck`, `in-*` and `out-*` all set
   `animation` on the same element, so one left behind out-ranks the next by nothing more than
   sitting further down the stylesheet. Leave `enter` on the coin and `tuck` never plays again,
   silently, because the save still works and only the motion is missing. `oneShot()` clears the
   others and then removes itself.
3. **`morph()` takes a rect, not the tile.** The tile must be measured BEFORE the view switches:
   the moment the code view is shown the accounts are `display:none` and every rect on them
   reads zero, so the morph does nothing at all and says nothing about it. That is a bug this
   code has already had once.

## The zoom, and the thumbnails

A tile's badge is the real coin at 36px, drawn by the same renderer. Opening an account flies
that very image up to full size and going back flies it down again, so the two screens are one
object moving rather than a dot being replaced by a picture.

Four things make it work, and each is asserted:

1. **The flier carries the FULL-SIZE render and is only ever scaled DOWN.** It borrows the
   canvas `prerender()` already produced for the swap, so the zoom costs no extra drawing at
   all. Scaling a 36px raster up ten times arrives soft and blocky; scaling a full-size one
   down stays crisp at every frame.
2. **`fly()` takes RECTS, never elements.** Whichever view is hidden reports zeros for
   everything in it, so each end is measured by the caller while its own view is on screen.
   This is the bug the previous version had, and it fails silently: no error, no animation.
3. **`goBack()` shows the list itself before measuring.** `history.back()` is asynchronous, so
   popstate has not fired yet and the tile would still measure zero. `renderList()` is
   idempotent for that reason, or the popstate that follows would restart the stagger halfway
   through the zoom.
4. **The thumbnails are `decorative: true`.** That is the one door out of the safe-size rule:
   at 36px a code is a texture, not something anyone can scan, so the renderer skips the
   fallback that would otherwise put a tiny plain black square on every tile. The suite asserts
   the option appears exactly once, so it cannot spread to the code view.

Every thumbnail is drawn TOGETHER with the rest, before the list is shown. One per idle callback
looked like a download in progress, coins arriving one after another, which is exactly
what it is not. Drawing them together costs one encode per account at startup and almost
nothing thereafter, because the matrices are then cached; decorative mode also draws each module
as a plain rect rather than a rounded blob, which at a module of about one pixel is identical to
look at and cheaper to paint.

## What was measured, and what it cost

Three things were making the animation jitter, all found by measuring in the browser rather
than by reading the code. None of them raised an error.

**The aurora was the worst of it.** Three fixed 568px circles with `filter: blur(74px)`, whose
`background-color` was transitioned on every account change. A colour transition cannot be
composited, so all three were re-blurred on every frame for half a second, at exactly the moment
the coin was animating. It is now two stacked layers of radial gradients with no filter at all,
cross-faded by opacity, which the compositor does on its own.

**The coin transitioned its `box-shadow`,** which carries blur radii up to 88px. That is a full
repaint per frame, landing precisely on the press. Transform only now, plus `will-change` so it
sits on its own layer.

**BATCHING THE MODULES INTO ONE PATH IS FOURTEEN TIMES SLOWER, and it is worth knowing why.**
The obvious optimisation is to accumulate every module into one `Path2D` and fill once rather
than fifteen hundred times. Measured on the same 1,172 modules in the same browser: 25.8ms for
one path against 1.84ms for individual fills. A fill is charged by the bounding box of its path,
so one path spanning the whole 686px code makes the rasteriser walk every scanline of the box
and sort thousands of edges, where each small fill touches only its own nine pixels. It turned a
6ms draw into 17ms. It was tried, measured and reverted; `test/verify.mjs` now asserts against
it so it cannot come back on the same reasoning.

**ENCODING IS THE EXPENSIVE HALF, AND IT IS CACHED.** Measured in Chrome: 4.8ms to encode a
payload against about 2ms to draw it, so the Reed-Solomon pass was seventy per cent of a
full-size render and effectively the entire cost of a thumbnail, and it was being paid again on
every redraw, every step between accounts and every resize. The matrix is a pure function of
the payload and the level and is only ever read, so `plan()` keeps one per account for the life
of the page. A coin draw went from 6.8ms to 1.59ms and redrawing all thirteen thumbnails from
69ms to 5.4ms. If a render ever feels slow again, measure `plan()` before touching the drawing.

**The coin's shadow is cast from its ALPHA, never from a box.** The button is a circle and the
coin inside it is scalloped, so more than a third of the samples around its rim are transparent.
A `box-shadow` on the button showed straight through those valleys as a hard dark ring behind
the coin, and it appeared at the END of the zoom because that is the moment the coin, and with
it its shadow, was revealed. `filter: drop-shadow` follows the alpha and so follows the
scallops. For the same reason the canvas carries no `border-radius`: a 50 per cent radius clips
the lobe tips off.

**A step pre-renders.** A draw is six to fourteen milliseconds, most of a frame, and doing it at
the halfway point of a step dropped one right where the eye was following the coin. The incoming
coin is now rendered to an offscreen canvas before the exit animation starts, so the swap is a
`drawImage` of about 0.01ms and the hitch lands in the gap before anything moves.

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
| `src/vendor/*-mark.js` | **Generated. Do not edit.** A traced logo, registering itself on `self.MARKS`. |
| `tools/vectorise.mjs` | A bitmap logo in, path data out. Run by hand when a mark is added. |
| `tools/build.mjs` | Master store in, `public/` out, with the leak check and the disclosure. |
| `public/marks.js` | Every traced mark in one file, so a logo costs no extra request. |
| `test/verify.mjs` | The whole suite. No network, no browser. |
| `test/vendor/jsqr.js` | The decoder. **Test only, never shipped.** |
| `public/` | Build output, committed so the deployed bytes are the reviewed bytes. |
| `wrangler.jsonc` | Worker, assets, and one READ-ONLY KV namespace. No secrets, no vars. |

## Working on it

```
npm run build     # master -> public/
npm test          # 180 assertions, about ten seconds, no network
npm run check     # both
npm run dev       # build, then wrangler dev
npm run deploy    # build, test, then wrangler deploy. The test is not optional here.
```

`QR_MASTER` overrides the master path for both the build and the suite.

Six things that will bite:

- **`compatibility_date` must not exceed what the installed runtime supports.** wrangler 4.120.0
  tops out at 2026-08-08 and refuses to start on anything later, locally and on deploy.
- **DO NOT EDIT THESE FILES THROUGH A SHELL HEREDOC.** The Bash tool on this machine collapses
  one level of backslash on the way in, so a script that says `"\x00"` reaches the interpreter as
  a literal NUL and writes one into the file. It has happened twice, into a string in
  `build.mjs` and into the cache-key separator in `qr-art.js`, and it raises nothing: a NUL is a
  legal character in a JS string, so the file parses, the build runs and the only symptom is a
  comparison that quietly stops matching. The suite now sweeps every source and shipped file for
  control bytes, which is the assertion that would have caught both. Use the editing tools.
- **The suite decodes about a thousand renders on every run,** which is the point of it: do
  not trim the size sweep to make it quick. It is not slow, though. Caching the encode in
  `plan()` took it to roughly ten seconds, and the docs claimed "a couple of minutes" long
  after that stopped being true.
- **The saved image is built with `toDataURL`, not `toBlob`, and that is load-bearing.** iOS
  only allows `navigator.share` from inside the gesture that triggered it, and awaiting
  `toBlob` is enough to lose that permission. The failure is silent: the share sheet simply
  never appears. `cardOf()` is synchronous and cached for that reason, and the suite asserts
  `toBlob` does not come back.
- **The grid's `minmax` is 132px and must not grow.** Two columns must fit the narrowest phone,
  or the list becomes a single file to hunt up and down. At 375px, 132px yields two 167.5px
  columns, measured.
- **THE LIST SCROLLS, AND THE ROW HEIGHT IS WHAT MAKES IT.** `grid-auto-rows` was
  `minmax(60px,1fr)`, so the rows divided up whatever height was left and thirteen accounts
  always fitted exactly: `overflow-y:auto` below it could never fire. The visible symptom was
  not the missing scroll, it was that the tiles were large and empty while the coin and the
  name inside them stayed at 36px and 13.5px. Fixed at 138px the content sets the size and the
  list overflows, 1,018px of rows against 736px of room on a 375x812 phone. Ripping out "every
  account on screen at once" in exchange for a list that can be read at arm's length is the
  owner's call, made 25 Aug 2026.
- **THE TILE STACKS, and side by side was measured and rejected.** A two-column tile on a 375px
  phone is 168px. With the coin beside the name, padding and gap left 72px of text column, and
  72px is narrower than the words this app contains: `overflow-wrap:break-word` then split them
  MID-WORD, giving "ShopeePa / y" and a maintenance label reading "MAINTENA / NCE", which looks
  like a rendering fault rather than a layout. Stacked, the name gets the full 148px and all
  thirteen sit on one line, "Touch 'n Go Business" included. Anything that puts the coin back
  beside the text has to re-check the longest name and the maintenance label, not just the
  average one.
- **A TAGGED ACCOUNT IS THE EXCEPTION, and it is allowed to be because it is full width.** `tag`
  is a short purpose label; an account carrying one takes a row of its own (`grid-column:1 / -1`,
  which spans whatever auto-fill resolved to rather than assuming two) and lays the coin BESIDE
  the name. The 72px constraint that forced the stack is simply not present at 343px, which
  leaves about 250px of text column. One field with two visible effects is deliberate here: a
  tagged account is a featured account, and a featured account is not sharing its row.
- **THE ORDER IS THE MASTER'S ORDER, WITH ONE RUNTIME EXCEPTION.** The book was traditional
  banks by market share, then digital banks, then e-wallets. JPMorgan Chase now sits first
  regardless, because it is the featured account (owner, 26 Aug 2026). Nothing sorts at BUILD
  time, so `accounts.json`'s array order decides everything else.
- **SUSPENDED ACCOUNTS SINK TO THE BOTTOM, and that sort has to happen at RUN time.** Baking it
  would be wrong, not merely inconvenient: `/state.json` suspends an account from the laptop in
  seconds with no deploy, so a baked order would leave it sitting among the live ones until the
  next release. `orderTiles()` runs after the grid is built and again whenever the KV state
  changes. It MOVES tiles rather than rebuilding them, so `tiles[i]` stays aligned with
  `CODES[i]` and every index the app holds keeps its meaning: the hash, `open(i)`, the thumbnails
  and the zoom's rects. Re-appending an element already in the DOM moves it, so appending in
  display order is the whole operation. The `--i` stagger is renumbered to the visible order, or
  the list deals itself in out of sequence.
- **ONE PLACE DECIDES A TILE'S CLASSES, and for a while there were two.** The KV watcher rebuilt
  the string as `"tile down"` or `"tile"`, which quietly dropped `wide`, so a suspension arriving
  from the laptop collapsed the featured account's full-width row into a normal one. Both callers
  go through `classOf()` now, and the suite asserts the watcher does not build the string itself.
- **`shipped[0]` IS NOT NECESSARILY A CODE.** The suite used it in fourteen places to mean "any
  account, for a rendering test", which was true only while every account had a payload. Moving a
  code-less account to the front made all fourteen throw. They read `codes[0]` now, which is what
  they always meant.
- **`--thumb` and `THUMB` in `app.js` are one number in two files and must be changed together.**
  56px now, from 36px.
- **`.accounts` overrides all four paddings, so the safe-area insets have to be added back with
  `calc()`.** `.accounts,.codeview` sets them in one `padding` shorthand and every longhand in
  `.accounts` overrides it, so plain `16px` threw them away silently. It barely showed while the
  list could not scroll; once it could, the last row scrolled under the home indicator and into
  the strip iOS reserves for the swipe-up gesture. `.codeview` adds no longhands and is fine.
- **Closing an account scrolls its TILE back into view before measuring, not its coin.** An
  off-screen tile still reports a perfectly valid rect, so without this the coin flies off the
  edge to a place the eye cannot follow, silently. `block:"nearest"` is deliberate: it moves the
  list only when the tile is actually out of view, so returning does not otherwise throw away
  the scroll position. Scrolling the `.tiledot` instead is not enough, because the coin sits
  22px inside the tile and the tile's bottom edge stays clipped.
- **There is no plain-code pill and no title above the coin.** The pill went on the owner's
instruction; what remains is the renderer dropping to the plain code BY ITSELF below
`safePhysicalPx`, which is a safety net rather than a preference and is still asserted. The
title went for the same reason it should never have been there: the provider's name is struck
around the coin's rim, and repeating it in 28px above was saying the same thing twice. The
coin's `aria-label` still carries it, so a screen reader loses nothing.

**There is no Save button, and that is a decision to defend rather than an omission.** The
  affordance carries it: the coin is drawn as a physical token, with a contact shadow, a lit rim
  and a press state, and the action is press-and-hold, which is the gesture a phone has already
  taught for keeping a picture. A tap does the same for the other instinct, and `.tuck` plays on
  save so the motion explains itself the first time. Three attempts got here: a rail nobody could
  reach the end of, then a grid hidden behind the title with a row of colour dots, which was
  worse because six of the brands sit within twenty degrees of red, and Boost Bank and
  Boost are the same #ED1C24 exactly, to the byte. Colour was the only signal, and it was not
  enough to be one. Only the name and the rim legend separate that pair, which is why the
  legend is not decoration and must survive any restyling of the coin.

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

- **No edit path.** No `edit.html`, no `POST`, no `EDIT_KEY`. Editing is a laptop job,
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

## The iPhone standard, from salt-command v392 (28 Aug 2026)

His instruction of 28 Aug: optimise everything as a web app on iPhone, and design around the
Dynamic Island. Salt Command had five faults; this repo already avoids four of them and the
audit is recorded so it is not repeated.

**Where this app already stands, checked rather than assumed.** `src/app/app.css` uses
`safe-area-inset-top` (two rules), the tap token is `--tap:44px`, no rule measures itself
against `100vh` (the three `vh` uses are `2vh` and `4vh` spacing), and the app has no typed
fields, so the iOS zoom fault cannot arise. Nothing here needs doing.

**The one thing that DID need doing was not here, it was in the master, and it is done
(2 Sep 2026).** `Code\pay-afif-site\edit.html` set `input,select,textarea{font-size:14px}` and
`textarea{font-size:12px}` across TWELVE fields. **iOS zooms into any field under 16px on focus
and does not zoom back out**, so tapping any of them left the whole editor magnified. It also
set `input[type=color]{width:38px;height:38px}`, six points under the 44px minimum, and the
per-item `↑ ↓ ✕` tools at 30x34, one of which is REMOVE. All are on 16px and `--tap` now.

**The rule, so a later screen does not reintroduce it:**

- `env(safe-area-inset-*)` is read into `--safetop`/`--safebot` ONCE and used through the
  variables, never written out at each site. That is not tidiness: `env()` returns zero in every
  desktop browser, so a fix written as bare `env()` cannot be measured. With variables a probe
  forces the iPhone 15 Pro figures, 59px and 34px, and the layout is testable.
- `viewport-fit=cover` with `status-bar-style:black-translucent` is an instruction to draw UNDER
  the status bar and the island. If both are set, the top inset is mandatory, not optional.
- The Dynamic Island is CENTRED, so a control on the right is never inside its rectangle and is
  still unreachable. The whole strip above the inset is dead. Pad the strip; do not move sideways.
- 44px minimum on anything a finger hits, from one token.
- No field under 16px.
- `dvh`, never `vh`: iOS Safari's toolbar changes the viewport under the page.

## This app is the reference design (2 Sep 2026)

His instruction: the local page and the phone app are one product and should look like it.
There were **three** designs across the two repos, and this one was the only finished one, so
the other two moved to it rather than the other way round. The work is in
`Code\pay-afif-site`; what matters here is what it means for this repo.

**Three files flow OUT of here and are generated at the destination**, by
`pay-afif-site\tools\sync-design.mjs`: `src/app/qr-art.js`, the `:root` block of
`src/app/app.css`, and now `src/vendor/*-mark.js` concatenated as `marks.js`. Accounts flow the
other way. **Change the look here, then run the sync there.** A hand-edit at the destination is
lost, and worse, silently makes the two disagree. The renderer had gone 293 lines stale.

**Tokens alone do not make one design, and that is the lesson.** The local page had the token
block all along and then painted a second palette over it. Sharing `:root` buys a shared
palette; it does not stop a page from having a teal masthead, cyan gradient headlines and its
own type stack sitting on top of it.

**Drift reaches through CALL SITES too.** Both pages ran this exact renderer and still drew the
same account differently, because the local `coin()` passed a different option set: no `ring`,
no marks, and `acct`. `paintFace` here is the shape to copy: one place assembling the options,
with the `acct`-is-deliberately-absent note attached to it.

**What changed in THIS repo, and it is two lines.** `.tiledot` is `border-radius:50%` while it
is a plain brand disc, and `drawThumbs` adds `.drawn` to drop the radius once a coin is painted
into it. The radius has to go then, because at 50 per cent it clips the tips off the scalloped
rim, which is why the big coin's canvas carries none. But the disc is not only a passing state:
a SUSPENDED account never gets its coin drawn at all, so it is what that tile shows for the
whole suspension, and a grey square there reads as a failed image where a grey circle reads as
a coin deliberately withheld. Visible today on GX Bank.
