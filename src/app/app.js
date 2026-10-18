/* Pay - the read-only phone app.
 *
 * Two screens. The accounts, which is where the app opens, and one code. Nothing else is
 * displayed and nothing else is shipped: data.js carries a key, a display name, a brand colour
 * and the payload, and that is the whole record. No legal name, no account number, no owner, no
 * edit path. Editing happens on the laptop, against the master.
 *
 * On saving, and why there is no Save button. The code is drawn to look like a physical token
 * resting on the page: a real shadow under it, a lit edge on top, and it presses in under a
 * finger. That is the affordance. The action itself is the one a phone has already taught
 * everybody, press and hold to keep a picture, and a plain tap does the same thing for anyone
 * who reaches for that instead. Nothing is labelled because a label would be answering a
 * question the shape should already have answered.
 *
 * On navigation. BOTH VIEWS ARE ALWAYS LAID OUT, cross-faded by opacity rather than switched
 * with display. Two reasons, and the second is the one that bit: a display swap cannot be
 * animated, so the list used to vanish in a single frame while the coin flew, which reads as a
 * glitch rather than a transition; and an element in a display:none view measures zero, so
 * every rect the zoom needs has to be taken while its own view is up. Laid out always, both
 * ends can be measured at any moment and the fade is free.
 */
(function () {
  "use strict";

  var CODES = self.QR_CODES || [];
  var BUILD = self.QR_BUILD || "dev";

  var elCoin = document.getElementById("coin");
  var elBtn = document.getElementById("coinbtn");
  var elSay = document.getElementById("say");
  var elGrid = document.getElementById("grid");
  var elBack = document.getElementById("back");
  var elPlate = document.getElementById("plate");
  var elDue = document.getElementById("due");
  var elGoBack = document.getElementById("goback");
  var elRails = document.getElementById("rails");
  var elList = document.getElementById("accounts");

  // The miniature on a tile, in CSS pixels. Must match --thumb in app.css.
  var THUMB = 56;

  /* THE DURATIONS COME FROM THE STYLESHEET, not from numbers typed here as well.
   *
   * Every one of these has a partner in app.css: the class the script adds plays a keyframe the
   * sheet defines, and the script has to know when to take the class off again. Two copies of
   * the same number in two files is a drift waiting to happen, and the failure is silent, since
   * a mismatch shows up only as a class removed halfway through its own animation or left on
   * long enough to out-rank the next one.
   *
   * So the sheet is the source. --dur and --dur-fast are read once at startup and everything
   * else is derived from them, which also means retuning the motion is a change to one file. */
  function cssMs(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      var n = parseFloat(v);
      if (!isFinite(n)) return fallback;
      return /ms$/.test(v) ? n : n * 1000;      // CSS time is ms or s
    } catch (e) { return fallback; }
  }
  var DUR = cssMs("--dur", 300);
  var FAST = cssMs("--dur-fast", 140);
  var MS = {
    zoom: DUR,             // tile to coin and back: the whole transition agrees on one number
    enter: DUR,            // a coin or a name arriving
    stepOut: Math.round(DUR * 0.56),
    stepIn: Math.round(DUR * 0.73),
    tuck: Math.round(DUR * 1.27),   // the save and copy dip, which outlasts the transition
    fast: FAST
  };
  var ZOOM = MS.zoom;
  // The press-and-hold threshold. A GESTURE timing, not a motion one, so it does not follow
  // the stylesheet: shortening the animations must not make the app easier to save by accident.
  var HOLD_MS = 420;

  var idx = -1;
  /* THE PLAIN CODE IS NO LONGER AN OPTION, ONLY A FALLBACK.
   *
   * The pill that let you ask for it is gone. What stays is the renderer deciding for itself:
   * below safePhysicalPx it draws the plain code instead of a coin, because a coin too small to
   * scan is a broken page rather than a design choice. That is a safety net, not a preference,
   * and removing the button does not remove it. `meta.plain` is still read and still styles the
   * frame; nothing here ever asks for it. */
  var tiles = [];
  var shownOrder = [];   // indices of the tiles on screen, in display order; steps walk it
  var cards = {};        // one saveable image per account, built once and kept
  var sayTimer = null;
  var depth = 0;         // how many entries WE pushed, so back is never a guess
  var flier = null;      // the coin in transit, if any

  /* ------------------------------------------------------------------- storage */

  function remember(k, v) { try { localStorage.setItem("pay:" + k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem("pay:" + k); } catch (e) { return null; } }

  function say(msg, hold) {
    clearTimeout(sayTimer);
    elSay.textContent = msg || "";
    if (msg && hold !== false) sayTimer = setTimeout(function () { elSay.textContent = ""; }, 3200);
  }

  function indexOfKey(key) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].key === key) return i;
    return -1;
  }

  /* --------------------------------------------------------------------- paint */

  var lastFit = 0;
  function fit() {
    var box = elBtn.parentNode;
    var size = Math.max(160, Math.floor(Math.min(box.clientWidth, box.clientHeight)));
    // Only write when it has actually changed. Writing every paint made each redraw a forced
    // reflow as well, which is the last thing wanted in the middle of an animation.
    if (size !== lastFit) {
      elBtn.style.width = size + "px";
      elBtn.style.height = size + "px";
      lastFit = size;
    }
    return size;
  }

  function artFor(a, extra) {
    return Object.assign({
      brand: a.brand, label: a.name, seed: a.key
    }, extra || {});
  }

  /* A PLATE IS AN ACCOUNT WITH NO CODE, and the whole of the test is that it has no payload.
   *
   * Some accounts have no DuitNow code at all and are paid by naming the bank, the number and
   * the person. The build gives every record a real payload string, empty when there is none,
   * so this is one reading of one field rather than a guess about which fields are present.
   *
   * Everything a code makes possible is off for these: there is nothing to scan, so nothing to
   * save and no second face to turn over to. What remains is the number, and copying it, which
   * is what the reverse of a coin already does. */
  function plate(a) { return !!a && !a.payload; }

  /* ------------------------------------------------------------------- the rails
   *
   * A RAIL IS A PROPERTY OF AN ACCOUNT, NOT A CATEGORY OF ACCOUNT, and that single fact
   * decides the whole shape of the list. Thirteen of fourteen accounts are payable BOTH by
   * scanning the code and by transferring to the account number; Instapay is payable all three
   * ways. Three separate books would therefore list nearly everything twice, and duplication is
   * what this codebase keeps getting bitten by. So there is one wallet and the rails filter it.
   *
   * DERIVED, NEVER STORED. A stored `rail` field would be a second opinion about data the
   * record already carries, free to disagree with it; asking the fields directly cannot.
   *
   *   qr        a payload, so there is something to scan
   *   transfer  a bank and a number, so a payer can pick the institution and paste
   *   jompay    a biller code and a reference, both or neither
   */
  var RAILS = [
    { id: "qr", label: "QR", has: function (a) { return !!a.payload; } },
    { id: "transfer", label: "Transfer", has: function (a) { return !!(a.bank && a.acct); } },
    { id: "jompay", label: "JomPAY", has: function (a) { return !!(a.biller && a.ref1); } }
  ];
  function railOf(id) {
    for (var i = 0; i < RAILS.length; i++) if (RAILS[i].id === id) return RAILS[i];
    return RAILS[0];
  }
  function onRail(a, id) { return railOf(id).has(a); }
  /* THE RAIL IS A MODE, NOT ONLY A FILTER (owner, 14 Sep 2026). It picks which accounts are
   * listed AND what an account shows when opened: the code alone on QR, the bank and the number
   * on Transfer, the biller code and the references on JomPAY. It is remembered, so the app
   * opens the way it was left; QR is the default because thirteen of fourteen have a code. An
   * account opened by hash that is not on the current rail shows the first rail it is on, so a
   * link never lands on nothing. */
  var rail = railOf(recall("rail")).id;
  function viewOf(a) {
    if (onRail(a, rail)) return rail;
    for (var i = 0; i < RAILS.length; i++) if (RAILS[i].has(a)) return RAILS[i].id;
    return rail;
  }

  // A traced mark by id, or nothing. An unknown id draws no mark rather than throwing; the
  // build already refuses an id with no file behind it, so this is the belt to that brace.
  function markOf(id) { return (self.MARKS || {})[id] || null; }

  function paintFace(canvas, a, extra) {
    // `acct` is deliberately NOT passed: the number is not drawn on any face, here or anywhere.
    return plate(a)
      ? self.QRArt.drawPlate(canvas, artFor(a, Object.assign(
          { bank: a.bank, holder: a.holder, ring: a.ring,
            bankMark: markOf(a.bankMark), holderMark: markOf(a.holderMark) }, extra)))
      : self.QRArt.draw(canvas, a.payload, artFor(a, extra));
  }

  /* Draw an account's coin into a canvas of its own, without touching the page. Used to keep
   * the cost of a redraw OFF the animation: six to fourteen milliseconds is most of a frame,
   * and spent halfway through a transition it drops one exactly where the eye is following the
   * coin. Rendered up front, the swap becomes a drawImage of about a hundredth of that. */
  function prerender(i) {
    // Only a coin flies. The Transfer and JomPAY views are text and simply arrive.
    if (down(CODES[i]) || viewOf(CODES[i]) !== "qr") return null;
    var a = CODES[i];
    if (!a) return null;
    var off = document.createElement("canvas");
    var meta = paintFace(off, a, {
      size: fit(), pixelRatio: self.devicePixelRatio || 1
    });
    return { canvas: off, meta: meta };
  }

  /* THE COIN HAS ONE SIDE. There was a reverse: struck metal carrying the account number, which
   * you reached by turning the coin over, and copying meant showing the number first.
   *
   * The number does not have to be on screen to be useful. "Copy account number" puts it
   * straight on the clipboard, so it goes from the phone into a banking app without ever being
   * displayed, read over a shoulder, or caught in a screenshot of the code. That removed the
   * only reason the coin turned over, so the whole reverse went with it: the second canvas, the
   * 3D flip, and PayNet's brand graphic, which was there to label a face that no longer exists.
   *
   * Owner's decision, 25 Aug 2026. Note what it does NOT do: `acct` still ships in data.js,
   * because a copy has to have something to copy and the phone works offline. The number is out
   * of sight, not out of the bundle. */

  /* UNDER MAINTENANCE. One reading of one normalised boolean, in one place, and everything that
   * could put a code or a number in front of somebody asks it first.
   *
   * The rule is not cosmetic. An account is marked while it is being changed on the laptop, so
   * the code on the phone may already be the wrong one, and a wrong DuitNow code still scans and
   * still pays, just to somebody else. So this does not dim a code, it refuses to draw one. */
  /* THE OVERRIDE, and the precedence rule is the whole of it.
   *
   * `override` holds whatever /state.json last said: which accounts are suspended and what order
   * the tiles stand in, both written from /admin/ without a deploy. It is consulted FIRST, so a
   * suspension reaches the phone in seconds; if it says nothing about an account, the flag baked
   * into the bundle stands, and if it carries no order the build order stands.
   *
   * THE LAST GOOD STATE IS KEPT ON THE PHONE. There is no laptop switch deploying a fresh bake
   * behind every change any more, so the bundle's flag is only what a phone knows on its very
   * first open. After that the phone remembers the last state it read, and a phone with no
   * signal shows what was true when it last had one, never what was true at the last deploy.
   *
   * An unreadable, malformed or missing response leaves `override` exactly as it was rather
   * than clearing it. Treating a failed fetch as "nothing is suspended" would turn a dropped
   * connection into a suspended code coming back on screen. */
  var STORE_KEY = "pay-state";
  var override = null;

  function down(a) {
    if (!a) return false;
    if (override && Object.prototype.hasOwnProperty.call(override.maintenance, a.key)) {
      return override.maintenance[a.key] === true;
    }
    return a.maintenance === true;
  }

  /* Only real booleans and real keys, against accounts this bundle knows. Anything else in
   * the file is ignored rather than trusted, because this decides whether a payment code is
   * shown. Returns null for a body that is not a state at all. */
  function cleanState(j) {
    if (!j || typeof j !== "object") return null;
    var known = {};
    for (var i = 0; i < CODES.length; i++) known[CODES[i].key] = true;
    var next = { maintenance: {}, order: [] };
    var m = j.maintenance;
    if (m && typeof m === "object") {
      for (var k in known) {
        if (Object.prototype.hasOwnProperty.call(m, k) && typeof m[k] === "boolean") next.maintenance[k] = m[k];
      }
    }
    if (Array.isArray(j.order)) {
      for (var n = 0; n < j.order.length; n++) {
        var key = j.order[n];
        if (known[key] && next.order.indexOf(key) < 0) next.order.push(key);
      }
    }
    return next;
  }

  function takeState(j) {
    var next = cleanState(j);
    if (!next) return false;
    var before = JSON.stringify(override);
    override = next;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch (e) {}
    return before !== JSON.stringify(override);
  }

  function rememberedState() {
    try { takeState(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) {}
  }

  function readState() {
    if (!self.fetch) return Promise.resolve(false);
    return fetch("state.json", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(takeState)
      .catch(function () { return false; });   // offline: the remembered state stands
  }

  /* Re-read on open and whenever the app comes back to the front, which is the moment somebody
   * is about to show a code to somebody else. Nothing polls: a timer would spend battery to
   * answer a question that only matters when the screen is being looked at. */
  function watchState() {
    var apply = function (changed) {
      if (!changed) return;
      for (var i = 0; i < tiles.length; i++) tiles[i].className = classOf(CODES[i]);
      // Suspension can arrive from KV without a deploy, so the order is recomputed here too.
      orderTiles();
      /* AND THE MINIATURES, which this did not do. Re-classing a tile greys it and moves it;
       * it does not take the code off it. An account baked live and then suspended from the
       * laptop kept its painted coin under a dimmed tile, which is a code on screen for an
       * account whose payload may already be the wrong one. drawThumbs now clears as well as
       * paints, so this one call settles both directions. */
      drawThumbs();
      if (idx >= 0) paint();
    };
    readState().then(apply);
    followBuild();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { readState().then(apply); followBuild(); }
    });
  }

  /* THE PAGE FOLLOWS THE BUILD (owner, 15 Sep 2026). The service worker takes a new build over
   * on the next open, but a page left open on the phone kept running the old script until it
   * was closed. So on every return to the front the page reads /rev.json, which the Worker
   * serves uncached and the service worker never touches, and reloads itself once when the id
   * there is not its own. Offline the read fails and nothing happens. The id is remembered
   * before reloading, so a bundle and its rev disagreeing could cost one reload, never a loop. */
  function followBuild() {
    if (!self.fetch || BUILD === "dev") return;
    fetch("rev.json", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.id !== "string" || j.id === BUILD) return;
        if (recall("reloaded") === j.id) return;
        remember("reloaded", j.id);
        location.reload();
      })
      .catch(function () {});
  }

  /* THE TRANSFER AND JOMPAY VIEWS (owner, 14 Sep 2026). The number and the references are ON
   * SCREEN now, which reverses 25 Aug: a plate reading the bank's DuitNow name and the number
   * straight off the record, or the biller code and the references, and each value copies on a
   * tap. Ref-2 is always empty and shows a dash, because a JomPAY form asks for it and the
   * dash is the answer (owner, 14 Sep 2026). The number is spaced in fours to be read; the copy strips the spaces. */
  function spaced(n) { return String(n).replace(/(\d{4})(?=\d)/g, "$1 "); }
  function fillPlate(a, v) {
    var rows = v === "jompay"
      ? [["Biller code", a.biller, "biller code"], ["Ref-1", a.ref1, "Ref-1"], ["Ref-2", "-"]]
      : [["Bank", a.bank], ["Account", spaced(a.acct), "account number"]]
          .concat(a.holder ? [["Receiver", a.holder]] : []);
    fillRows(elPlate, rows);
  }

  /* A row is [label, value shown, what a copy is called, value copied where it is not the one
   * shown]; one without a name for its copy is a plain line. */
  function fillRows(box, rows) {
    box.textContent = "";
    rows.forEach(function (r) {
      var el = document.createElement(r[2] ? "button" : "div");
      if (r[2]) el.type = "button";
      el.className = "prow";
      var l = document.createElement("span");
      l.className = "plabel";
      l.textContent = r[0];
      var val = document.createElement("span");
      val.className = "pvalue";
      val.textContent = r[1];
      el.appendChild(l);
      el.appendChild(val);
      if (r[2]) el.addEventListener("click", function () { copyValue(r[3] || r[1], r[2]); });
      box.appendChild(el);
    });
  }

  /* THE PAYER'S LINK (the Counter's pay sheet, owner's decision of 24 Sep 2026):
   * #<key>/<rail>/<amount>/<reference>, every part after the key optional. The Counter names the
   * account the customer chose, the way, the figure and their username as the reference; this
   * page opens on that account at that rail with the amount and the reference to copy. Anyone can
   * write a link, so each part is CHECKED AND DROPPED, NEVER REPAIRED: a rail must be one of
   * RAILS, an amount a figure in ringgit to the sen, a reference a short run of letters, digits
   * and hyphens. A crafted link can show only what a genuine one could, never a sentence. */
  function linkOf(hash) {
    var parts = String(hash || "").replace(/^#/, "").split("/");
    var dec = function (s) { try { return decodeURIComponent(s || ""); } catch (e) { return ""; } };
    var r = dec(parts[1]), amount = dec(parts[2]), ref = dec(parts[3]);
    var known = false;
    for (var i = 0; i < RAILS.length; i++) if (RAILS[i].id === r) known = true;
    return {
      key: dec(parts[0]),
      rail: known ? r : "",
      amount: /^\d{1,6}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 ? Number(amount).toFixed(2) : "",
      ref: /^[A-Za-z0-9-]{1,20}$/.test(ref) ? ref : ""
    };
  }

  /* What the link carried, on the account it named and on no other: a step or a tap on another
   * account writes a bare key, and the figure goes with it. A suspended account shows none. */
  function dueRows(a) {
    var L = linkOf(location.hash), rows = [];
    if (a && !down(a) && L.key === a.key) {
      if (L.amount) rows.push(["Amount", "RM " + L.amount, "amount", L.amount]);
      if (L.ref) rows.push(["Reference", L.ref, "reference"]);
    }
    return rows;
  }
  function fillDue(a) {
    var rows = dueRows(a);
    fillRows(elDue, rows);
    elDue.hidden = !rows.length;
    elGoBack.hidden = !rows.length;
  }
  /* Paid? Go back, and Not paying, go back: the page was opened in a tab or the saved app's
   * browser sheet, so closing it returns them to their account, which asks whether they sent it
   * (Not yet answers it for one not paying). Where the browser keeps the page open, it says how
   * to go back by hand, and holds the line. */
  function goBack(line) {
    try { window.close(); } catch (e) {}
    setTimeout(function () { if (!document.hidden) say(line, false); }, 400);
  }
  document.getElementById("paid").addEventListener("click", function () {
    goBack("Tap Done or close this tab, then tell us on your account");
  });
  document.getElementById("unpaid").addEventListener("click", function () {
    goBack("Tap Done or close this tab to go back");
  });

  function paint(pre) {
    var a = CODES[idx];
    if (!a) return null;
    var meta;
    var v = viewOf(a);
    document.body.setAttribute("data-view", v);
    fillDue(a);

    if (down(a)) {
      /* NOTHING SCANNABLE OR COPIABLE IS DRAWN AT ALL. The canvas is cleared rather than
       * covered: a coin drawn and then hidden behind a panel is still a photograph away from
       * being scanned, and the panel is a stylesheet away from not being there. The plate is
       * emptied for the same reason: the number may be the one being changed. */
      elCoin.width = 8; elCoin.height = 8;
      elCoin.getContext("2d").clearRect(0, 0, 8, 8);
      elPlate.textContent = "";
      document.body.classList.add("maintenance");
      elCoin.setAttribute("aria-label", a.name + " is under maintenance and its code is not shown");
      elBtn.setAttribute("aria-label", a.name + " is under maintenance");
      say("");
      return { plain: false, fellBack: false, maintenance: true };
    }
    document.body.classList.remove("maintenance");
    if (v !== "qr") {
      // Text, not a coin. The canvas is cleared rather than left holding the last code under
      // a display:none, which would still be a code on the page.
      elCoin.width = 8; elCoin.height = 8;
      elCoin.getContext("2d").clearRect(0, 0, 8, 8);
      fillPlate(a, v);
      return { plain: false, fellBack: false, view: v };
    }
    elPlate.textContent = "";
    if (pre && pre.canvas) {
      elCoin.width = pre.canvas.width;
      elCoin.height = pre.canvas.height;
      elCoin.getContext("2d").drawImage(pre.canvas, 0, 0);
      meta = pre.meta;
    } else {
      meta = paintFace(elCoin, a, {
        size: fit(), pixelRatio: self.devicePixelRatio || 1
      });
    }
    // meta.plain, not the local flag: the renderer drops to the plain code by itself when the
    // screen is too small to draw a coin anyone could scan, and the page must follow it.
    elCoin.setAttribute("aria-label", a.name + " payment code");
    elBtn.setAttribute("aria-label", a.name + " payment code. Press and hold to save it to your photos.");
    elBtn.classList.toggle("plainmode", meta.plain);
    return meta;
  }

  /* THE VIEW NAMES ITS OWN TAP, and the label is held open rather than timed out, because it
   * describes what is on screen rather than reporting something that just happened. On the code
   * a link's amount and reference sit just above the label and copy on a tap, so it names both. */
  function sayTap() {
    var a = CODES[idx];
    say(viewOf(a) !== "qr" ? "Tap a value to copy" : dueRows(a).length ? "Tap the code to save, a value to copy" : "Tap to save", false);
  }

  /* Copy the digits, not the spacing: the spaced form is for reading, and what goes into a
   * banking app is the number itself.
   *
   * ONE COPY PATH FOR BOTH RAILS. The account number and the JomPAY reference differ only in
   * which field they read and what the confirmation says; the clipboard call, the fallback for
   * browsers without it, the maintenance refusal and the tuck are identical. Written twice they
   * would drift, and the half that drifts is the one nobody tests, because it belongs to the
   * single account that has a biller code. */
  function copyValue(value, label) {
    var a = CODES[idx];
    if (!a || !value) return;
    // The value may be the one being changed, so it is not handed out either.
    if (down(a)) { say("Under maintenance"); return; }
    var digits = String(value).replace(/\s+/g, "");
    var done = function () { say("Copied " + label); tuck(); };
    var fallback = function () {
      try {
        var ta = document.createElement("textarea");
        ta.value = digits;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        var okd = document.execCommand("copy");
        document.body.removeChild(ta);
        if (okd) done(); else say("Could not copy");
      } catch (e) { say("Could not copy"); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(digits).then(done, fallback);
    } else fallback();
  }

  // The keyboard's copy. The plate's rows copy their own value through copyValue directly.
  function copyAcct() {
    var a = CODES[idx];
    if (a) copyValue(a.acct, "account number");
  }

  /* -------------------------------------------------------------------- motion */

  /* Nothing here may be load-bearing. Every step that changes what is on screen runs on a
   * timer, and that timer is zero when motion is off, rather than waiting for an animation
   * event that a reduced-motion phone will never send. If the animation does not play, the app
   * behaves identically, just instantly. */
  var reduced = self.matchMedia ? self.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function still() { return !!reduced.matches; }
  function after(ms, fn) { if (still()) fn(); else setTimeout(fn, ms); }

  /* Play a class once and take it off again. The removal is not tidiness: these all set the
   * `animation` property on the same element, so one left behind out-ranks the next by nothing
   * more than sitting further down the stylesheet, and the symptom is a missing animation
   * rather than an error. */
  var ONESHOT = ["enter", "tuck", "in-left", "in-right", "out-left", "out-right"];
  function oneShot(el, cls, ms) {
    if (still() || !el) return;
    for (var i = 0; i < ONESHOT.length; i++) el.classList.remove(ONESHOT[i]);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || MS.enter);
  }

  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return (r.width && r.height) ? r : null;
  }

  function thumbOf(i) {
    return tiles[i] ? tiles[i].querySelector(".tiledot") : null;
  }

  /* THE ZOOM. One object, two places.
   *
   * The badge on a tile is the same coin drawn small, so opening an account is the coin itself
   * growing from where it sat to where it lands, and closing is the reverse. The flier carries
   * the FULL-SIZE render and is only ever scaled DOWN: scaling a 36 pixel raster up ten times
   * arrives soft and blocky, while a full-size one shrunk stays crisp at every frame. It costs
   * no extra drawing at all, because the render it carries is the one the swap needed anyway.
   *
   * It takes RECTS rather than elements. Both views are laid out at all times now, so either
   * end can be measured whenever, but passing rects keeps the caller honest about WHEN it
   * measured, which is what went wrong when the views were switched with display.
   */
  function fly(fromRect, toRect, image, opts) {
    opts = opts || {};
    killFlier();
    if (still() || !fromRect || !toRect || !image) return false;

    var shrinking = toRect.width < fromRect.width;
    var big = shrinking ? fromRect : toRect;
    var small = shrinking ? toRect : fromRect;

    var c = document.createElement("canvas");
    c.className = "flier";
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    c.style.left = big.left + "px";
    c.style.top = big.top + "px";
    c.style.width = big.width + "px";
    c.style.height = big.height + "px";
    document.body.appendChild(c);

    var s = small.width / big.width;
    var dx = (small.left + small.width / 2) - (big.left + big.width / 2);
    var dy = (small.top + small.height / 2) - (big.top + big.height / 2);
    var atSmall = "translate(" + dx + "px," + dy + "px) scale(" + s + ")";
    var atBig = "translate(0px,0px) scale(1)";
    var from = shrinking ? atBig : atSmall;
    var to = shrinking ? atSmall : atBig;

    /* Commit the starting transform BEFORE the element is painted for the first time.
     *
     * Without this the flier is inserted at its full size and the browser can paint one frame
     * of it that way before the animation's first frame lands, which is a full-size coin
     * flashing for 16ms and then snapping small to grow. That is the "skipped a beat". Setting
     * the transform inline and reading a layout property forces the from-state to be the first
     * thing ever painted. */
    c.style.transform = from;
    void c.offsetWidth;

    var ms = opts.duration || ZOOM;
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      if (c.parentNode) c.parentNode.removeChild(c);
      if (flier === c) flier = null;
      if (opts.onDone) opts.onDone();
    };
    c._finish = finish;
    flier = c;

    // The handoff: whatever the flier is covering is revealed ONE FRAME BEFORE the flier goes,
    // so there is never a gap and never a double image.
    if (opts.onArrive) setTimeout(opts.onArrive, Math.max(0, ms - 32));

    if (c.animate) {
      var a = c.animate([{ transform: from }, { transform: to }],
        { duration: ms, easing: "cubic-bezier(.32,.72,0,1)", fill: "both" });
      if (a.finished && a.finished.then) a.finished.then(finish, finish);
    } else {
      c.style.transition = "transform " + ms + "ms cubic-bezier(.32,.72,0,1)";
      requestAnimationFrame(function () { c.style.transform = to; });
    }
    setTimeout(finish, ms + 60);   // whatever the animation does or fails to do, this cleans up
    return true;
  }

  /* A second tap while one zoom is still running must not leave the first stranded. */
  function killFlier() {
    if (flier && flier._finish) flier._finish();
    flier = null;
  }

  function flash() {
    if (still() || !elBtn) return;
    var r = rectOf(elBtn);
    if (!r) return;
    var f = document.createElement("div");
    f.className = "flash";
    f.style.left = r.left + "px";
    f.style.top = r.top + "px";
    f.style.width = r.width + "px";
    f.style.height = r.height + "px";
    document.body.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, MS.tuck + 120);
  }

  /* -------------------------------------------------------------------- routing */

  /* The hash is the state, and it is the ONLY state. Nothing reads history.state to decide what
   * to draw, because after a reload that state is stale and back landed on whatever entry
   * happened to be behind, which could be another code. `depth` counts only the entries this
   * page session pushed, so Accounts either unwinds one of ours or rewrites the hash in place,
   * and can never walk off into somebody else's history. */
  function route(pre) {
    var L = linkOf(location.hash);
    var i = indexOfKey(L.key);
    // A link's rail becomes the mode when the account is on it; otherwise viewOf() decides.
    if (i >= 0 && L.rail && onRail(CODES[i], L.rail)) setRail(L.rail);
    if (i >= 0) showCode(i, pre); else showList();
  }

  function showList() {
    if (document.body.className.indexOf("view-list") >= 0) return;
    document.body.className = "view-list" + (fresh ? " fresh" : "");
    idx = -1;
    document.title = "QR Command";
  }

  function showCode(i, pre) {
    idx = (i + CODES.length) % CODES.length;
    var a = CODES[idx];
    var arriving = document.body.className.indexOf("view-code") < 0;
    document.body.className = "view-code";
    document.title = a.name;
    for (var k = 0; k < tiles.length; k++) {
      tiles[k].setAttribute("aria-current", k === idx ? "true" : "false");
    }
    /* Written unconditionally on arrival, never only on a change. When this was conditional the
     * very first account you opened had no caption at all, because nothing had changed yet. */
    sayTap();
    paint(pre);
    remember("last", a.key);
    // A plate has no code, so there is no card to build and nothing to keep warm for a save.
    if (!plate(a)) idle(function () { cardOf(a); });
    return arriving;
  }

  /* Opening: the badge flies up and becomes the coin. */
  function open(i) {
    if (i === idx && document.body.className.indexOf("view-code") >= 0) return;
    var from = still() ? null : rectOf(thumbOf(i));
    var pre = still() ? null : prerender(i);

    history.pushState({ n: ++depth }, "", "#" + CODES[i].key);
    showCode(i, pre);

    var to = rectOf(elBtn);
    if (!pre || !from || !to || !fly(from, to, pre.canvas, {
      onArrive: function () { elBtn.style.opacity = ""; }
    })) {
      elBtn.style.opacity = "";
      oneShot(elBtn, "enter", MS.enter);
      return;
    }
    elBtn.style.opacity = "0";
  }

  /* Closing: the coin shrinks back into its tile. */
  function close() {
    var was = idx;
    var from = still() ? null : rectOf(elBtn);
    var shot = null;
    if (from && elCoin.width > 8) {   // 8 is a cleared canvas: a plate view, nothing to fly
      shot = document.createElement("canvas");
      shot.width = elCoin.width;
      shot.height = elCoin.height;
      shot.getContext("2d").drawImage(elCoin, 0, 0);
    }

    if (depth > 0) { depth--; history.back(); }
    else history.replaceState({ n: 0 }, "", "#");
    showList();

    /* THE LIST SCROLLS NOW, so the tile we are flying back to may be off screen, and an
     * off-screen tile still reports a perfectly valid rect. Left alone the coin would sail
     * off past the edge to a place the eye cannot follow and land on nothing. "nearest" is
     * deliberate: it moves the list only when the tile is actually out of view, so coming
     * back does not otherwise throw away the scroll position. It has to happen BEFORE the
     * measurement, and instantly, or we would measure a position the list has not reached. */
    var thumb = thumbOf(was);
    if (tiles[was]) tiles[was].scrollIntoView({ block: "nearest", inline: "nearest" });
    var to = rectOf(thumb);
    if (!shot || !to) return;
    if (thumb) thumb.style.visibility = "hidden";
    var flew = fly(from, to, shot, {
      onArrive: function () { if (thumb) thumb.style.visibility = ""; }
    });
    if (!flew && thumb) thumb.style.visibility = "";
  }

  /* Stepping between codes REPLACES rather than pushes, so Accounts always returns to the list
   * rather than walking backwards through everything swiped past. */
  function step(dir) {
    /* STEPS STAY ON THE RAIL. The neighbour is the next VISIBLE tile in display order, so a
     * swipe on the Transfer view never lands on an account with no number to show, and the
     * order swiped through is the order the list shows. */
    var pos = shownOrder.indexOf(idx);
    if (shownOrder.length < 2 || pos < 0) return;
    var i = shownOrder[(pos + dir + shownOrder.length) % shownOrder.length];
    var out = dir < 0 ? "out-left" : "out-right";
    var into = dir < 0 ? "in-right" : "in-left";
    var pre = still() ? null : prerender(i);
    if (dir) oneShot(elBtn, out, MS.stepOut);
    after(dir && !still() ? 150 : 0, function () {
      history.replaceState(history.state, "", "#" + CODES[i].key);
      showCode(i, pre);
      if (dir) oneShot(elBtn, into, MS.stepIn);
    });
  }

  function idle(fn) {
    if (self.requestIdleCallback) self.requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 300);
  }

  /* ----------------------------------------------------------- save to gallery */

  /* Built SYNCHRONOUSLY, on purpose, and cached. iOS only allows navigator.share from inside
   * the gesture that triggered it, and awaiting canvas.toBlob is enough to lose that
   * permission, which presents as the share sheet simply never appearing. toDataURL is slower
   * but synchronous, so the file exists before share is called and the gesture is still live. */
  function cardOf(a) {
    if (cards[a.key]) return cards[a.key];
    var cv = document.createElement("canvas");
    self.QRArt.drawCard(cv, a.payload, artFor(a, { plain: false }));
    var url = cv.toDataURL("image/png");
    var bin = atob(url.slice(url.indexOf(",") + 1));
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    var blob = new Blob([buf], { type: "image/png" });
    var name = "duitnow-" + a.key + ".png";
    var file = null;
    try { file = new File([blob], name, { type: "image/png" }); } catch (e) { /* older browsers */ }
    cards[a.key] = { blob: blob, file: file, name: name };
    return cards[a.key];
  }

  function download(card) {
    var url = URL.createObjectURL(card.blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = card.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function tuck() {
    oneShot(elBtn, "tuck", MS.tuck);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  function save() {
    var a = CODES[idx];
    if (!a) return;
    // Nothing to save, and nothing that should be saved: see down().
    if (down(a)) { say("Under maintenance"); return; }
    // Only the QR view has a coin to keep; the other views copy from their rows.
    if (viewOf(a) !== "qr") return;
    var card;
    try { card = cardOf(a); }
    catch (e) { say("Could not draw the image"); return; }

    var canShare = card.file && navigator.share && navigator.canShare &&
                   navigator.canShare({ files: [card.file] });
    tuck();
    flash();
    if (canShare) {
      navigator.share({ files: [card.file] }).then(
        function () { say("Saved"); },
        function (err) {
          // A cancelled share sheet is not a failure, so it is not reported as one.
          if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) { say(""); return; }
          try { download(card); say("Saved to your files"); }
          catch (e2) { say("Could not save the image"); }
        }
      );
      return;
    }
    try { download(card); say("Saved to your files"); }
    catch (e3) { say("Could not save the image"); }
  }

  /* ---------------------------------------------------------------------- build */

  var fresh = true;   // the list deals itself in once, on opening the app, and not again

  /* ONE PLACE DECIDES A TILE'S CLASSES. It used to be two, and they disagreed: the KV watcher
   * rebuilt the string as `"tile down"` or `"tile"`, which quietly dropped `wide` off the
   * featured account, so a suspension arriving from the laptop collapsed its full-width row. */
  function classOf(a) {
    return "tile" + (down(a) ? " down" : "");
  }

  /* SUSPENDED ACCOUNTS SINK TO THE BOTTOM, and this is a RUNTIME sort rather than the master's
   * order, which it has to be: `/state.json` can suspend an account from the laptop in seconds
   * with no deploy, so an order baked at build time would leave it sitting among the live ones
   * until the next release.
   *
   * The tiles are MOVED, never rebuilt. `tiles[i]` stays aligned with `CODES[i]`, so every index
   * the app holds keeps its meaning: the hash, `open(i)`, the thumbnails and the zoom's rects
   * are all untouched. Re-appending an element that is already in the DOM moves it, so appending
   * in display order is the whole operation.
   *
   * The stagger is renumbered to follow the VISIBLE order; left on the build index the list
   * would deal itself in out of sequence, which reads as a stutter rather than a deal. */
  function orderTiles() {
    /* THE ARRANGEMENT COMES FROM THE STATE, set on /admin/, and the build order is only what
     * stands until one is set. Keys the state names come first in its order; anything it
     * does not name follows in build order, so a newly added account appears at the end rather
     * than vanishing. Suspended accounts then sink, whatever the arrangement says. */
    var placed = [], seen = {};
    var want = override ? override.order : [];
    for (var o = 0; o < want.length; o++) {
      for (var j = 0; j < tiles.length; j++) {
        if (CODES[j].key === want[o] && !seen[j]) { placed.push(j); seen[j] = true; }
      }
    }
    for (var r = 0; r < tiles.length; r++) if (!seen[r]) placed.push(r);
    var live = [], held = [];
    for (var p = 0; p < placed.length; p++) (down(CODES[placed[p]]) ? held : live).push(placed[p]);
    var order = live.concat(held);
    /* THE FILTER HIDES, IT DOES NOT REBUILD, for exactly the reason the sort moves rather than
     * rebuilds: `tiles[i]` must stay aligned with `CODES[i]` or every index the app holds
     * silently changes meaning, the hash and open(i) and the zoom's rects included.
     *
     * The stagger is renumbered over the VISIBLE tiles only. Numbered over all of them, a
     * filter showing one account in fourteen would deal it in on the fourteenth beat, which
     * reads as the app having hung. */
    var shown = 0;
    shownOrder = [];
    for (var k = 0; k < order.length; k++) {
      var el = tiles[order[k]], on = onRail(CODES[order[k]], rail);
      el.hidden = !on;
      if (on) { el.style.setProperty("--i", String(shown++)); shownOrder.push(order[k]); }
      elGrid.appendChild(el);
    }
  }

  /* The chips, built from the data so a count cannot go stale against it. A rail nobody is on
   * is not offered, because a filter that can only ever return nothing is a dead control. */
  function buildRails() {
    if (!elRails) return;
    elRails.textContent = "";
    RAILS.forEach(function (r) {
      var n = CODES.filter(r.has).length;
      if (!n) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "railbtn";
      b.setAttribute("aria-pressed", String(r.id === rail));
      b.textContent = r.label;
      var c = document.createElement("span");
      c.className = "railn";
      c.textContent = String(n);
      b.appendChild(c);
      b.addEventListener("click", function () { setRail(r.id); });
      elRails.appendChild(b);
    });
  }

  function setRail(id) {
    if (id === rail) return;
    rail = id;
    remember("rail", id);
    var btns = elRails ? elRails.querySelectorAll(".railbtn") : [];
    var i = 0;
    RAILS.forEach(function (r) {
      var n = CODES.filter(r.has).length;
      if (!n) return;
      if (btns[i]) btns[i].setAttribute("aria-pressed", String(r.id === rail));
      i++;
    });
    orderTiles();
    drawThumbs();   // the miniatures follow the rail: coins on QR, brand discs elsewhere
  }

  function buildGrid() {
    var frag = document.createDocumentFragment();
    CODES.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      /* EVERY ACCOUNT IS ONE ROW, none featured (owner, 14 Sep 2026). The row names the
       * institution as the DuitNow list names it, and a tag is a sub-line telling two accounts
       * at the same institution apart. */
      b.className = classOf(a);
      b.style.setProperty("--dot", a.brand);
      b.style.setProperty("--i", String(i));
      b.setAttribute("aria-current", "false");
      var sw = document.createElement("canvas");
      sw.className = "tiledot";
      sw.setAttribute("aria-hidden", "true");
      sw.style.background = a.brand;    // a brand disc until the miniature arrives
      var tx = document.createElement("span");
      tx.className = "tiletext";
      tx.textContent = a.bank || a.name;
      if (a.tag) {
        var tg = document.createElement("span");
        tg.className = "tiletag";
        tg.textContent = a.tag;
        tx.appendChild(tg);
      }
      b.appendChild(sw);
      b.appendChild(tx);
      b.addEventListener("click", function () { open(i); });
      frag.appendChild(b);
      tiles.push(b);
    });
    elGrid.appendChild(frag);
    buildRails();
    orderTiles();
    drawThumbs();
  }

  /* THE BADGE (owner, 14 Sep 2026): the brand disc with the institution's mark on it, for a row
   * on a rail that is not about codes. The mark is the traced `bankMark` where one exists, drawn
   * through the renderer's own routine; where none has been traced yet the initials stand in,
   * derived from the name so nothing new ships: up to three words' initials, or the first two
   * letters of a one-word name. Either way in whichever ink clears the disc. */
  function initialsOf(name) {
    var words = String(name).split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w); });
    var s = words.length > 1
      ? words.slice(0, 3).map(function (w) { return w.charAt(0); }).join("")
      : String(name).slice(0, 2);
    return s.toUpperCase();
  }
  function drawBadge(el, a) {
    var dpr = self.devicePixelRatio || 1, px = Math.round(THUMB * dpr);
    el.width = px; el.height = px;
    var g = el.getContext("2d");
    g.clearRect(0, 0, px, px);
    g.beginPath();
    g.arc(px / 2, px / 2, px / 2 - dpr, 0, Math.PI * 2);
    g.fillStyle = a.brand;
    g.fill();
    var C = self.QRArt.colour;
    var ink = C.contrast(C.hex2rgb(a.brand), [242, 244, 245]) >= 3 ? "#f2f4f5" : "#0b1215";
    var mark = markOf(a.bankMark);
    // As tall as three fifths of the disc, or as broad as four fifths, whichever binds: a square
    // app icon fills the disc, a long wordmark runs across it.
    if (mark) {
      var h = Math.min(px * 0.58, (px * 0.78) / mark.aspect);
      if (self.QRArt.drawMark(g, mark, px / 2, px / 2, h, px / 2, px / 2 - dpr, ink)) return;
    }
    var text = initialsOf(a.name);
    g.fillStyle = ink;
    g.font = "700 " + Math.round(px * (text.length > 2 ? 0.28 : 0.34)) +
      "px 'Geist Mono','Cascadia Mono',Consolas,Menlo,monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, px / 2, px / 2 + px * 0.02);
  }

  /* The thumbnails, drawn ALL AT ONCE, before the list is ever shown.
   *
   * They used to go in one per idle callback, and that was wrong: thirteen coins appearing one
   * after another reads as a download in progress, which is exactly what it is not. Drawn
   * together they are simply there when the app opens. It is affordable because DECORATIVE
   * mode draws each module as a plain rect rather than a rounded blob, which at a module of
   * about one pixel is visually identical and several times cheaper.
   *
   * Decorative is also what skips the safe-size fallback: at 36 pixels a code is a texture, not
   * something anyone can point a camera at, and without it every tile would carry a tiny plain
   * black square instead of a coin. */
  /* IT MUST ALSO UNDRAW, and for a while it only drew.
   *
   * This skipped a suspended account and moved on, which is right the first time through: the
   * tile still carries its plain brand disc and nothing has been painted. But it is run again
   * whenever /state.json changes what is suspended, and then skipping is silently wrong in both
   * directions. An account the bundle bakes as LIVE has its miniature painted at startup; if KV
   * then suspends it, the tile went grey and moved to the bottom while THE CODE STAYED ON IT.
   * That is precisely the failure the whole suspension mechanism exists to prevent, and the
   * rule is stated in as many words: a suspended account is not drawn anywhere, because a coin
   * that is drawn and then merely dimmed is one screenshot away from being scanned.
   *
   * The reverse was wrong too, and quieter: an account baked suspended and then RESTORED from
   * the laptop became live, clickable and orderable, but kept a blank brand disc until the next
   * deploy, because nothing ever came back to paint it.
   *
   * The clear is a real clear. Setting width discards the backing store rather than leaving the
   * pixels under a CSS rule, which is the same reason the code view resizes its canvas to 8x8
   * instead of hiding it. */
  function drawThumbs() {
    for (var i = 0; i < CODES.length; i++) {
      var a = CODES[i], el = thumbOf(i);
      if (!el || !el.getContext) continue;
      if (down(a)) {
        el.width = 8; el.height = 8;          // the pixels are gone, not covered
        el.style.background = a.brand;        // back to the plain disc, round again
        el.classList.remove("drawn");
        continue;
      }
      try {
        /* THE CODES APPEAR ON THE QR RAIL ONLY (owner, 14 Sep 2026). On Transfer and JomPAY
         * every row wears its badge instead, the code-less account included (owner, 15 Sep
         * 2026): a code on a list that is not about codes is a code on screen for no reason,
         * and one row on a paper plate among discs read as the odd one out. */
        if (rail === "qr") {
          paintFace(el, a, {
            size: THUMB, pixelRatio: self.devicePixelRatio || 1,
            plain: false, decorative: true
          });
        } else {
          drawBadge(el, a);
        }
        el.style.background = "none";
        el.classList.add("drawn");   // drops the disc's radius, which would clip the scallops
      } catch (e) { /* the brand disc stays, round; nothing is lost */ }
    }
  }

  /* ------------------------------------------------------------------- controls */

  function wire() {
    elBack.addEventListener("click", close);

    window.addEventListener("popstate", function () {
      // The phone's own back gesture. Nothing is trusted but the hash.
      if (indexOfKey(linkOf(location.hash).key) < 0) depth = 0;
      route();
    });

    /* Press and hold, or tap. Both save. Hold is the gesture a phone has already taught for
     * keeping a picture; the tap is there for the other instinct. The hold fires on its own
     * timer and then swallows the click that follows, so one press never saves twice. */
    var held = false, holdTimer = null, moved = false, startX = 0, startY = 0;

    function beginHold(x, y) {
      held = false; moved = false; startX = x; startY = y;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        if (moved) return;
        held = true;
        save();
      }, HOLD_MS);
    }
    function endHold() { clearTimeout(holdTimer); }

    elBtn.addEventListener("pointerdown", function (e) { beginHold(e.clientX, e.clientY); });
    elBtn.addEventListener("pointermove", function (e) {
      if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) { moved = true; endHold(); }
    });
    elBtn.addEventListener("pointerup", endHold);
    elBtn.addEventListener("pointercancel", function () { moved = true; endHold(); });
    elBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    elBtn.addEventListener("click", function (e) {
      if (held) { held = false; e.preventDefault(); return; }   // the hold already acted
      if (swiped) { swiped = false; return; }                   // a swipe is not a tap
      save();
    });

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var onCode = document.body.className.indexOf("view-code") >= 0;
      if (e.key === "Escape") { if (onCode) { close(); e.preventDefault(); } return; }
      if (!onCode) return;
      if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
      else if (e.key === "s" || e.key === "Enter") { save(); e.preventDefault(); }
      else if (e.key === "d" || e.key === "c") { copyAcct(); e.preventDefault(); }
    });

    /* Swipe across the code to step. A swipe must never also register as a tap, or every swipe
     * would save something. */
    var x0 = null, y0 = null;
    var stage = document.querySelector(".stage");
    stage.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; swiped = false;
    }, { passive: true });
    stage.addEventListener("touchmove", function (e) {
      if (x0 === null || !e.touches.length) return;
      if (Math.abs(e.touches[0].clientX - x0) > 20) { swiped = true; moved = true; endHold(); }
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (x0 === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    var t = null;
    var redraw = function () {
      clearTimeout(t);
      t = setTimeout(function () { killFlier(); paint(); }, 140);
    };
    window.addEventListener("resize", redraw);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", redraw);
  }

  var swiped = false;

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (!CODES.length) {
      document.querySelector(".atitle").textContent = "No codes in this build";
      return;
    }
    rememberedState();   // what this phone last read, before the first frame
    buildGrid();
    wire();
    // Asked for after the list is built, never waited on. The remembered state is already on
    // screen; this only narrows the window between a change made on /admin/ and the phone
    // agreeing, and a network round trip must never hold up the first frame.
    watchState();

    // The first frame is the list, dealt in. Anything else would flash the wrong screen.
    document.body.className = "view-list fresh";
    route();
    // The stagger runs once. Coming back to the list later should feel like returning to
    // something that was already there, not like the app starting again.
    setTimeout(function () { fresh = false; document.body.classList.remove("fresh"); }, 900);

    requestAnimationFrame(function () { requestAnimationFrame(function () { paint(); }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { paint(); });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js?v=" + BUILD).catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
