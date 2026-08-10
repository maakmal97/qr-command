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
  var skies = [document.getElementById("sky1"), document.getElementById("sky2")];
  var skyOn = 0;

  var idx = -1;
  var plain = false;
  var tiles = [];
  var cards = {};        // one saveable image per account, built once and kept
  var sayTimer = null;

  /* ------------------------------------------------------------------- storage */

  function remember(k, v) { try { localStorage.setItem("pay:" + k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem("pay:" + k); } catch (e) { return null; } }

  function say(msg, hold) {
    clearTimeout(sayTimer);
    elSay.textContent = msg || "";
    if (msg && hold !== false) sayTimer = setTimeout(function () { elSay.textContent = ""; }, 3200);
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

  /* Draw the coin for an account into a canvas of its own, without touching the page.
   *
   * Used to move the cost of a redraw OFF the animation. Drawing takes six to fourteen
   * milliseconds, which is most of a frame, and doing it at the halfway point of a step meant
   * dropping one right where the eye is following the coin across. Rendered up front instead,
   * before the exit animation starts, the hitch lands in the gap between the thumb moving and
   * anything appearing, where nobody can see it, and the swap itself becomes a drawImage of
   * about a millisecond. */
  function prerender(i) {
    var a = CODES[i];
    if (!a) return null;
    var off = document.createElement("canvas");
    var meta = self.QRArt.draw(off, a.payload, artFor(a, {
      size: fit(), pixelRatio: self.devicePixelRatio || 1
    }));
    return { canvas: off, meta: meta };
  }

  function paint(pre) {
    var a = CODES[idx];
    if (!a || document.body.className.indexOf("view-code") < 0) return;
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
    return meta;
  }

  /* -------------------------------------------------------------------- motion */

  /* Nothing here may be load-bearing. Every step that changes what is on screen runs on a
   * timer, and that timer is zero when motion is off, rather than waiting for an animationend
   * that a reduced-motion phone will never send. If the animation does not play, the app
   * behaves identically, just instantly. */
  var reduced = self.matchMedia ? self.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function still() { return !!reduced.matches; }
  function after(ms, fn) { if (still()) fn(); else setTimeout(fn, ms); }

  /* Play a class once and take it off again.
   *
   * The removal is not tidiness. Every one of these sets the `animation` property on the same
   * element, so a class left behind stays in the cascade and out-ranks the next one by nothing
   * more than being further down the stylesheet: leave `enter` on the coin and `tuck` never
   * plays again after the first navigation, silently, because the save still works and only
   * the motion is missing. They are mutually exclusive by nature, so adding one clears the
   * rest. */
  var ONESHOT = ["enter", "tuck", "in-left", "in-right", "out-left", "out-right"];
  function oneShot(el, cls, ms) {
    if (still() || !el) return;
    for (var i = 0; i < ONESHOT.length; i++) el.classList.remove(ONESHOT[i]);
    void el.offsetWidth;                       // restart the animation
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 420);
  }

  /* The tapped tile's dot swells into the coin. Measured from the real geometry both ends, so
   * it lands on the coin exactly, whatever the screen. The coin is held invisible until the
   * swell is nearly home and then fades in underneath it, which is what makes the two read as
   * one object rather than two. */
  /* Takes a RECT, not the tile, and that signature is the fix for a bug rather than a
   * preference: the tile has to be measured before the view switches, because the moment the
   * code view is shown the accounts are `display:none` and every rect on them reads zero. It
   * failed silently, the morph simply never appearing, which is why the measurement now
   * happens in open() and cannot be moved back in here. */
  function morph(from, brand) {
    if (still() || !from || !elBtn) { if (elBtn) elBtn.style.opacity = ""; return false; }
    var to = elBtn.getBoundingClientRect();
    if (!from.width || !to.width) return false;

    /* Built at the TARGET size and scaled DOWN to start, never the other way about. Starting
      * at the tile's fifteen pixels and scaling up twenty-two times would upscale a fifteen
      * pixel raster, which arrives soft and blocky; this way the layer is rasterised once at
      * full size and only ever shrinks. */
    var m = document.createElement("div");
    m.className = "morph";
    m.style.left = to.left + "px";
    m.style.top = to.top + "px";
    m.style.width = to.width + "px";
    m.style.height = to.height + "px";
    m.style.background = brand;
    m.style.boxShadow = "0 0 40px -6px " + brand;
    document.body.appendChild(m);

    var s0 = from.width / to.width;
    var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    var dy = (from.top + from.height / 2) - (to.top + to.height / 2);

    elBtn.style.opacity = "0";
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      if (m.parentNode) m.parentNode.removeChild(m);
      elBtn.style.opacity = "";
    };

    if (m.animate) {
      var a = m.animate([
        { transform: "translate(" + dx + "px," + dy + "px) scale(" + s0 + ")", opacity: 1 },
        { transform: "translate(0,0) scale(1)", opacity: 0.85, offset: 0.72 },
        { transform: "translate(0,0) scale(1)", opacity: 0 }
      ], { duration: 430, easing: "cubic-bezier(.2,.8,.2,1)" });
      if (a.finished && a.finished.then) a.finished.then(finish, finish);
    }
    // The belt to that braces: whatever the animation does or fails to do, the coin comes back.
    setTimeout(function () { elBtn.style.opacity = ""; oneShot(elBtn, "enter", 320); }, 250);
    setTimeout(finish, 520);
    return true;
  }

  function flash() {
    if (still() || !elBtn) return;
    var r = elBtn.getBoundingClientRect();
    if (!r.width) return;
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

  /* Two views, addressed by the hash, so the phone's own back gesture and a home-screen icon
   * pointing at one account both work without any of it being special-cased. */
  function renderList() {
    document.body.className = "view-list";
    idx = -1;
    tune(null);
    document.title = "Pay";
  }

  function renderCode(i, stepping, pre) {
    idx = (i + CODES.length) % CODES.length;
    var a = CODES[idx];
    var arriving = document.body.className !== "view-code";
    document.body.className = "view-code";
    elName.textContent = a.name;
    document.title = a.name;
    tune(a.brand);
    for (var k = 0; k < tiles.length; k++) {
      tiles[k].setAttribute("aria-current", k === idx ? "true" : "false");
    }
    say("");
    paint(pre);
    // The name lifts in whenever it changes; the coin only on arrival, because when stepping
    // between accounts the slide is already carrying it.
    oneShot(elName, "enter", 360);
    if (arriving && !stepping) oneShot(elBtn, "enter", 320);
    remember("last", a.key);
    idle(function () { cardOf(a); });   // warm the saveable image before it is asked for
  }

  function route() {
    var key = decodeURIComponent((location.hash || "").slice(1));
    var i = indexOfKey(key);
    if (i >= 0) renderCode(i); else renderList();
  }

  function open(i, tile) {
    /* Measure the tile FIRST. Once renderCode has run, the accounts are display:none and this
     * rect would read zero, which is how the morph came to do nothing at all the first time. */
    var dot = (!still() && tile) ? tile.querySelector(".tiledot") : null;
    var from = dot ? dot.getBoundingClientRect() : null;

    history.pushState({ fromList: true }, "", "#" + CODES[i].key);
    // stepping:true suppresses the coin's own entrance, because the morph is the entrance: the
    // tile's dot swells into it and the coin fades in underneath. If there is no morph to play,
    // the coin needs that entrance back.
    renderCode(i, true);
    if (!morph(from, CODES[i].brand)) oneShot(elBtn, "enter", 320);
  }

  /* Stepping between codes REPLACES rather than pushes, so back always returns to the list
   * rather than walking every code that was swiped past on the way here. The coin leaves the
   * way the thumb went and the next arrives from the far side, so the direction reads. */
  function switchTo(i, dir) {
    i = (i + CODES.length) % CODES.length;
    if (i === idx) return;
    var out = dir < 0 ? "out-left" : "out-right";
    var into = dir < 0 ? "in-right" : "in-left";
    // Draw the incoming coin BEFORE anything starts moving, so the animation itself is free.
    var pre = still() ? null : prerender(i);
    if (dir) oneShot(elBtn, out, 170);
    after(dir && !still() ? 150 : 0, function () {
      history.replaceState(history.state, "", "#" + CODES[i].key);
      renderCode(i, true, pre);
      if (dir) oneShot(elBtn, into, 280);
    });
  }

  function goBack() {
    if (history.state && history.state.fromList) history.back();
    else { history.replaceState(null, "", "#"); renderList(); }
  }

  function idle(fn) {
    if (self.requestIdleCallback) self.requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 300);
  }

  /* ----------------------------------------------------------- save to gallery */

  /* Built SYNCHRONOUSLY, on purpose, and cached.
   *
   * iOS only allows navigator.share from inside the gesture that triggered it, and awaiting
   * canvas.toBlob is enough to lose that permission, which presents as the share sheet simply
   * never appearing. toDataURL is slower but synchronous, so the file exists before share is
   * called and the gesture is still live. The cache means the cost is paid once per account,
   * usually before the press, when renderCode() warms it. */
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

  /* The coin is taken off the page and put away: it dips, then comes back. The motion is the
   * only explanation the action gets, and it only plays once the save has actually started. */
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
      var sw = document.createElement("span");
      sw.className = "tiledot";
      var tx = document.createElement("span");
      tx.className = "tiletext";
      tx.textContent = a.name;
      b.appendChild(sw);
      b.appendChild(tx);
      b.addEventListener("click", function () { open(i, b); });
      frag.appendChild(b);
      tiles.push(b);
    });
    elGrid.appendChild(frag);
  }

  function indexOfKey(key) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].key === key) return i;
    return -1;
  }

  /* ------------------------------------------------------------------- controls */

  function wire() {
    elBack.addEventListener("click", goBack);
    window.addEventListener("popstate", route);

    elPlain.addEventListener("click", function (e) {
      e.stopPropagation();
      plain = !plain;
      remember("plain", plain ? "1" : "0");
      paint();
      say(plain ? "Plain code" : "");
    });

    /* Press and hold, or tap. Both save.
     *
     * Hold is the gesture a phone has already taught for keeping a picture, so it is the one
     * most likely to be reached for; the tap is there for the other instinct. The hold fires
     * on its own timer and then swallows the click that follows, so one press never saves
     * twice. */
    var held = false, holdTimer = null, moved = false, startX = 0, startY = 0;

    function beginHold(x, y) {
      held = false; moved = false; startX = x; startY = y;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        if (moved) return;
        held = true;
        save();
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
      if (held) { held = false; e.preventDefault(); return; }   // the hold already saved
      if (swiped) { swiped = false; return; }                   // a swipe is not a tap
      save();
    });

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var onCode = document.body.className.indexOf("view-code") >= 0;
      if (e.key === "Escape") { if (onCode) { goBack(); e.preventDefault(); } return; }
      if (!onCode) return;
      if (e.key === "ArrowRight") { switchTo(idx + 1, 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { switchTo(idx - 1, -1); e.preventDefault(); }
      else if (e.key === "s" || e.key === "Enter") { save(); e.preventDefault(); }
      else if (e.key === "p") { elPlain.click(); e.preventDefault(); }
    });

    /* Swipe across the code to step to the next account. A swipe must never also register as
     * a tap, or every swipe would save something. */
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
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) switchTo(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }, { passive: true });

    var t = null;
    var redraw = function () { clearTimeout(t); t = setTimeout(paint, 140); };
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
    route();

    requestAnimationFrame(function () { requestAnimationFrame(paint); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js?v=" + BUILD).catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
