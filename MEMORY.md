# Salt QR: current facts

## What this is
The payment-QR consolidator on the phone: a Cloudflare Worker serving a static bundle built
from `data/accounts.json`. Two screens: the accounts list, and one account shown the way the
chosen rail pays it. On QR, a code drawn on the device as a one-sided coin; press and hold
saves it. On Transfer, the bank and the number; on JomPAY, the biller code and references;
each value copies on a tap. One edit surface, `/admin/`, behind Cloudflare Access, sets which
accounts show and their order.

## Visibility
Public since 14 Oct 2026, his decision, so CI runs on free Actions minutes. Before the switch every account was set under maintenance in KV `state` (14 of 14, read back live); the accounts stay suspended until he lifts them in `/admin/`.

## Accounts
15 since 17 Nov 2026: `atlas` (ATLAS by Bank Muamalat, Savings Account-i, DuitNow id 564167)
added on QR and Transfer, baked `maintenance: true`. KV `state` predates it, so the baked flag
holds until his next `/admin/` save writes it in. Its mark is traced from the orange wordmark
paths of the official `atlasmuamalat.com.my/.../logo.svg`, rendered to a PNG first.

## Bundle fields (CLAUDE.md rule 4)
15 fields ship: `key`, `name`, `brand`, `payload`, `acct`, `maintenance`, `bank`, `holder`,
`bankMark`, `holderMark`, `tag`, `ring`, `biller`, `ref1`, `note` (20 Nov 2026: one line a payer
reads on the Transfer view, carried to Salt Counter by its paysync).

## Design tokens source (CLAUDE.md rule 7)
Ambient since 17 Nov 2026 (salt-ds until then): `Code\ambient-ds\src\tokens.css` and `ambient.css`,
pulled whole and locked by `tools/designsync.mjs` (Ambient's `consumer/designsync.mjs`). From a
worktree `..\ambient-ds` does not exist: set `AMBIENT_DS`. Last pulled 17 Nov 2026: Ambient 0.7.15
at 97ddc26. The public page uses Ambient's shell, split panes, codeframe and plate; the admin
uses the app's own controls. Not carried yet: `ambient.js`, `icons.svg`. The mood clock: Dusk to Lagoon 05:00 to 06:00,
Lagoon to Flare 16:00 to 17:00, Flare to Dusk 19:00 to 20:00, phone time; only Ambient's seven
registered colours glide, the inks turn at the blend's start. `.sky` is the `.amb-mesh` recipe at
opacity .6. theme-color and the manifest are Slate's dark base #2c2d39.

## Access
`/admin` sits in the shared "Salt / QR" Access application (also covers salt-command), aud
`14a921e2...`, read from the API 14 Oct 2026. If `/admin/` says "Sign in through Cloudflare
Access" while signed in, compare `ACCESS_AUD` with that app's aud first, then that the
signed-in address is `OWNER_EMAIL`: since 05 Nov 2026 `identity()` refuses any other, as
salt-command's `/all` does.

## Cross-repo coordination (Salt Counter)
Since 06 Nov 2026 Salt Counter never links here: salt-command's `stmt/paycodes.js` reads `/data.js` (the
`self.QR_CODES` anchor) and `/state.json` through the binding `QRCMD`, `stmt/paycrc.js` is generated
from `tools/store.js`, and `payHref` and `PAY_SITE` are gone from salt-command. `linkOf` stays for this
app's own payer links.

## Tooling
wrangler 4.152.0 (workerd 1.20261019.1, 23 Oct 2026); `@napi-rs/canvas` 1.0.13; `compatibility_date` set to 2026-08-08.

## Testing
`test/verify.mjs`: 319 assertions (17 Nov 2026), no network; decodes about a thousand renders per run; section 7 runs the shipped `app.js` against a stub page (timers and idle callbacks driven by hand).
`test/responsive.cjs`: optional browser sweep using Playwright and its installed browsers; mocks
state and admin writes and checks the built `public/`.
