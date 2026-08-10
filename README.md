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

**The app opens on your accounts.** All thirteen, named, on one screen, nothing hidden and
nothing to scroll. Tap one and its code fills the screen. **Accounts** at the top left goes
back, and so does your phone's own back gesture.

| | |
|---|---|
| **Save the code to your photos** | **Press and hold it**, the same way you would keep any picture on a phone. A plain tap does it too. The coin dips as it goes. On iPhone the share sheet offers Save Image; elsewhere it downloads. |
| Next or previous | Swipe left and right across the code. A swipe never counts as a tap, so changing code cannot save one by accident. |
| Plain code | The small pill under the code, for a scanner that is struggling. |
| Keyboard | Left and right arrows step through, `Enter` or `S` saves, `P` toggles plain, `Esc` goes back. |
| One account, every time | The address ends in the account's key, so `.../#maybank` opens straight onto it. Point the home-screen icon there and the app skips the list. |

The app remembers whether you left it in plain mode.

## Changing the list of codes

Not here. **Adding, editing and removing codes is a laptop job**, in the master project:

```
C:\Users\maakm\Claude\Projects\Personal\Cow-Fin06_QR Consolidator\pay-afif-site
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

- The page prints **only the provider name and the code**. Your legal name, your account
  numbers, your groups and the DuitNow member numbers are dropped at build time and never leave
  the laptop. The build checks this by reading the bundle back and searching it, and the test
  suite checks it again.
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

The code is drawn as a struck coin in the provider's own colour: a scalloped edge, the
provider's name around the rim, a tinted paper field and rounded eyes, and the whole page
shifts colour to match. The modules are liquid: a lone one is a circle, a run of them is a
capsule, a block is a rounded slab.

**Every provider's coin has its own outline.** The number of scallops and where they fall come
from a hash of the provider's key, so Maybank is always the same shape and never ShopeePay's,
on every device, for ever, with nothing stored anywhere to remember it.

**The shape is the instruction.** The coin sits on the page as a physical thing: a contact
shadow beneath it, a lit rim along the top, and it presses in under a finger. There is no
button and no caption telling you what to do with it, because the gesture is the one your phone
has already taught you for keeping any picture. Press and hold. The coin dips as it goes, which
is the only explanation the action ever needs, and a tap does the same for anyone whose instinct
runs that way.

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

- **360 pixels** is the smallest the worst code will still read at.
- **560 pixels** is the size below which the app stops drawing coins and shows the plain code
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
