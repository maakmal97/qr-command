/* Pay - the read-only phone app.
 *
 * One screen. A provider name, its code, and two ways to change provider: a grid behind the
 * name, and a dot for each account along the bottom. Tap the code to save it to the gallery.
 * Nothing else is displayed and nothing else is shipped: data.js carries a key, a display
 * name, a brand colour and the payload, and that is the whole record. No legal name, no
 * account number, no owner, no edit path. Editing happens on the laptop, against the master.
 */
(function () {
  "use strict";

  var CODES = self.QR_CODES || [];
  var BUILD = self.QR_BUILD || "dev";
  var C = self.QRArt.colour;

  var elName = document.getElementById("name");
  var elNameBtn = document.getElementById("namebtn");
  var elCoin = document.getElementById("coin");
  var elBtn = document.getElementById("coinbtn");
  var elDots = document.getElementById("dots");
  var elSay = document.getElementById("say");
  var elPlain = document.getElementById("plainbtn");
  var elSheet = document.getElementById("sheet");
  var elGrid = document.getElementById("grid");
  var elClose = document.getElementById("sheetclose");

  var idx = 0;
  var plain = false;
  var dots = [];
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
   * 4.5:1 on the base, so the brand is lifted to a pastel until it does; a dark navy or a
   * deep red would otherwise be unreadable as text on a near-black page. */
  function softOf(brand) {
    var hsl = C.rgb2hsl(C.hex2rgb(brand));
    for (var l = Math.max(hsl[2], 0.62); l <= 0.94; l += 0.02) {
      var cand = C.hsl2rgb([hsl[0], Math.min(hsl[1], 0.82), l]);
      if (C.contrast(cand, [20, 18, 31]) >= 4.5) return C.rgb2hex(cand);
    }
    return "#e8ecf5";
  }

  function tune(brand) {
    var base = C.hex2rgb(brand);
    var hsl = C.rgb2hsl(base);
    // Aurora anchors: deep muted relatives of the brand, the hue rotated a third of the wheel
    // either way so the wash has depth rather than being one colour three times over.
    function anchor(shift, l) {
      return C.rgb2hex(C.hsl2rgb([(hsl[0] + shift + 1) % 1, Math.min(hsl[1], 0.6), l]));
    }
    var root = document.documentElement.style;
    root.setProperty("--brand", C.rgb2hex(base));
    root.setProperty("--brand-soft", softOf(brand));
    root.setProperty("--a1", anchor(0, 0.26));
    root.setProperty("--a2", anchor(-0.09, 0.20));
    root.setProperty("--a3", anchor(0.30, 0.22));

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", C.rgb2hex(C.mix([10, 13, 24], base, 0.10)));
  }

  /* --------------------------------------------------------------------- paint */

  /* The coin takes whatever square the stage can spare. Measured, not guessed, because the
   * title wraps to two lines on a narrow phone and the dot row varies with the safe area. */
  function fit() {
    var box = elBtn.parentNode;
    var size = Math.max(160, Math.floor(Math.min(box.clientWidth, box.clientHeight)));
    elBtn.style.width = size + "px";
    elBtn.style.height = size + "px";
    return size;
  }

  function artFor(a, extra) {
    return Object.assign({
      brand: a.brand, label: a.name, seed: a.key, plain: plain
    }, extra || {});
  }

  function paint() {
    var a = CODES[idx];
    if (!a) return;
    var meta = self.QRArt.draw(elCoin, a.payload, artFor(a, {
      size: fit(), pixelRatio: self.devicePixelRatio || 1
    }));
    // meta.plain, not the local flag: the renderer drops to the plain code by itself when the
    // screen is too small to draw a coin anyone could scan, and the page must follow it.
    elCoin.setAttribute("aria-label", a.name + " payment code");
    elBtn.setAttribute("aria-label", "Save the " + a.name + " code to your photos");
    elBtn.classList.toggle("plainmode", meta.plain);
    elPlain.setAttribute("aria-pressed", meta.plain ? "true" : "false");
    elPlain.disabled = meta.fellBack;
    elPlain.textContent = meta.fellBack ? "Plain code (screen too small)" : "Plain code";
    return meta;
  }

  function show(i, push) {
    idx = (i + CODES.length) % CODES.length;
    var a = CODES[idx];
    elName.textContent = a.name;
    tune(a.brand);
    for (var k = 0; k < CODES.length; k++) {
      var on = k === idx;
      if (dots[k]) { dots[k].setAttribute("aria-current", on ? "true" : "false"); dots[k].tabIndex = on ? 0 : -1; }
      if (tiles[k]) tiles[k].setAttribute("aria-current", on ? "true" : "false");
    }
    say("");
    paint();
    remember("last", a.key);
    if (push !== false && location.hash.slice(1) !== a.key) {
      history.replaceState(null, "", "#" + a.key);
    }
    // Build the saveable image while nothing else is happening, so a tap on the code can hand
    // it straight to the share sheet inside the gesture that asked for it.
    idle(function () { cardOf(a); });
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
   * usually before the tap, when show() warms it. */
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

  function save() {
    var a = CODES[idx];
    var card;
    try { card = cardOf(a); }
    catch (e) { say("Could not draw the image"); return; }

    var canShare = card.file && navigator.share && navigator.canShare &&
                   navigator.canShare({ files: [card.file] });
    if (canShare) {
      say("Opening…", false);
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

  /* ------------------------------------------------------------------ the grid */

  function openSheet() {
    elNameBtn.setAttribute("aria-expanded", "true");
    if (elSheet.showModal) elSheet.showModal(); else elSheet.setAttribute("open", "");
    var cur = tiles[idx];
    if (cur && cur.focus) cur.focus();
  }

  function closeSheet() {
    elNameBtn.setAttribute("aria-expanded", "false");
    if (elSheet.close) elSheet.close(); else elSheet.removeAttribute("open");
    elNameBtn.focus();
  }

  var sheetOpen = function () { return elSheet.open; };

  /* ---------------------------------------------------------------------- build */

  function buildGrid() {
    var frag = document.createDocumentFragment();
    CODES.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.style.setProperty("--dot", a.brand);
      b.style.setProperty("--soft", softOf(a.brand));
      b.setAttribute("aria-current", "false");
      var sw = document.createElement("span");
      sw.className = "tiledot";
      var tx = document.createElement("span");
      tx.className = "tiletext";
      tx.textContent = a.name;
      b.appendChild(sw);
      b.appendChild(tx);
      b.addEventListener("click", function () { show(i); closeSheet(); });
      frag.appendChild(b);
      tiles.push(b);
    });
    elGrid.appendChild(frag);
  }

  function buildDots() {
    var frag = document.createDocumentFragment();
    CODES.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dot";
      b.style.setProperty("--dot", a.brand);
      b.setAttribute("aria-label", a.name);
      b.title = a.name;
      b.setAttribute("aria-current", "false");
      b.tabIndex = -1;
      b.addEventListener("click", function () { show(i); });
      frag.appendChild(b);
      dots.push(b);
    });
    elDots.appendChild(frag);
  }

  function indexOfKey(key) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].key === key) return i;
    return -1;
  }

  /* ------------------------------------------------------------------- controls */

  function wire() {
    elBtn.addEventListener("click", save);
    elNameBtn.addEventListener("click", openSheet);
    elClose.addEventListener("click", closeSheet);
    elSheet.addEventListener("cancel", function () { elNameBtn.setAttribute("aria-expanded", "false"); });
    elSheet.addEventListener("click", function (e) {
      // A click on the dialog itself rather than its contents is a click on the backdrop.
      if (e.target === elSheet) closeSheet();
    });

    elPlain.addEventListener("click", function () {
      plain = !plain;
      remember("plain", plain ? "1" : "0");
      paint();
      say(plain ? "Plain code" : "");
    });

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (sheetOpen()) return;                       // the dialog handles its own keys
      if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); }
      else if (e.key === "Home") { show(0); e.preventDefault(); }
      else if (e.key === "End") { show(CODES.length - 1); e.preventDefault(); }
      else if (e.key === "g" || e.key === "/") { openSheet(); e.preventDefault(); }
      else if (e.key === "s") { save(); e.preventDefault(); }
      else if (e.key === "p") { elPlain.click(); e.preventDefault(); }
      else if (/^[0-9]$/.test(e.key)) {
        var n = e.key === "0" ? 9 : parseInt(e.key, 10) - 1;
        if (n < CODES.length) { show(n); e.preventDefault(); }
      }
    });

    /* Swipe across the code. A swipe must not also register as a tap, or every swipe would
     * try to save; the coin's click handler checks the flag this sets. */
    var x0 = null, y0 = null, swiped = false;
    var stage = document.querySelector(".stage");
    stage.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; swiped = false;
    }, { passive: true });
    stage.addEventListener("touchmove", function (e) {
      if (x0 === null || !e.touches.length) return;
      if (Math.abs(e.touches[0].clientX - x0) > 24) swiped = true;
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (x0 === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) show(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
    elBtn.addEventListener("click", function (e) {
      if (swiped) { e.stopImmediatePropagation(); swiped = false; }
    }, true);

    window.addEventListener("hashchange", function () {
      var i = indexOfKey(location.hash.slice(1));
      if (i >= 0 && i !== idx) show(i, false);
    });

    var t = null;
    var redraw = function () { clearTimeout(t); t = setTimeout(paint, 140); };
    window.addEventListener("resize", redraw);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", redraw);
  }

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (!CODES.length) {
      elName.textContent = "No codes in this build";
      return;
    }
    plain = recall("plain") === "1";
    buildGrid();
    buildDots();
    wire();

    var i = indexOfKey(location.hash.slice(1));
    if (i < 0) i = indexOfKey(recall("last") || "");
    if (i < 0) i = 0;
    show(i);

    // Two passes: fonts settle after the first frame and the title can rewrap, which changes
    // the square the coin gets.
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
