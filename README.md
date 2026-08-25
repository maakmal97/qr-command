# QR Command

Your payment codes, on your phone, drawn on the device and working with the radio off.

Two screens. Your accounts, and one code. Nothing else is on the page and nothing else is in
the bundle.

---

## Putting it on the phone

1. Open the address in **Safari** on iPhone, or **Chrome** on Android.
2. iPhone: Share, then **Add to Home Screen**. Android: menu, then **Install app**.

After the first visit it works with no signal. The codes are drawn on the device, so nothing is
fetched when you open it.

## Using it

**The app opens on your accounts.** The featured one sits across the top on a row of its own,
labelled with what it is for. The rest are two columns, each one named, with its own coin beside it
big enough to tell apart at a glance. The list scrolls if your phone is not tall enough to hold
all of them, and the row cut off at the bottom edge is how you know there is more. Tap one and
its code fills the screen. **Accounts** at the top left goes back, and so does your phone's own
back gesture; whichever account you came from is scrolled back into view for you.

| | |
|---|---|
| **Save the code to your photos** | **Tap it**, or press and hold, the same way you would keep any picture on a phone. The caption under the coin says **Tap to save** so you never have to guess. The coin dips as it goes. On iPhone the share sheet offers Save Image; elsewhere it downloads. |
| Next or previous | Swipe left and right across the code. A swipe never counts as a tap, so changing code cannot save one by accident. |
| **The account number** | Press **Copy account number**. It goes straight to your clipboard, digits only, ready to paste into a banking app. **It is never put on screen**, so it cannot be read over your shoulder or end up in a screenshot of the code. An account under maintenance will not hand it out either. |
| **An account with no code** | Some accounts have no DuitNow code. Their coin is an instruction instead: **BANK**, the one to pick from your app's list, and **RECEIVER**, whose logo tells you the name your app will show before you confirm. The number is not on the face; **Copy account number** gets it. There is no code to save, so a tap copies too. |
| Under maintenance | An account being changed on the laptop shows **Under maintenance** and no code at all. Flip it from the local page; the phone follows within seconds. |
| Keyboard | Left and right arrows step through, `Enter` or `S` does whatever a tap would, `C` copies the account number, `Esc` goes back. |
| One account, every time | The address ends in the account's key, so `.../#maybank` opens straight onto it. Point the home-screen icon there and the app skips the list. |

There is no plain-code button any more. The renderer drops to an ordinary black-and-white
code BY ITSELF when the coin would be too small to scan, which is a safety net rather than a
preference, and on a phone it never triggers.

**The motion is part of the answer, not decoration.** Each account's badge in the list is the
same coin, drawn small, so tapping one **zooms that exact coin up** to fill the screen, and going
back shrinks it into its place in the list. It is one object moving, not a dot being swapped for
a picture. One curve and one duration run the whole thing, so the coin, the screen behind it and
the title all settle at the same moment.

The list deals itself out the first time you open the app, and not again, so coming back to it
feels like returning to something that was already there. Stepping between accounts sends the
coin out the way your thumb went and brings the next in from the far side. Saving dips the coin
and throws a ring off it. If your phone is set to reduce motion, none of it plays and everything
still works, instantly.

## Changing the list of codes

Not here. **Adding, editing and removing codes is a laptop job**, in the master project:

```
C:\Users\maakm\Claude\Code\pay-afif-site
```

Run `serve.py` there, use `edit.html`, save. Then come back here and ship it:

```bash
npm run deploy
```

That rebuilds the bundle from the master, runs the suite, and pushes. Phones pick the change up
on their next open. There is deliberately no way to edit from the phone: it means the deployed
site has no write path at all, so there is no key to leak and nothing to authenticate.

## What is public, and what that means

The site is public. Anyone who knows the address can open it and see your provider names and
your codes. That is a considered decision, not an oversight: a DuitNow code can only be used to
**send** you money, never to take any.

Two things follow, and the second is the one worth knowing:

- The page prints the provider name and the code. Your account numbers are **no longer shown on
  screen** anywhere, but they are still IN the page: they have to be, or Copy account number
  would have nothing to copy and the app would stop working with the radio off. So anyone who
  views the page source still reads every one of them, exactly as before. Taking the number off
  the coin is about who can see it over your shoulder, not about who can find it.
- **Your legal name is still not printed anywhere, and it cannot be.** The account with no code
  does name a receiver, but that receiver is a company: **Wise Payments Malaysia Sdn Bhd**, which
  is who the account is actually held with. It is there so that whoever pays you is not startled
  by an unfamiliar name at the moment they confirm. Your own name is a different matter and is
  refused outright: a receiver that matches you or any owner, by exact spelling **or by a
  squashed stem that survives slugging**, stops the build with a message saying why. It is never
  filled in from your owner record either, so it can only ever be something somebody typed
  deliberately.
- Your groups and the DuitNow member numbers are still dropped at build time and never leave the
  laptop. The build checks that by reading the bundle back and searching it, and the suite
  checks it again, in both directions.
- **The codes themselves still carry your name.** A DuitNow payload is an EMVCo string with the
  account-holder name as a mandatory field, and for six of your thirteen the account number is
  in there in the clear too. Anyone who scans a code sees those in their banking app before they
  pay, which is exactly what that field is for. No page design can change it, and this one does
  not pretend to. If that matters more than convenience, the answer is a private address rather
  than a different layout.

The site sets `X-Robots-Tag: noindex`, so it stays out of search engines. **The repository is
private and must stay private**, which is a stricter bar than the site itself: a page behind an
unadvertised address is not the same exposure as a file that GitHub scrapes, indexes and
archives permanently.

## The coin, and why there is no Save button

The code is drawn as a struck coin in the provider's own colour, held in a gravitational lens:
the disc bends the light behind it into arcs that sweep around the rim and close, at one radius,
into a single complete ring. The provider's name runs around the rim, the field is tinted paper,
the eyes are rounded, and the whole page shifts colour to match. The modules are liquid: a lone
one is a circle, a run of them is a capsule, a block is a rounded slab.

**Every provider gets its own sky.** How many arcs, where they fall and how far they sweep all
come from a hash of the provider's key, so Maybank is always the same and never ShopeePay's, on
every device, for ever, with nothing stored anywhere to remember it. It matters more than it
sounds: Boost Bank and Boost are the same red to the byte, so colour alone could never tell you
which one you were looking at.

**The shape is the instruction.** The coin sits on the page as a physical thing: a contact
shadow beneath it, a lit rim along the top, and it presses in under a finger. There is no
button and no caption telling you what to do with it, because the gesture is the one your phone
has already taught you for keeping any picture. Press and hold. The coin dips as it goes, which
is the only explanation the action ever needs, and a tap does the same for anyone whose instinct
runs that way.

**The coin has one side.** It used to turn over to a back carrying PayNet's DuitNow mark and
your account number struck into the metal, which meant that copying the number began by putting
it on screen. **Copy account number** does it without that, so the number goes from the page to
your clipboard having never been visible, and the reverse had nothing left to do. PayNet's
artwork went with it rather than being left in the bundle unused: it is their trademark, its use
is governed, and shipping a copy of it that nothing draws is a liability with no upside.

It is decoration over an exact code, never a redrawing of one. Every module sits at its precise
grid position; only the shape, the colour and the frame change, and a decoder samples none of
those. The four-module quiet zone is why the code fills about 58 per cent of the coin's width
rather than more: the white disc has to enclose the code and its margin, corners included.

None of that is taken on trust. `npm test` draws every real code with the renderer that ships
and reads it back with a decoder, at every size and pixel ratio the app can produce, roughly a
thousand renders a run. It also measures the finder patterns out of the painted pixels, checks
the quiet zone is light on all four sides, and asserts that nothing outside the eyes is painted
against the matrix.

Two measured numbers govern it:

- **380 pixels** is the smallest the worst code will still read at, measured at the size the
  screen actually shows rather than the size it is drawn into, which is not the same thing and
  was quietly flattering the old number.
- **580 pixels** is the size below which the app stops drawing coins and shows the plain code
  instead, which reads down to 230. On a phone the coin is two to three times that, so you will
  not meet the threshold in normal use.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:8788
npm test
```

`CLAUDE.md` is the longer account: why the error correction is M rather than H, why module edges
are snapped to whole pixels, and which rules are load-bearing.
