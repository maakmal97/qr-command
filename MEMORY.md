# QR Command: current facts

## What this is
The payment-QR consolidator on the phone: a Cloudflare Worker serving a static bundle built
from `data/accounts.json`. Two screens: the accounts list, and one account shown the way the
chosen rail pays it. On QR, a code drawn on the device as a one-sided coin; press and hold
saves it. On Transfer, the bank and the number; on JomPAY, the biller code and references;
each value copies on a tap. One edit surface, `/admin/`, behind Cloudflare Access, sets which
accounts show and their order.

## Bundle fields (CLAUDE.md rule 4)
14 fields ship: `key`, `name`, `brand`, `payload`, `acct`, `maintenance`, `bank`, `holder`,
`bankMark`, `holderMark`, `tag`, `ring`, `biller`, `ref1`.

## Design tokens source (CLAUDE.md rule 7)
Generated from the `:root` of `Code\salt-ds\src\styles.css`: the owner's own "Salt
Commodities" design system, not JPMorgan's Salt.

## Cross-repo coordination (payer's link)
The payer's-link format is also implemented by salt-command's `stmt/pay.js` (`payHref`),
whose suite reads it back through this repo's `linkOf`. This repo shipped the format first.

## Tooling
wrangler 4.120.0; `compatibility_date` tops out at 2026-08-08.

## Testing
`test/verify.mjs`: about 250 assertions, no network; decodes about a thousand renders per run.
