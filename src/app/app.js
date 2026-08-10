/* Pay - the read-only phone app.
 *
 * One screen. A provider name, its code, and a rail to change provider. Nothing else is
 * displayed and nothing else is shipped: data.js carries a key, a display name, a brand
 * colour and the payload, and that is the whole record. No legal name, no account number, no
 * owner, no edit path. Editing happens on the laptop, against the master.
 */
(function () {
  "use strict";

  var CODES = self.QR_CODES || [];
  var BUILD = self.QR_BUILD || "dev";
  var C = self.QRArt.colour;

  var elName = document.getElementById("name");
  var elCoin = document.getElementById("coin");
  var elBtn = document.getElementById("coinbtn");
  var elRail = document.getElementById("rail");
  var elSay = document.getElementById("say");

  var idx = 0;
  var plain = false;
  var chips = [];

  /* ------------------------------------------------------------------- storage */

  function remember(k, v) { try { localStorage.setItem("pay:" + k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem("pay:" + k); } catch (e) { return null; } }

  /* -------------------------------------------------------------------- tuning */

  /* The page takes its light from the same brand colour the coin does. The name has to clear
   * 4.5:1 on the base, so the brand is lifted to a pastel until it does; a dark navy or a
   * deep red would otherwise be unreadable as text on a near-black page. */
  function tune(brand) {
    var base = C.hex2rgb(brand);
    var hsl = C.rgb2hsl(base);
    var soft = null;
    for (var l = Math.max(hsl[2], 0.62); l <= 0.94; l += 0.02) {
      var cand = C.hsl2rgb([hsl[0], Math.min(hsl[1], 0.82), l]);
      if (C.contrast(cand, [20, 18, 31]) >= 4.5) { soft = cand; break; }
    }
    if (!soft) soft = [232, 236, 245];

    // Aurora anchors: deep muted relatives of the brand, the hue rotated a third of the wheel
    // either way so the wash has depth rather than being one colour three times over.
    function anchor(shift, l) {
      return C.rgb2hex(C.hsl2rgb([(hsl[0] + shift + 1) % 1, Math.min(hsl[1], 0.6), l]));
    }
    var root = document.documentElement.style;
    root.setProperty("--brand", C.rgb2hex(base));
    root.setProperty("--brand-soft", C.rgb2hex(soft));
    root.setProperty("--a1", anchor(0, 0.26));
    root.setProperty("--a2", anchor(-0.09, 0.20));
    root.setProperty("--a3", anchor(0.30, 0.22));

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", C.rgb2hex(C.mix([10, 13, 24], base, 0.10)));
  }

  /* --------------------------------------------------------------------- layout */

  /* The coin takes whatever square the stage can spare. Measured, not guessed, because the
   * title wraps to two lines on a narrow phone and the rail height varies with the safe area. */
  function fit() {
    var box = elBtn.parentNode;
    var w = box.clientWidth;
    var h = box.clientHeight;
    var size = Math.max(160, Math.floor(Math.min(w, h)));
    elBtn.style.width = size + "px";
    elBtn.style.height = size + "px";
    return size;
  }

  /* ---------------------------------------------------------------------- paint */

  function paint() {
    var a = CODES[idx];
    if (!a) return;
    var size = fit();
    var meta = self.QRArt.draw(elCoin, a.payload, {
      size: size,
      pixelRatio: self.devicePixelRatio || 1,
      brand: a.brand,
      plain: plain
    });
    // meta.plain, not the local flag: the renderer drops to the plain code by itself when the
    // screen is too small to draw a coin anyone could scan, and the page must follow it.
    elCoin.setAttribute("aria-label", a.name + " payment code");
    elBtn.setAttribute("aria-label", a.name + " payment code. Activate for a plain code.");
    elBtn.classList.toggle("plainmode", meta.plain);
    elSay.textContent = meta.plain ? "Plain code" : "";
    return meta;
  }

  function show(i, push) {
    idx = (i + CODES.length) % CODES.length;
    var a = CODES[idx];
    elName.textContent = a.name;
    tune(a.brand);
    for (var k = 0; k < chips.length; k++) {
      var on = k === idx;
      chips[k].setAttribute("aria-current", on ? "true" : "false");
      chips[k].tabIndex = on ? 0 : -1;
    }
    paint();
    remember("last", a.key);
    if (push !== false && location.hash.slice(1) !== a.key) {
      history.replaceState(null, "", "#" + a.key);
    }
    var chip = chips[idx];
    if (chip && chip.scrollIntoView) {
      chip.scrollIntoView({ block: "nearest", inline: "center",
        behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
    }
  }

  /* ---------------------------------------------------------------------- build */

  function buildRail() {
    var frag = document.createDocumentFragment();
    CODES.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = a.name;
      b.setAttribute("data-key", a.key);
      b.setAttribute("aria-current", "false");
      b.tabIndex = -1;
      b.style.setProperty("--dot", a.brand);
      b.addEventListener("click", function () { show(i); b.focus(); });
      frag.appendChild(b);
      chips.push(b);
    });
    elRail.appendChild(frag);
  }

  function indexOfKey(key) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].key === key) return i;
    return -1;
  }

  /* ------------------------------------------------------------------- controls */

  function wire() {
    elBtn.addEventListener("click", function () {
      plain = !plain;
      remember("plain", plain ? "1" : "0");
      paint();
    });

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); }
      else if (e.key === "Home") { show(0); e.preventDefault(); }
      else if (e.key === "End") { show(CODES.length - 1); e.preventDefault(); }
      else if (/^[0-9]$/.test(e.key)) {
        var n = e.key === "0" ? 9 : parseInt(e.key, 10) - 1;
        if (n < CODES.length) { show(n); e.preventDefault(); }
      }
    });

    // Swipe across the code itself. Touches that begin in the rail are left alone so the rail
    // can still be scrolled.
    var x0 = null, y0 = null;
    var stage = document.querySelector(".stage");
    stage.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (x0 === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) show(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });

    window.addEventListener("hashchange", function () {
      var i = indexOfKey(location.hash.slice(1));
      if (i >= 0 && i !== idx) show(i, false);
    });

    var t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(paint, 140);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        clearTimeout(t); t = setTimeout(paint, 140);
      });
    }
  }

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (!CODES.length) {
      elName.textContent = "No codes in this build";
      return;
    }
    plain = recall("plain") === "1";
    buildRail();
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
