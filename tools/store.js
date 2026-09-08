// Shared validation for the accounts document.
// Used by the Cloudflare Pages Function. The local Python server mirrors this
// logic in serve.py; if you change one, change the other.
//
// THE RULE: a payload string is never rewritten, normalised or trimmed here.
// It is only ever inspected. Whitespace inside it is significant.

export const LIMITS = {
  maxDocBytes: 512 * 1024,
  maxAccounts: 200,
  maxOwners: 40,
  maxText: 80,
};

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}

export function payloadError(s) {
  if (typeof s !== "string" || !s) return "payload is empty";
  if (s.length < 20 || s.length > 1200) return "payload length is out of range";
  if (s.slice(0, 4) !== "0002") return "payload does not begin 0002";
  if (s.slice(-8, -4) !== "6304") return "payload does not end with a CRC field";
  if (crc16(s.slice(0, -4)) !== s.slice(-4).toUpperCase()) return "checksum does not match";
  return null;
}

function str(v, max) {
  return typeof v === "string" && v.length <= max;
}

// Returns null when the document is acceptable, otherwise a human sentence.
export function docError(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return "document is not an object";
  if (!Array.isArray(doc.accounts)) return "accounts is not a list";
  if (doc.accounts.length > LIMITS.maxAccounts) return `more than ${LIMITS.maxAccounts} accounts`;
  if (doc.owners !== undefined) {
    if (!Array.isArray(doc.owners)) return "owners is not a list";
    if (doc.owners.length > LIMITS.maxOwners) return `more than ${LIMITS.maxOwners} owners`;
    const oids = new Set();
    for (const o of doc.owners) {
      if (!o || typeof o !== "object") return "an owner is not an object";
      if (!KEY_RE.test(o.id || "")) return `owner id "${o.id}" is not a slug`;
      if (oids.has(o.id)) return `owner id "${o.id}" appears twice`;
      oids.add(o.id);
      if (!str(o.name, LIMITS.maxText)) return `owner "${o.id}" has no usable name`;
    }
  }
  if (doc.groups !== undefined && (typeof doc.groups !== "object" || Array.isArray(doc.groups)))
    return "groups is not an object";

  const keys = new Set();
  const payloads = new Set();
  for (let i = 0; i < doc.accounts.length; i++) {
    const a = doc.accounts[i];
    const at = `account ${i + 1}`;
    if (!a || typeof a !== "object") return `${at} is not an object`;
    if (!KEY_RE.test(a.key || "")) return `${at} has key "${a.key}", which is not a slug`;
    if (keys.has(a.key)) return `${at} repeats the key "${a.key}"`;
    keys.add(a.key);
    if (!str(a.name, LIMITS.maxText)) return `${at} has no usable name`;
    if (a.sub !== undefined && !str(a.sub, LIMITS.maxText)) return `${at} has an over-long sub-label`;
    if (a.group !== undefined && !str(a.group, 40)) return `${at} has a bad group`;
    if (a.owner !== undefined && !str(a.owner, 40)) return `${at} has a bad owner`;
    if (a.mid !== undefined && !str(a.mid, 40)) return `${at} has a bad DuitNow id`;
    if (a.brand !== undefined && !HEX_RE.test(a.brand)) return `${at} has colour "${a.brand}", not a 6-digit hex`;
    // The optional second colour: it strikes the ring around the face. Same rule as brand.
    if (a.ring !== undefined && !HEX_RE.test(a.ring)) return `${at} has ring "${a.ring}", not a 6-digit hex`;
    if (a.bank !== undefined && !str(a.bank, LIMITS.maxText)) return `${at} has a bad bank`;
    if (a.holder !== undefined && !str(a.holder, LIMITS.maxText)) return `${at} has a bad holder`;

    /* JOMPAY: A BILLER CODE AND A REFERENCE, AND NEITHER IS ANY USE ALONE.
     *
     * JomPAY is PayNet's bill-payment rail: the payer types a biller code, which PayNet issues
     * to a registered biller and which is public by design, then Ref-1, which identifies the
     * account being paid. One without the other is a half-address that cannot be paid to, so
     * they stand or fall together rather than being validated separately.
     *
     * Codes are four to six digits. Both fields are DIGITS, and the reference is not trimmed
     * or reformatted here for the same reason a payload is not: what the biller issued is what
     * has to be typed. Kept word for word in step with serve.py's _account_error. */
    const hasBiller = a.biller !== undefined && a.biller !== "";
    const hasRef1 = a.ref1 !== undefined && a.ref1 !== "";
    if (hasBiller !== hasRef1) {
      return `${at} (${a.name}) has ${hasBiller ? "a biller code but no ref1" : "a ref1 but no biller code"}; JomPAY needs both`;
    }
    if (hasBiller) {
      if (!str(a.biller, 6) || !/^[0-9]{4,6}$/.test(a.biller))
        return `${at} has biller "${a.biller}", not a 4 to 6 digit JomPAY code`;
      if (!str(a.ref1, LIMITS.maxText) || !/^[0-9]{1,32}$/.test(a.ref1))
        return `${at} has ref1 "${a.ref1}", not a run of digits`;
    }

    /* AN ACCOUNT IS EITHER A CODE OR A SET OF DETAILS, and never neither.
     *
     * `payload` was mandatory until 25 Aug 2026. Some accounts have no DuitNow code at all and
     * are paid by naming the bank, the number and the person, so payload became optional and
     * `bank` carries the weight instead: without one of the two there is nothing to show and
     * the account would reach the phone as a blank tile.
     *
     * The payload rules themselves are untouched. An account that HAS one is checked exactly as
     * before, including the duplicate test, because two accounts sharing a payload means one of
     * them is quietly paying the other. */
    if (a.payload === undefined) {
      if (!str(a.bank, LIMITS.maxText) || !a.bank.trim())
        return `${at} (${a.name}) has no payload, so it must name the bank it is held at`;
    } else {
      const pe = payloadError(a.payload);
      if (pe) return `${at} (${a.name}): ${pe}`;
      if (payloads.has(a.payload)) return `${at} (${a.name}) duplicates an earlier payload`;
      payloads.add(a.payload);
    }
  }
  return null;
}

export function newRev() {
  const r = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${r}`;
}

// Asia/Kuala_Lumpur is UTC+8 with no daylight saving, so a fixed offset is correct.
export function stampMYT(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 19) + "+08:00"; // seconds, matching serve.py
}
