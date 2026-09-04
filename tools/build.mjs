/* build.mjs - the master's store in, a shipping bundle out.
 *
 * The one job that matters here is SUBTRACTION. The master record for an account carries a
 * key, a display name, an account number, an owner, a group, a brand colour, a DuitNow member
 * number and the payload. The bundle carries four of those. Everything else is dropped, and
 * the drop is verified afterwards by reading the written files back and searching them for
 * the values that were meant to be left behind, because an allowlist that is never checked is
 * a promise, not a guarantee.
 *
 * The second job is to never touch a payload. It is copied across as a JavaScript string and
 * checked against its own CRC. If the checksum fails the build stops. It is never repaired:
 * the trailing four characters are a checksum over everything before them, so a payload that
 * has been "tidied" can still scan and still pay, just to somebody else.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const APP = path.join(REPO, "src", "app");
const PUB = path.join(REPO, "public");

const MASTER = process.env.QR_MASTER ||
  "C:/Users/maakm/Claude/Code/pay-afif-site";

/* The whole of what leaves the laptop.
 *
 * `acct` was added on 11 Aug 2026 at the owner's request, for the back of the coin: half the
 * point of the app is handing an account number to somebody, and a number nobody can read is no
 * use for that. It is a real change to what a stranger with the address can see, and it was made
 * deliberately rather than drifted into. Before it, an account number was recoverable only by
 * decoding a code, and only for six of the thirteen; now all thirteen are in the page as text.
 * Everything else still stays behind: the payee's legal name, the owner, the group and the
 * DuitNow member number. */
/* `bank` and `holder` were added on 25 Aug 2026, for accounts that have NO DuitNow code at all
 * and are paid by naming the bank, the number and the person.
 *
 * `holder` IS OFF BY DEFAULT AND EMPTY TODAY. It is the one field that would put a person's
 * legal name on a public page as text, so it ships only where the master explicitly types one,
 * never derived from the owner. Nothing sets it as of 25 Aug 2026, by the owner's decision, so
 * the leak check below refuses the payee's name outright exactly as it always has. If one is
 * ever set, the check does not switch off: it pins the name to that one record and dies if it
 * appears anywhere else. The distinction matters because a derived default would make
 * publishing a name a side effect of adding an account rather than a decision about it.
 *
 * It is not a new exposure for a code account, because a DuitNow payload already carries
 * the name in tag 59 and anyone who scans one sees it; it WOULD BE new for an account with no code,
 * where nothing else would have carried it. It ships ONLY for accounts that have no payload, and
 * the leak check below asserts exactly that rather than being switched off. */
/* `tag` was added on 26 Aug 2026: a short purpose label shown on the tile. It also makes the
 * tile take a row of its own, which is the only place in the bundle where one field has two
 * visible effects. That is deliberate and there is exactly one such account: a tagged account is
 * a featured one, and a featured one is not sharing its row. */
/* `biller` and `ref1` added 4 Sep 2026, for JomPAY.
 *
 * A BILLER CODE IS PUBLIC BY DESIGN: PayNet issues it to a registered biller and it is printed
 * on every bill that biller sends. 11445 is INSTAPAY, not the owner, so publishing it discloses
 * nothing about him.
 *
 * REF-1 IS NOT, AND IT IS THE ONE FIELD HERE THAT IS A REACHABLE IDENTIFIER. It is his mobile
 * number, which unlike an account number can be called, messaged, and matched against a
 * messaging app or an account-recovery flow. It ships because a copy has to have something to
 * copy and the phone works with the radio off, exactly as `acct` does, and like `acct` it is
 * NEVER DRAWN: it reaches a banking app through the clipboard without appearing on screen or in
 * a screenshot of the coin. Anyone who views source still reads it. That is the same trade the
 * owner already made for account numbers on 11 Aug 2026, made again knowingly. */
const SHIP = ["key", "name", "brand", "payload", "acct", "maintenance", "bank", "holder",
              "bankMark", "holderMark", "tag", "ring", "biller", "ref1"];

const die = (m) => { console.error("\nbuild failed: " + m + "\n"); process.exit(1); };
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r\n/g, "\n"), "utf8");

/* THE TRACED MARKS, concatenated into one shipped file rather than one request each.
 *
 * Each src/vendor/*-mark.js registers itself on self.MARKS, so load order does not matter and
 * adding a mark is a matter of dropping a file in. They are PATH DATA, not rasters: a Path2D
 * built from a string needs nothing from the Content-Security-Policy, where an image would need
 * `img-src data:` adding to a policy that is currently `default-src 'none'`.
 *
 * Declared HERE, above sanitise(), because sanitise checks every mark id against this list and
 * a const used before its declaration is a temporal dead zone error, not an undefined. */
const VENDOR = path.join(REPO, "src", "vendor");
const markFiles = fs.existsSync(VENDOR)
  ? fs.readdirSync(VENDOR).filter((f) => /-mark\.js$/.test(f)).sort()
  : [];

/* ------------------------------------------------------------------ validation */

/* The master's own validator, imported rather than reimplemented.
 *
 * This is the point of the exercise. The master's CLAUDE.md rule 3 records that serve.py and
 * functions/_lib/store.js are two implementations of one contract with no test asserting they
 * agree, and a later audit found ten places where they had already drifted. Writing a third
 * copy here would have been the same mistake again, and a first attempt at one duly rejected
 * all thirteen live payloads over a prefix it had guessed wrong. So the build imports
 * store.js and asks it. If the master tightens its rules, this build tightens with it, on the
 * next run, with nobody remembering anything. */
async function masterValidator() {
  const file = path.join(MASTER, "functions", "_lib", "store.js");
  if (!fs.existsSync(file)) {
    die("cannot find the master validator at " + file + ". This build deliberately does not " +
        "carry its own copy of the payload rules; see the note above masterValidator().");
  }
  try {
    return await import(pathToFileURL(file).href);
  } catch (e) {
    die("the master validator would not load: " + e.message);
  }
}

/* -------------------------------------------------------------------- the store */

function loadStore() {
  const file = path.join(MASTER, "accounts.json");
  if (!fs.existsSync(file)) die("cannot find the master store at " + file);
  let doc;
  try { doc = JSON.parse(read(file)); } catch (e) { die("the master store is not valid JSON: " + e.message); }
  if (!Array.isArray(doc.accounts) || !doc.accounts.length) die("the master store holds no accounts");
  return doc;
}

function sanitise(doc, V) {
  // The whole document first, by the master's rules: keys, slugs, duplicate payloads,
  // checksums, the lot. A store the master would refuse is never shipped.
  const bad = V.docError(doc);
  if (bad) die("the master store does not pass its own validator: " + bad +
               ". Fix it in the master; never edit a payload here.");

  return doc.accounts.map((a, i) => {
    const where = "account " + (i + 1) + " (" + a.key + ")";
    // The two fields the phone actually displays have to exist, which docError does not
    // require of brand.
    if (typeof a.brand !== "string" || !/^#[0-9a-fA-F]{6}$/.test(a.brand)) {
      die(where + " has no brand colour, and the coin is drawn from it");
    }
    if (!String(a.name || "").trim()) die(where + " has an empty name");
    const rec = {};
    for (const f of SHIP) rec[f] = a[f];

    /* AN ACCOUNT WITH NO PAYLOAD CARRIES DETAILS INSTEAD, and the two shapes are kept apart
     * here rather than left for the phone to infer. `payload` is normalised to a real empty
     * string when absent, for the same reason `maintenance` is normalised to a real boolean:
     * a field present on some records and missing from others is a field every reader has to
     * guess about, and this one decides whether a scannable code is drawn at all. */
    rec.payload = typeof a.payload === "string" ? a.payload : "";

    /* THE BANK SHIPS FOR EVERY ACCOUNT, AND IT USED TO BE BLANKED ON THE CODE ONES.
     *
     * The old line read `if (rec.payload) rec.bank = ""`, with the reasoning that "a code
     * account says nothing about a bank". That was true while a code account could only be
     * paid by scanning. It stopped being true on 4 Sep 2026: every account here also has an
     * account number at a real institution, so all fourteen are payable by DuitNow Transfer,
     * and a transfer begins by picking that institution out of a list. Blanking it meant the
     * master could hold the answer and the phone could not see it - which is what happened:
     * thirteen bank strings were written to accounts.json and the build id did not move.
     *
     * The institution is not a guess. It is tag 26.01 of each payload, the six-digit PayNet
     * member code the master carries as `mid`, and two accounts share one (Touch 'n Go, both
     * on 890053). What the master types is the DISPLAY string a payer sees in that list. */
    rec.bank = String(a.bank || "").trim();
    if (!rec.payload && !rec.bank) die(where + " has no payload and no bank, so there is nothing to show");

    if (rec.payload) {
      /* A HOLDER ON A CODE ACCOUNT KILLS THE BUILD, and it used to be discarded in silence.
       *
       * The asymmetry with `bank` is the point rather than an oversight. On a code account the
       * receiver is the OWNER, so a `holder` there would be his own legal name on a public
       * page. `holder` exists for the opposite case: a receiver that is an institution rather
       * than a person, which a payer must be warned about before they confirm.
       *
       * Blanking it was safe but silent, and silence is the wrong answer to a master that has
       * typed a name where one cannot go: mutation tested by putting the owner's full name on
       * Maybank, and the build sailed through and shipped a clean bundle. Whoever typed it
       * would have no idea whether it had been published or dropped. It stops the build now,
       * which is what the owner-name guard further down does for the code-less accounts. */
      if (String(a.holder || "").trim()) {
        die(where + " has a payload AND a holder. A holder names a receiver that is not the " +
            "owner, which only makes sense for an account with no code; here the receiver IS " +
            "the owner, so this would be his own name. Remove it in the master.");
      }
      rec.holder = "";
    } else {
      /* THE NAME IS NEVER DERIVED. It ships only where the master TYPES a `holder`, and this
       * line is the whole of that policy.
       *
       * The first version resolved it from the owner's legal name, so every code-less account
       * printed it automatically. That is the wrong default for the one field that puts a
       * person on a public page: it makes publication a side effect of adding an account
       * rather than a decision about it. Silence is the default now, and opting in means
       * typing the name into the master where it can be seen and removed. */
      rec.holder = String(a.holder || "").trim();
    }
    /* Mark ids, normalised to real strings and checked against what was actually traced. An id
     * with no file behind it would draw nothing and say nothing, which is the quiet kind of
     * wrong; naming it here means a typo stops the build instead. */
    rec.bankMark = rec.payload ? "" : String(a.bankMark || "").trim();
    rec.holderMark = rec.payload ? "" : String(a.holderMark || "").trim();
    for (const [f, id] of [["bankMark", rec.bankMark], ["holderMark", rec.holderMark]]) {
      if (id && markFiles.indexOf(id + "-mark.js") === -1) {
        die(where + " names " + f + ' "' + id + '", but src/vendor/' + id + "-mark.js does not " +
            "exist. Trace it with tools/vectorise.mjs, or remove the field.");
      }
    }
    // The master calls it `sub`; the bundle calls it `acct`, because on the phone it is not a
    // sub-label, it is the number somebody is about to type into their banking app.
    // Normalised to a real string for the same reason maintenance is a real boolean: a field
    // present on some records and missing from others is one the phone has to guess about.
    rec.tag = String(a.tag || "").trim();
    /* The optional SECOND colour, which strikes the ring around the face while `brand` strikes
     * the face itself. Validated here as well as by the master, because the coin is drawn from
     * it and a bad colour is a coin nobody can read rather than a document nobody can save. */
    rec.ring = String(a.ring || "").trim();
    if (rec.ring && !/^#[0-9a-fA-F]{6}$/.test(rec.ring)) {
      die(where + " has ring " + JSON.stringify(rec.ring) + ", which is not a 6-digit hex");
    }
    rec.acct = typeof a.sub === "string" ? a.sub.trim() : "";
    if (!rec.acct) die(where + " has no account number, and the back of the coin needs one");

    /* JOMPAY, and the pair is validated here as well as in the master for the same reason the
     * ring is: a half-address reaches the phone as a rail the app offers and nobody can pay to.
     * Both or neither, digits only, and never reformatted; what the biller issued is what has
     * to be typed. */
    rec.biller = String(a.biller || "").trim();
    rec.ref1 = String(a.ref1 || "").trim();
    if (!!rec.biller !== !!rec.ref1) {
      die(where + " has " + (rec.biller ? "a biller code but no ref1" : "a ref1 but no biller " +
          "code") + ". JomPAY needs both, or the account offers a rail nobody can pay to.");
    }
    if (rec.biller && !/^[0-9]{4,6}$/.test(rec.biller)) {
      die(where + " has biller " + JSON.stringify(rec.biller) + ", not a 4 to 6 digit code");
    }
    if (rec.ref1 && !/^[0-9]{1,32}$/.test(rec.ref1)) {
      die(where + " has ref1 " + JSON.stringify(rec.ref1) + ", which is not a run of digits");
    }

    /* MAINTENANCE IS NORMALISED TO A REAL BOOLEAN, always present, never absent.
     *
     * A field on some records and missing from others is a field the phone has to guess
     * about, and it breaks the check below that every record carries exactly the shipped
     * set and nothing else. More to the point, this one decides whether a scannable code
     * is put in front of somebody: an undefined that reads as falsy by luck is not how
     * that should be decided. True only when the master says true, false in every other
     * case, including the field being absent, misspelt, or a string. */
    rec.maintenance = a.maintenance === true;
    return rec;
  });
}

/* ---------------------------------------------------------------- the leak check */

/* Everything the master holds that must not reach the internet, gathered from the master
 * itself rather than typed here, so a new field added upstream is covered on the next build
 * without anyone remembering to come back. */
function secrets(doc) {
  const s = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (t.length < 4) return;
    s.add(t);
    const squashed = t.replace(/[\s-]/g, "");
    if (squashed.length >= 6) s.add(squashed);
  };
  add(doc.payee);
  (doc.owners || []).forEach((o) => { add(o && o.name); add(o && o.legal); });
  doc.accounts.forEach((a) => {
    Object.keys(a).forEach((k) => {
      // `sub` now ships deliberately, as `acct`. Everything else on the record still does not.
      if (SHIP.indexOf(k) === -1 && k !== "owner" && k !== "group" && k !== "sub") add(a[k]);
    });
  });
  return [...s];
}

/* A NAME DOES NOT ONLY TRAVEL AS ITSELF. The check above compares exact strings, and a person's
 * name reaches a page far more often as a slug: lowercased, spaces turned to hyphens, and cut to
 * some length. That is not hypothetical. The master keyed a new account
 * `muhammad-afif-akmal-bin`, a truncated slug of the payee, and because it matched no forbidden
 * string byte for byte it went into the bundle and would have become the public URL of the page.
 * The squashed form the set already carries does not help: the slug is a PREFIX of it, not equal.
 *
 * So for person names, and only for those, compare stems. Strip everything that is not a letter
 * or a digit from both sides and ask whether the output contains the first twelve characters of
 * the name. Twelve is long enough that no real word or hash trips it and short enough to survive
 * any truncation a slug is likely to apply. */
const STEM = 12;

function nameStems(doc) {
  const out = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    const n = v.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (n.length >= STEM) out.add(n.slice(0, STEM));
  };
  add(doc.payee);
  (doc.owners || []).forEach((o) => { add(o && o.name); add(o && o.legal); });
  return [...out];
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const TEXT = /\.(html|js|mjs|css|json|webmanifest|txt|map|svg)$/i;

function auditPublic(doc, codes, V) {
  const files = walk(PUB);
  const rel = (f) => path.relative(PUB, f).replace(/\\/g, "/");

  // Nothing that is not part of the app may sit in the deploy root.
  const banned = /\.(md|pdf|py|pyc|pem|key|bak|zip|log)$/i;
  for (const f of files) {
    if (banned.test(f) || /(^|\/)(backups|__pycache__|node_modules)(\/|$)/.test(rel(f))) {
      die("public/" + rel(f) + " would be deployed and has no business being there");
    }
  }

  /* The values that were meant to stay on the laptop must appear nowhere in the output,
   * EXCEPT inside a payload, where they are not the bundle's to remove.
   *
   * A DuitNow payload is an EMVCo TLV string and the account-holder name is a mandatory field
   * within it (tag 59); for some banks the account identifier sits in tag 26 in the clear as
   * well. So the name is carried by the code itself, and anyone who scans the code sees it in
   * their banking app before they pay, which is the point of that field. Nothing this page
   * does can change that, and pretending otherwise by refusing to look inside the payload
   * would be the wrong kind of tidy. What the page controls is its own surface: it prints the
   * provider and the code, and nothing else. So the check below strips the payloads out and
   * asserts that not one of those values appears anywhere else. */
  const forbidden = secrets(doc);
  const stems = nameStems(doc);
  const payloads = codes.map((c) => c.payload).filter(Boolean).sort((a, b) => b.length - a.length);

  /* A HOLDER IS A BENEFICIARY, AND A BENEFICIARY IS NOT THE OWNER.
   *
   * An account with no DuitNow code is paid by naming the bank and the receiver, and the
   * receiver on such an account is typically an institution: Wise's MYR account is held at
   * JPMorgan Chase in the name of Wise Payments Malaysia Sdn Bhd, and a payer who is not warned
   * of that aborts the transfer. A company name is not personal data and publishing one is not
   * the decision this guard exists to police.
   *
   * The OWNER'S OWN name is a different thing entirely, and it is refused outright: a holder
   * that matches the payee or an owner, by exact string or by squashed stem, kills the build
   * below rather than being stripped and pinned. That is the owner's standing choice of
   * 25 Aug 2026, and it is enforced here rather than merely written down.
   *
   * The sanctioned names are removed exactly as payloads are, and then asserted to have been in
   * exactly one file the right number of times. A slug is never stripped, because a slug is not
   * the same bytes as the name, so the stem check below still catches a key derived from a
   * person. */
  const squashOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const person = codes.filter((c) => c.holder &&
    stems.some((st) => squashOf(c.holder).includes(st)));
  if (person.length) {
    die("the holder on " + person.map((c) => c.key).join(", ") + " is the payee or an owner. " +
        "A holder names the BENEFICIARY of an account, which for a code-less account is normally " +
        "an institution; publishing the owner's own legal name is refused. Remove `holder` in " +
        "the master, or set it to the institution the account is actually held in the name of.");
  }

  const holders = [...new Set(codes.map((c) => c.holder).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const holderSeen = new Map(holders.map((h) => [h, []]));

  for (const f of files) {
    if (!TEXT.test(f)) continue;
    let body = read(f);
    for (const p of payloads) body = body.split(p).join(" PAYLOAD ");
    for (const h of holders) {
      const n = body.split(h).length - 1;
      if (n > 0) {
        holderSeen.get(h).push(rel(f) + " x" + n);
        body = body.split(h).join(" HOLDER ");
      }
    }
    const hay = body.toLowerCase();
    for (const s of forbidden) {
      if (hay.includes(s.toLowerCase())) {
        die("public/" + rel(f) + " contains, OUTSIDE any payload, a value the bundle is not " +
            "allowed to carry (" + s.length + " characters, beginning " +
            JSON.stringify(s.slice(0, 3)) + "). Check the field list in tools/build.mjs.");
      }
    }
    const squashed = hay.replace(/[^a-z0-9]/g, "");
    for (const stem of stems) {
      if (squashed.includes(stem)) {
        die("public/" + rel(f) + " carries a person's name OUTSIDE any payload, in a form that " +
            "survives slugging (stem " + JSON.stringify(stem) + "). A key, a filename or a label " +
            "has been derived from the payee or an owner. Rename it in the master; the page is " +
            "not allowed to print the name.");
      }
    }
  }

  /* And the other direction for the name: it must be in ONE file, the data file, once per
   * account that is entitled to it, and nowhere else at all. A name that has spread to app.js,
   * to the manifest or to the service worker's shell list is a name that has escaped the one
   * record it belongs to, and this is what says so. */
  for (const h of holders) {
    const want = codes.filter((c) => c.holder === h).length;
    const found = holderSeen.get(h);
    const expected = "data.js x" + want;
    if (found.join(", ") !== expected) {
      die("a holder's name should appear only in " + expected + ", but the built bundle has it " +
          "in: " + (found.join(", ") || "nothing at all") + ". A name has either escaped the one " +
          "record it belongs to, or been dropped from it.");
    }
  }

  // Every payload must have survived the trip byte for byte, and must still pass the master's
  // checksum after the round trip through JSON.
  const data = read(path.join(PUB, "data.js"));
  const back = JSON.parse(data.match(/self\.QR_CODES = ([\s\S]*?);\nself\.QR_BUILD/)[1]);
  if (back.length !== codes.length) die("data.js does not hold every code");
  for (let i = 0; i < codes.length; i++) {
    if (back[i].payload !== codes[i].payload) die("the payload for " + codes[i].key + " changed on the way into data.js");
    // An account with no code has an empty payload by construction, checked above. The master's
    // payload rules apply to the ones that HAVE a payload, and only to those.
    const fault = back[i].payload ? V.payloadError(back[i].payload) : null;
    if (fault) die("the payload for " + codes[i].key + " no longer passes the master's check: " + fault);
    if (Object.keys(back[i]).sort().join() !== [...SHIP].sort().join()) {
      die("the record for " + codes[i].key + " in data.js carries fields beyond " + SHIP.join(", "));
    }
  }

  // No third party, ever. The page must be entirely self-contained.
  for (const f of files) {
    if (!/\.(html|js|css|webmanifest)$/i.test(f)) continue;
    const body = read(f);
    const hit = body.match(/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import[^;]*https?:/i);
    if (hit) die("public/" + rel(f) + " loads something from another origin: " + hit[0]);
  }

  // No inline script or style, because the Content-Security-Policy forbids both and the
  // failure would be a blank page on the phone rather than an error anyone sees here.
  const html = read(path.join(PUB, "index.html"));
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) die("index.html has an inline script; the CSP forbids it");
  if (/<style[^>]*>[\s\S]*?\S[\s\S]*?<\/style>/i.test(html)) die("index.html has an inline style block; the CSP forbids it");
  if (/\sstyle\s*=\s*["']/i.test(html)) die("index.html has an inline style attribute; the CSP forbids it");

  return files.map(rel);
}

/* -------------------------------------------------------------------- the build */

const V = await masterValidator();
const doc = loadStore();
const codes = sanitise(doc, V);

const sources = [
  ["index.html", path.join(APP, "index.html")],
  ["app.css", path.join(APP, "app.css")],
  ["app.js", path.join(APP, "app.js")],
  ["qr-art.js", path.join(APP, "qr-art.js")],
  ["qrcode.js", path.join(REPO, "src", "vendor", "qrcode.js")],
  ["sw.js", path.join(APP, "sw.js")],
];

const dataBody =
  "/* Generated by tools/build.mjs from the Cow-Fin06 master. Do not edit.\n" +
  " * " + SHIP.length + " fields per account and no more: " + SHIP.join(", ") + ".\n" +
  " * maintenance true means the phone shows the account as unavailable and draws NO code.\n" +
  " * The account number IS here, deliberately, so it can be copied off the back of the coin\n" +
  " * and sent to somebody who needs it. The owner, the group, the DuitNow member number and\n" +
  " * the payee's registered name stay on the laptop. */\n" +
  "self.QR_CODES = " + JSON.stringify(codes, null, 2) + ";\n";

/* The build id is a hash of everything that SHIPS, so identical output gives an identical id
 * and a changed byte anywhere gives a new one. That is what drives the cache name.
 *
 * Note the normalisation, which is not cosmetic: `write()` converts CRLF to LF on the way out,
 * so hashing the raw source would key the build id to the line endings of the working tree
 * rather than to the bytes that reach the phone. On a machine with `core.autocrlf` set, and
 * this one has it, a fresh clone would then produce a different build id for a byte-identical
 * bundle, and any check comparing the id against the shipped files would fail on a deploy that
 * was perfectly correct. Hash what you ship. */
const lf = (s) => s.replace(/\r\n/g, "\n");
const h = crypto.createHash("sha256");
for (const [, src] of sources) h.update(lf(read(src)));
h.update(lf(dataBody));
const BUILD = h.digest("hex").slice(0, 12);

const stamped = ["app.css", "app.js", "qr-art.js", "qrcode.js", "marks.js", "data.js"];
const SHELL = ["./"].concat(stamped.map((f) => "./" + f + "?v=" + BUILD));

fs.mkdirSync(PUB, { recursive: true });
for (const f of walk(PUB)) if (/\.(html|js|css|json|webmanifest)$/i.test(f)) fs.rmSync(f);

for (const [name, src] of sources) {
  if (name === "sw.js") continue;
  write(path.join(PUB, name), read(src).replace(/__BUILD__/g, BUILD));
}
write(path.join(PUB, "data.js"), dataBody + 'self.QR_BUILD = "' + BUILD + '";\n');
// Every traced mark in one file, so a mark costs no extra request. Always written, even empty,
// because it is in the stamped list and the service worker's shell expects it to exist.
write(path.join(PUB, "marks.js"),
  markFiles.length ? markFiles.map((f) => read(path.join(VENDOR, f))).join("\n")
                   : "self.MARKS = self.MARKS || {};\n");
write(path.join(PUB, "sw.js"),
  read(path.join(APP, "sw.js"))
    .replace(/__BUILD__/g, BUILD)
    .replace("__SHELL__", JSON.stringify(SHELL, null, 2)));

write(path.join(PUB, "manifest.webmanifest"), JSON.stringify({
  name: "Pay",
  short_name: "Pay",
  description: "Payment codes, drawn on the device.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0a0d18",
  theme_color: "#0a0d18",
  icons: [
    { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "./icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2) + "\n");

write(path.join(PUB, "rev.json"), JSON.stringify({
  id: BUILD,
  codes: codes.length,
  built: new Date().toISOString(),
}, null, 2) + "\n");

const shipped = auditPublic(doc, codes, V);

/* What a stranger with the address can learn. Printed on every build, because it is the one
 * thing about this site that is easy to forget and impossible to undo after the fact. */
function disclosure() {
  const name = String(doc.payee || "").trim();
  const inName = codes.filter((c) => name && c.payload.toUpperCase().includes(name.toUpperCase().slice(0, 12))).length;
  const inAcct = doc.accounts.filter((a) => {
    const s = String(a.sub || "").replace(/[^0-9A-Za-z]/g, "");
    // An account with no code has no payload to look inside.
    return s.length >= 6 && String(a.payload || "").includes(s);
  }).length;
  const named = codes.filter((c) => c.holder);
  const plates = codes.filter((c) => !c.payload);
  return { inName, inAcct, named, plates };
}
const d = disclosure();

console.log("built " + BUILD);
console.log("  " + codes.length + " codes, " + shipped.length + " files in public/");
console.log("  shipped per account: " + SHIP.join(", "));
console.log("  dropped: " + [...new Set(doc.accounts.flatMap(Object.keys))].filter((k) => !SHIP.includes(k)).join(", ") +
            ", plus the top-level payee, owners and groups");
console.log("  the page displays the provider name and the code, and NEVER an account number:");
console.log("    the number goes to the clipboard without being drawn. It still SHIPS in data.js,");
console.log("    because a copy needs something to copy, so every account number remains readable");
console.log("    to anyone who views source. That is unchanged, and it is not what taking it off");
console.log("    the screen was for.");
/* PRINTED EVERY RUN, because Ref-1 is not another account number and the difference matters.
 * An account number can only receive money. A mobile number can be called, messaged, and
 * matched against a messaging app or an account-recovery flow, so shipping one is a wider
 * disclosure than the 11 Aug decision that put account numbers in the bundle. It is drawn
 * nowhere, exactly like `acct`, but it is readable to anyone who views source. */
{
  /* `codes`, not `shipped`. auditPublic returns FILE PATHS, so `shipped.filter(c => c.biller)`
   * was an array of strings filtered on a property none of them has: always empty, no error,
   * and a disclosure that silently printed nothing. The same name means records in the suite
   * and paths here, which is how it got past a careful read. */
  const jp = codes.filter((c) => c.biller);
  if (jp.length) {
    console.log("  JomPAY on " + jp.length + " account(s): " +
                jp.map((c) => c.key + " biller " + c.biller).join(", ") + ".");
    console.log("    The BILLER CODE is public by design; PayNet issues it and it is printed on");
    console.log("    every bill. REF-1 IS NOT: it ships so the clipboard has something to copy,");
    console.log("    it is drawn nowhere, and it is readable to anyone who views source. Where it");
    console.log("    is a mobile number that is a reachable identifier, not just an address that");
    console.log("    can receive money.");
  }
}
/* Printed either way, because "no name is published" is exactly the kind of fact that stops
 * being true quietly. Silence here would read the same as the field not existing. */
if (d.named.length) {
  console.log("  the page names a BENEFICIARY for " + d.named.length + " account(s) with no DuitNow " +
              "code (" + d.named.map((c) => c.key).join(", ") + "),");
  console.log("    because a payer has to confirm a receiver name that is not the person they think");
  console.log("    they are paying: " + d.named.map((c) => JSON.stringify(c.holder)).join(", ") + ".");
  console.log("    NONE of these is the owner or the payee; a holder that matched one would have");
  console.log("    stopped this build. The leak check pins each to its own record in data.js.");
} else {
  console.log("  no beneficiary name is published: `holder` is set on no account. " + d.plates.length +
              " account(s)");
  console.log("    have no code and ship bank plus number only.");
}
console.log("  the owner's own legal name is published NOWHERE, and a `holder` matching it is");
console.log("    refused outright rather than pinned.");
console.log("  inside the codes themselves, which no page design can change:");
console.log("    the account-holder name is readable in " + d.inName + " of " + codes.length + " payloads (EMVCo tag 59)");
console.log("    the account number is readable in " + d.inAcct + " of " + codes.length + " payloads (tag 26)");
console.log("  so anyone who scans a code sees those, exactly as their banking app is meant to show them.");
