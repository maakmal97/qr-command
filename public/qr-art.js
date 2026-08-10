/* qr-art.js - the coin.
 *
 * Draws a DuitNow payload as a circular badge: a brand-coloured milled ring, a near-white
 * field, and the code itself rendered as liquid blobs with ringed eyes.
 *
 * THE ONE RULE. Everything here is a change of APPEARANCE, never of DATA. The payload string
 * is passed to the encoder untouched, and the module matrix the encoder returns is drawn
 * module for module at its exact grid position. Nothing is moved, dropped, added or nudged.
 * What varies is the shape, the colour and the frame, none of which a decoder samples.
 *
 * The three things that would break a scan, and what holds each one:
 *   1. Quiet zone. Four light modules on every side, and the light field is sized so the
 *      whole margin square fits inside the circle, corners included (see coinGeometry).
 *   2. Contrast. Dark on light, never inverted, and the ink is darkened until it clears
 *      minContrast against the field. A brand colour is a starting point, not a promise.
 *   3. Module centres. Every shape is centred on its cell and never exceeds it, so the
 *      sampling grid a decoder reconstructs still lands on ink where the matrix says dark.
 *
 * None of that is taken on trust: test/verify.mjs draws every real payload at several sizes
 * and decodes the pixels back with jsQR, asserting the string comes out byte for byte.
 */
self.QRArt = (function () {
  "use strict";

  /* ------------------------------------------------------------------ defaults */

  var DEFAULTS = {
    quiet: 4,            // light modules on every side. Four is the specification minimum.
    /* Error correction, and the one counter-intuitive decision in this file.
     *
     * The obvious move is to ask for the most error correction the payload will take, on the
     * reasoning that a decorated code needs the redundancy. Measured, that is exactly wrong.
     * Raising the level adds modules, and adding modules shrinks each one; for a code read
     * off a screen, module size is the binding constraint and redundancy is not. Decoding
     * every real payload at every level, the smallest size at which the worst code in the
     * book still read was 880 pixels at H and 370 at M. One code was stuck at 540 even drawn
     * as plain black squares, purely because H had pushed it to 61 modules.
     *
     * The stylisation costs no error correction anyway: it is faithful at every module centre
     * outside the eyes, so there is no damage for the redundancy to repair. M gives 15 per
     * cent, which is the conventional choice for a payment code and covers glare and a
     * fingerprint, and it is what the master page and the printed card already use, so all
     * three agree. Levels are tried in order and the first that can carry the payload wins;
     * L is here only for a payload too long for M. */
    ecl: ["M", "L"],
    maxModules: 77,      // a sanity ceiling, not a target. Warned about, never silently met.
    dot: 0.5,            // corner radius as a fraction of a module. 0.5 makes a lone module
                         // a circle and a run of them a capsule. This is the liquid look.
    ringWidth: 0.055,    // ring thickness as a fraction of the coin radius
    milled: true,        // coin-edge ticks in the ring
    sheen: true,         // a light sweep across the ring
    minContrast: 8,      // ink against field. WCAG's ceiling is 21; 8 is comfortably safe.
    minModulePx: 6,      // floor on a module, in device pixels, in the backing store
    /* The smallest the coin may be PHYSICALLY DRAWN and still be trusted to scan. Measured,
     * not chosen: decoding every payload at descending sizes, the worst code in the book
     * stopped reading below 370 physical pixels, so this is that with half again on top.
     * Below it the app draws the plain code instead, which reads down to 230. The two numbers
     * are re-measured by test/verify.mjs on every run, so this one cannot quietly go stale. */
    safePhysicalPx: 560,
    plain: false         // true draws an ordinary square code on a white square
  };

  /* A shape needs pixels to be a shape. Measured with jsQR against all thirteen real
   * payloads, the coin decodes at every size from 400 device pixels up and is erratic below
   * it, because at two or three pixels a module a rounded blob is mostly antialiasing. So
   * the backing store is never allowed below the size that gives minModulePx per module,
   * whatever CSS size the page is showing; the browser downscales for display and the
   * buffer that was proved is the buffer that is drawn. */
  function minDeviceFor(n, opts) {
    var span = (n + 2 * opts.quiet) * Math.SQRT2;   // module units across the light field
    return Math.ceil((opts.minModulePx * span) / (1 - opts.ringWidth));
  }

  /* -------------------------------------------------------------------- colour */

  function hex2rgb(h) {
    h = String(h || "").trim().replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [90, 90, 90];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgb2hex(c) {
    return "#" + c.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? "0" + s : s;
    }).join("");
  }

  function rgb2hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hsl2rgb(v) {
    var h = v[0], s = v[1], l = v[2];
    if (!s) { var g = l * 255; return [g, g, g]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function hue(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  function lum(c) {
    var a = c.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrast(a, b) {
    var la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* The palette a brand colour turns into. The ring keeps the brand hue at full strength so
   * the coin is recognisable at a glance. The ink is the same hue driven down until it clears
   * minContrast against the field, because several of these brands are yellow or orange and a
   * yellow module on a white field is not a QR code, it is a rumour. */
  function palette(brand, minContrast) {
    var base = hex2rgb(brand);
    var field = mix([255, 255, 255], base, 0.035);   // a whisper of brand in the paper
    var hsl = rgb2hsl(base);
    var ink = null;
    for (var l = Math.min(hsl[2], 0.3); l >= 0.05; l -= 0.01) {
      var cand = hsl2rgb([hsl[0], Math.min(hsl[1], 0.9), l]);
      if (contrast(cand, field) >= minContrast) { ink = cand; break; }
    }
    if (!ink) ink = [17, 17, 20];
    return {
      brand: rgb2hex(base),
      field: rgb2hex(field),
      fieldEdge: rgb2hex(mix([255, 255, 255], base, 0.10)),
      ink: rgb2hex(ink),
      inkSoft: rgb2hex(mix(ink, base, 0.22)),
      contrast: contrast(ink, field)
    };
  }

  /* -------------------------------------------------------------------- encode */

  function encoder(opts) {
    var e = (opts && opts.encoder) || (typeof self !== "undefined" && self.qrcode);
    if (!e) throw new Error("qr-art: no QR encoder. Load qrcode.js first.");
    return e;
  }

  /* Encode at the first level that can carry the payload. See the note on DEFAULTS.ecl for
   * why the list starts at M rather than at the strongest level available. */
  function plan(payload, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var qrcode = encoder(opts);
    var levels = [].concat(opts.ecl);
    for (var i = 0; i < levels.length; i++) {
      try {
        var q = qrcode(0, levels[i]);
        q.addData(payload);            // auto mode, exactly as the master page calls it
        q.make();
        var n = q.getModuleCount();
        return { ecl: levels[i], n: n, version: (n - 17) / 4, qr: q };
      } catch (err) { /* too long for this level; drop to the next */ }
    }
    throw new Error("qr-art: this payload will not encode at " + levels.join(" or ") + ".");
  }

  /* ------------------------------------------------------------------ geometry */

  /* The circle has to hold the code AND its quiet zone, corners included, or a decoder
   * reading the diagonal finds ring where it expects light. So the light disc circumscribes
   * the margin square: radius = (side + 2 * quiet) / 2 * sqrt(2) in module units. That is
   * what keeps the code to roughly 58 per cent of the coin's width, and it is not slack to
   * be reclaimed.
   *
   * Everything below is in DEVICE pixels, and every module edge is snapped to a whole one by
   * grid(). That snapping is not tidiness. Left fractional, module boundaries drift in and
   * out of phase with the pixel lattice and paint half-lit rows that a binariser reads as
   * neither dark nor light: measured, the failure came and went with size rather than
   * shrinking steadily with it, which is the signature of aliasing. Snapped, the boundaries
   * are exact at every size and the decode is stable. A module may vary by one pixel against
   * its neighbour, which is a smaller variation than any printed code carries. */
  function coinGeometry(n, size, opts) {
    var R = size / 2;
    var ring = Math.max(3, R * opts.ringWidth);
    var Rd = R - ring;                                  // radius of the light field
    var unitsAcross = (n + 2 * opts.quiet) * Math.SQRT2; // module units spanning the diameter
    var m = (2 * Rd) / unitsAcross;                      // one module, in pixels
    var S = m * n;
    var x0 = R - S / 2, y0 = R - S / 2;
    return {
      R: R, ring: ring, Rd: Rd, m: m, S: S, x0: x0, y0: y0,
      gx: function (c) { return Math.round(x0 + c * m); },
      gy: function (r) { return Math.round(y0 + r * m); }
    };
  }

  /* ------------------------------------------------------------------- drawing */

  function rrect(g, x, y, w, h, r) {
    var tl = r[0], tr = r[1], br = r[2], bl = r[3];
    g.beginPath();
    g.moveTo(x + tl, y);
    g.lineTo(x + w - tr, y);
    if (tr) g.arcTo(x + w, y, x + w, y + tr, tr);
    g.lineTo(x + w, y + h - br);
    if (br) g.arcTo(x + w, y + h, x + w - br, y + h, br);
    g.lineTo(x + bl, y + h);
    if (bl) g.arcTo(x, y + h, x, y + h - bl, bl);
    g.lineTo(x, y + tl);
    if (tl) g.arcTo(x, y, x + tl, y, tl);
    g.closePath();
  }

  function inFinder(n, r, c) {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  /* One module, snapped to the pixel grid. Its corners round only where BOTH touching sides
   * are light, so a lone module is a circle, a run is a capsule and a block is a rounded
   * slab. Ink is only ever removed from an outer corner, never from the centre, which is
   * where a decoder samples. */
  function blob(g, dark, n, r, c, geo, dot) {
    var up = r > 0 && dark(r - 1, c), dn = r < n - 1 && dark(r + 1, c);
    var lf = c > 0 && dark(r, c - 1), rt = c < n - 1 && dark(r, c + 1);
    var x = geo.gx(c), y = geo.gy(r), w = geo.gx(c + 1) - x, h = geo.gy(r + 1) - y;
    var rad = Math.min(w, h) * dot;
    rrect(g, x, y, w, h, [
      (!up && !lf) ? rad : 0,
      (!up && !rt) ? rad : 0,
      (!dn && !rt) ? rad : 0,
      (!dn && !lf) ? rad : 0
    ]);
    g.fill();
  }

  /* A finder pattern, as a ringed eye. The 7 / 5 / 3 concentric structure is kept exactly, so
   * a scan line through the centre still reads the 1:1:3:1:1 ratio a decoder looks for, and
   * every edge lands on the same snapped grid as the modules so the ratio survives at any
   * size. That ratio is asserted from the painted pixels in test/verify.mjs, not assumed.
   *
   * The radii are deliberately modest. A finder is a function pattern: unlike the data it
   * carries no error correction, so a decoder that cannot see it does not recover, it simply
   * never finds the code. Measured against the matrix in Chrome, an outer radius of 2 modules
   * softened away twelve finder modules; 1.5 halves that to the two extreme diagonal corners
   * of each eye, which is what a rounded eye is, and the eye still reads as rounded. The
   * remaining margin is the tap-for-a-plain-code fallback. */
  var EYE_OUTER = 1.5, EYE_INNER = 1.2;

  /* The pupil covers the finder's 3x3 dark centre, and it is a rounded square rather than a
   * circle for a reason worth keeping. A circle has to satisfy two bounds that a 3x3 square
   * does not put in the same place: it must reach the four corner module centres, 1.414
   * modules out, and its width through the middle must stay three modules so the decoder's
   * 1:1:3:1:1 run still measures 3. A radius of 1.5 satisfies both by a twentieth of a module,
   * which is under a pixel once the grid is snapped, and duly flipped those corners light on
   * ten of the thirteen codes; opening it to 1.68 fixed the corners and stretched the middle
   * run to 3.8, breaking the ratio instead. A rounded square has no such conflict: three
   * modules across whichever way it is measured, with a quarter of a module of margin at the
   * corners. Softer than a hard square, and it agrees with the rounded ring around it. */
  var EYE_PUPIL_R = 1.0;

  function eye(g, geo, row, col, pal) {
    var x = geo.gx(col), y = geo.gy(row);
    var x7 = geo.gx(col + 7), y7 = geo.gy(row + 7);
    var x1 = geo.gx(col + 1), y1 = geo.gy(row + 1);
    var x6 = geo.gx(col + 6), y6 = geo.gy(row + 6);
    var x2 = geo.gx(col + 2), y2 = geo.gy(row + 2);
    var x5 = geo.gx(col + 5), y5 = geo.gy(row + 5);
    var m = geo.m;

    var ro = EYE_OUTER * m, ri = EYE_INNER * m, rp = EYE_PUPIL_R * m;
    g.fillStyle = pal.ink;
    rrect(g, x, y, x7 - x, y7 - y, [ro, ro, ro, ro]); g.fill();
    g.fillStyle = pal.field;
    rrect(g, x1, y1, x6 - x1, y6 - y1, [ri, ri, ri, ri]); g.fill();
    g.fillStyle = pal.ink;
    rrect(g, x2, y2, x5 - x2, y5 - y2, [rp, rp, rp, rp]); g.fill();
  }

  function drawCoin(g, p, size, pal, opts) {
    var n = p.n, geo = coinGeometry(n, size, opts), R = geo.R, m = geo.m;
    var dark = function (r, c) { return p.qr.isDark(r, c); };

    // The ring: brand at full strength, with a sweep of light across it.
    var lg = g.createLinearGradient(0, 0, size, size);
    lg.addColorStop(0, pal.brand);
    lg.addColorStop(0.5, rgb2hex(mix(hex2rgb(pal.brand), [255, 255, 255], 0.35)));
    lg.addColorStop(1, pal.brand);
    g.fillStyle = opts.sheen ? lg : pal.brand;
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.fill();

    // Coin milling: short ticks around the edge, entirely inside the ring band.
    if (opts.milled) {
      g.save();
      g.strokeStyle = "rgba(0,0,0,0.22)";
      g.lineWidth = Math.max(1, geo.ring * 0.16);
      var ticks = 72;
      for (var t = 0; t < ticks; t++) {
        var a = (t / ticks) * Math.PI * 2;
        g.beginPath();
        g.moveTo(R + Math.cos(a) * (R - geo.ring * 0.12), R + Math.sin(a) * (R - geo.ring * 0.12));
        g.lineTo(R + Math.cos(a) * (R - geo.ring * 0.62), R + Math.sin(a) * (R - geo.ring * 0.62));
        g.stroke();
      }
      g.restore();
    }

    // The field. A radial wash, light everywhere: the darkest point still clears the
    // contrast check because palette() measured the ink against the flat field colour and
    // fieldEdge is only a shade off it.
    var rg = g.createRadialGradient(R, R * 0.86, geo.Rd * 0.15, R, R, geo.Rd);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(1, pal.fieldEdge);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(R, R, geo.Rd, 0, Math.PI * 2);
    g.fill();

    // A hairline where field meets ring, so the two never bleed into one another.
    g.strokeStyle = "rgba(0,0,0,0.10)";
    g.lineWidth = Math.max(1, m * 0.18);
    g.beginPath();
    g.arc(R, R, geo.Rd, 0, Math.PI * 2);
    g.stroke();

    drawModules(g, p, geo, pal, opts);
  }

  function drawModules(g, p, geo, pal, opts) {
    var n = p.n;
    var dark = function (r, c) { return p.qr.isDark(r, c); };

    g.fillStyle = pal.ink;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!dark(r, c) || inFinder(n, r, c)) continue;
        blob(g, dark, n, r, c, geo, opts.dot);
      }
    }
    eye(g, geo, 0, 0, pal);
    eye(g, geo, 0, n - 7, pal);
    eye(g, geo, n - 7, 0, pal);
  }

  /* The escape hatch: an ordinary code, square modules, black on white, no frame. Every
   * decoder on earth reads this. Tapping the coin switches to it. Snapped on the same
   * principle as the coin. */
  function drawPlain(g, p, size, opts) {
    var n = p.n, cells = n + 2 * opts.quiet, m = size / cells;
    var gx = function (i) { return Math.round((i + opts.quiet) * m); };
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size, size);
    g.fillStyle = "#111111";
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n; c++)
        if (p.qr.isDark(r, c))
          g.fillRect(gx(c), gx(r), gx(c + 1) - gx(c), gx(r + 1) - gx(r));
  }

  /* ---------------------------------------------------------------------- draw */

  /* canvas may be a browser HTMLCanvasElement or any object with width, height and
   * getContext("2d"). The test drives the very bytes this ships with, through
   * @napi-rs/canvas, so there is one renderer and no second implementation to drift.
   *
   * Drawing happens entirely in DEVICE pixels: no ctx.scale, because scaling reintroduces
   * exactly the fractional module boundaries the snapping exists to remove. The backing
   * store never drops below minDevice, so a coin shown small on the page is still drawn from
   * a buffer coarse enough to decode, and the browser does the downscale. */
  function draw(canvas, payload, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var cssSize = Math.max(64, Math.round(opts.size || 512));
    var dpr = opts.pixelRatio || 1;
    var p = plan(payload, opts);
    var pal = palette(opts.brand || "#5a5a5a", opts.minContrast);

    /* How big the code will actually be on the glass, which is the number a camera cares
     * about. The backing store may be larger than this, and a large buffer shown small proves
     * nothing: what the lens sees is the displayed size. Below the measured safe size the
     * coin is not drawn at all and the plain code goes out instead, because a code that
     * cannot be scanned is not a design decision, it is a broken page. */
    var physical = Math.round(cssSize * dpr);
    var fellBack = !opts.plain && physical < opts.safePhysicalPx;
    var plainNow = opts.plain || fellBack;

    var device = Math.max(minDeviceFor(p.n, opts), physical);
    canvas.width = device;
    canvas.height = device;
    var g = canvas.getContext("2d");
    g.clearRect(0, 0, device, device);
    if (plainNow) drawPlain(g, p, device, opts);
    else drawCoin(g, p, device, pal, opts);

    var geo = coinGeometry(p.n, device, opts);
    return {
      ecl: p.ecl, version: p.version, modules: p.n,
      plain: plainNow, fellBack: fellBack,
      modulePxDevice: plainNow ? device / (p.n + 2 * opts.quiet) : geo.m,
      modulePxPhysical: (plainNow ? device / (p.n + 2 * opts.quiet) : geo.m) * (physical / device),
      contrast: pal.contrast, palette: pal,
      cssSize: cssSize, physicalSize: physical, deviceSize: device, pixelRatio: dpr
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    draw: draw,
    plan: plan,
    palette: palette,
    coinGeometry: coinGeometry,
    minDeviceFor: minDeviceFor,
    /* The page tints itself from the same brand colour the coin uses, so the two can never
     * drift. One set of colour helpers, exported rather than copied. */
    colour: {
      hex2rgb: hex2rgb, rgb2hex: rgb2hex, rgb2hsl: rgb2hsl, hsl2rgb: hsl2rgb,
      lum: lum, contrast: contrast, mix: mix
    },
    contrast: contrast,
    hex2rgb: hex2rgb
  };
})();
