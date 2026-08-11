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
  var C = self.QRArt.colour;

  var elName = document.getElementById("name");
  var elCoin = document.getElementById("coin");
  var elBtn = document.getElementById("coinbtn");
  var elSay = document.getElementById("say");
  var elPlain = document.getElementById("plainbtn");
  var elGrid = document.getElementById("grid");
  var elBack = document.getElementById("back");
  var elBackFace = document.getElementById("coinback");
  var elFlip = document.getElementById("flipbtn");
  var elList = document.getElementById("accounts");
  var skies = [document.getElementById("sky1"), document.getElementById("sky2")];
  var skyOn = 0;

  // The miniature on a tile, in CSS pixels. Must match --thumb in app.css.
  var THUMB = 36;
  // One duration for the whole transition, so the coin, the fade and the chrome agree.
  var ZOOM = 460;

  var idx = -1;
  var plain = false;
  var tiles = [];
  var cards = {};        // one saveable image per account, built once and kept
  var sayTimer = null;
  var depth = 0;         // how many entries WE pushed, so back is never a guess
  var flier = null;      // the coin in transit, if any
  var flipped = false;   // showing the reverse, with the account number

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

  /* -------------------------------------------------------------------- tuning */

  /* The page takes its light from the same brand colour the coin does. The name has to clear
   * 4.5:1 on the base, so the brand is lifted to a pastel until it does; a dark navy or a deep
   * red would otherwise be unreadable as text on a near-black page. */
  function softOf(brand) {
    var hsl = C.rgb2hsl(C.hex2rgb(brand));
    for (var l = Math.max(hsl[2], 0.62); l <= 0.94; l += 0.02) {
      var cand = C.hsl2rgb([hsl[0], Math.min(hsl[1], 0.82), l]);
      if (C.contrast(cand, [20, 18, 31]) >= 4.5) return C.rgb2hex(cand);
    }
    return "#e8ecf5";
  }

  function tune(brand) {
    var base = brand ? C.hex2rgb(brand) : [122, 132, 155];
    var hsl = C.rgb2hsl(base);
    function anchor(shift, l) {
      return C.rgb2hex(C.hsl2rgb([(hsl[0] + shift + 1) % 1, Math.min(hsl[1], 0.6), l]));
    }
    var root = document.documentElement.style;
    root.setProperty("--brand", C.rgb2hex(base));
    root.setProperty("--brand-soft", brand ? softOf(brand) : "#c3cbdb");
    // The coin's halo. A drop-shadow needs a colour with alpha rather than a spread, so it is
    // built here where the brand is already in pieces.
    root.setProperty("--glow", "rgba(" + base.map(Math.round).join(",") + ",0.42)");

    /* The aurora cross-fades rather than transitioning its colours. The incoming washes are
     * written to whichever layer is currently hidden, which paints it once, and then the two
     * swap opacity, which the compositor handles without the main thread. Transitioning the
     * colours instead meant repainting the whole background on every frame of the change. */
    var next = skies[1 - skyOn], cur = skies[skyOn];
    if (next && cur) {
      next.style.setProperty("--s1", anchor(0, 0.26));
      next.style.setProperty("--s2", anchor(-0.09, 0.20));
      next.style.setProperty("--s3", anchor(0.30, 0.22));
      next.classList.add("on");
      cur.classList.remove("on");
      skyOn = 1 - skyOn;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", C.rgb2hex(C.mix([10, 13, 24], base, 0.10)));
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
      brand: a.brand, label: a.name, seed: a.key, plain: plain
    }, extra || {});
  }

  /* Draw an account's coin into a canvas of its own, without touching the page. Used to keep
   * the cost of a redraw OFF the animation: six to fourteen milliseconds is most of a frame,
   * and spent halfway through a transition it drops one exactly where the eye is following the
   * coin. Rendered up front, the swap becomes a drawImage of about a hundredth of that. */
  function prerender(i) {
    var a = CODES[i];
    if (!a) return null;
    var off = document.createElement("canvas");
    var meta = self.QRArt.draw(off, a.payload, artFor(a, {
      size: fit(), pixelRatio: self.devicePixelRatio || 1
    }));
    return { canvas: off, meta: meta };
  }

  /* The reverse is drawn only when it is first needed and then kept, because most openings
   * never turn the coin over. */
  var backs = {};
  function paintBack() {
    var a = CODES[idx];
    if (!a || !elBackFace) return;
    var size = fit();
    var dpr = self.devicePixelRatio || 1;
    var key = a.key + "|" + size + "|" + dpr;
    if (backs.key === key) return;
    self.QRArt.drawBack(elBackFace, {
      size: size, pixelRatio: dpr, brand: a.brand, label: a.name, seed: a.key, acct: a.acct
    });
    elBackFace.setAttribute("aria-label", a.name + " account number " + a.acct);
    backs.key = key;
  }

  function paint(pre) {
    var a = CODES[idx];
    if (!a) return null;
    var meta;
    if (pre && pre.canvas) {
      elCoin.width = pre.canvas.width;
      elCoin.height = pre.canvas.height;
      elCoin.getContext("2d").drawImage(pre.canvas, 0, 0);
      meta = pre.meta;
    } else {
      meta = self.QRArt.draw(elCoin, a.payload, artFor(a, {
        size: fit(), pixelRatio: self.devicePixelRatio || 1
      }));
    }
    // meta.plain, not the local flag: the renderer drops to the plain code by itself when the
    // screen is too small to draw a coin anyone could scan, and the page must follow it.
    elCoin.setAttribute("aria-label", a.name + " payment code");
    elBtn.setAttribute("aria-label", a.name + " payment code. Press and hold to save it to your photos.");
    elBtn.classList.toggle("plainmode", meta.plain);
    elPlain.setAttribute("aria-pressed", meta.plain ? "true" : "false");
    elPlain.disabled = meta.fellBack;
    elPlain.textContent = meta.fellBack ? "Plain code (screen too small)" : "Plain code";
    if (flipped) paintBack();
    return meta;
  }

  /* Turning the coin over. The number is real text on the button, not only pixels on a canvas,
   * so a screen reader can read it and the copy never depends on the drawing. */
  function setFlipped(on) {
    flipped = !!on;
    if (flipped) paintBack();
    elBtn.classList.toggle("flipped", flipped);
    elFlip.setAttribute("aria-pressed", flipped ? "true" : "false");
    elFlip.textContent = flipped ? "Show the code" : "DuitNow number";
    var a = CODES[idx];
    if (a) {
      elBtn.setAttribute("aria-label", flipped
        ? a.name + " account number " + a.acct + ". Tap to copy."
        : a.name + " payment code. Press and hold to save it to your photos.");
    }
    say(flipped ? "Tap to copy" : "");
  }

  /* Copy the digits, not the spacing: the spaced form is for reading, and what goes into a
   * banking app is the number itself. */
  function copyAcct() {
    var a = CODES[idx];
    if (!a || !a.acct) return;
    var digits = a.acct.replace(/\s+/g, "");
    var done = function () { say("Copied " + a.acct); tuck(); };
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
    setTimeout(function () { el.classList.remove(cls); }, ms || 420);
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
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 620);
  }

  /* -------------------------------------------------------------------- routing */

  /* The hash is the state, and it is the ONLY state. Nothing reads history.state to decide what
   * to draw, because after a reload that state is stale and back landed on whatever entry
   * happened to be behind, which could be another code. `depth` counts only the entries this
   * page session pushed, so Accounts either unwinds one of ours or rewrites the hash in place,
   * and can never walk off into somebody else's history. */
  function route(pre) {
    var i = indexOfKey(decodeURIComponent((location.hash || "").slice(1)));
    if (i >= 0) showCode(i, pre); else showList();
  }

  function showList() {
    if (document.body.className.indexOf("view-list") >= 0) return;
    document.body.className = "view-list" + (fresh ? " fresh" : "");
    idx = -1;
    tune(null);
    document.title = "Pay";
  }

  function showCode(i, pre) {
    idx = (i + CODES.length) % CODES.length;
    var a = CODES[idx];
    var arriving = document.body.className.indexOf("view-code") < 0;
    document.body.className = "view-code";
    elName.textContent = a.name;
    document.title = a.name;
    tune(a.brand);
    for (var k = 0; k < tiles.length; k++) {
      tiles[k].setAttribute("aria-current", k === idx ? "true" : "false");
    }
    say("");
    // A different account always arrives face up. Its number is not the one just on screen.
    if (flipped) setFlipped(false);
    paint(pre);
    oneShot(elName, "enter", 360);
    remember("last", a.key);
    idle(function () { cardOf(a); });
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
      oneShot(elBtn, "enter", 320);
      return;
    }
    elBtn.style.opacity = "0";
  }

  /* Closing: the coin shrinks back into its tile. */
  function close() {
    var was = idx;
    var from = still() ? null : rectOf(elBtn);
    var shot = null;
    if (from && elCoin.width) {
      shot = document.createElement("canvas");
      shot.width = elCoin.width;
      shot.height = elCoin.height;
      shot.getContext("2d").drawImage(elCoin, 0, 0);
    }

    if (depth > 0) { depth--; history.back(); }
    else history.replaceState({ n: 0 }, "", "#");
    showList();

    var thumb = thumbOf(was);
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
  function step(i, dir) {
    i = (i + CODES.length) % CODES.length;
    if (i === idx) return;
    var out = dir < 0 ? "out-left" : "out-right";
    var into = dir < 0 ? "in-right" : "in-left";
    var pre = still() ? null : prerender(i);
    if (dir) oneShot(elBtn, out, 170);
    after(dir && !still() ? 150 : 0, function () {
      history.replaceState(history.state, "", "#" + CODES[i].key);
      showCode(i, pre);
      if (dir) oneShot(elBtn, into, 280);
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
    oneShot(elBtn, "tuck", 540);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  function save() {
    var a = CODES[idx];
    if (!a) return;
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

  function buildGrid() {
    var frag = document.createDocumentFragment();
    CODES.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.style.setProperty("--dot", a.brand);
      b.style.setProperty("--soft", softOf(a.brand));
      b.style.setProperty("--i", String(i));
      b.setAttribute("aria-current", "false");
      var sw = document.createElement("canvas");
      sw.className = "tiledot";
      sw.setAttribute("aria-hidden", "true");
      sw.style.background = a.brand;    // a brand disc until the miniature arrives
      var tx = document.createElement("span");
      tx.className = "tiletext";
      tx.textContent = a.name;
      b.appendChild(sw);
      b.appendChild(tx);
      b.addEventListener("click", function () { open(i); });
      frag.appendChild(b);
      tiles.push(b);
    });
    elGrid.appendChild(frag);
    drawThumbs();
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
  function drawThumbs() {
    for (var i = 0; i < CODES.length; i++) {
      var a = CODES[i], el = thumbOf(i);
      if (!el || !el.getContext) continue;
      try {
        self.QRArt.draw(el, a.payload, artFor(a, {
          size: THUMB, pixelRatio: self.devicePixelRatio || 1,
          plain: false, decorative: true
        }));
        el.style.background = "none";
      } catch (e) { /* the brand disc stays; nothing is lost */ }
    }
  }

  /* ------------------------------------------------------------------- controls */

  function wire() {
    elBack.addEventListener("click", close);

    window.addEventListener("popstate", function () {
      // The phone's own back gesture. Nothing is trusted but the hash.
      if (indexOfKey(decodeURIComponent((location.hash || "").slice(1))) < 0) depth = 0;
      route();
    });

    elPlain.addEventListener("click", function (e) {
      e.stopPropagation();
      plain = !plain;
      remember("plain", plain ? "1" : "0");
      paint();
      say(plain ? "Plain code" : "");
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
        if (flipped) copyAcct(); else save();
      }, 420);
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
      if (flipped) copyAcct(); else save();
    });

    elFlip.addEventListener("click", function (e) {
      e.stopPropagation();
      setFlipped(!flipped);
    });

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var onCode = document.body.className.indexOf("view-code") >= 0;
      if (e.key === "Escape") { if (onCode) { close(); e.preventDefault(); } return; }
      if (!onCode) return;
      if (e.key === "ArrowRight") { step(idx + 1, 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { step(idx - 1, -1); e.preventDefault(); }
      else if (e.key === "s" || e.key === "Enter") { if (flipped) copyAcct(); else save(); e.preventDefault(); }
      else if (e.key === "p") { elPlain.click(); e.preventDefault(); }
      else if (e.key === "d" || e.key === "c") { setFlipped(!flipped); e.preventDefault(); }
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
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) step(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
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
    plain = recall("plain") === "1";
    buildGrid();
    wire();

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
