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

  // The system stack, so the rim legend needs no font file and no licence.
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
    ringWidth: 0.082,    // the lettered band, as a fraction of the coin radius
    scallop: 0.055,      // depth of the scalloped edge, as a fraction of the radius. 0 is round.
    legend: true,        // strike the provider's name around the rim
    depth: true,         // run the ink as a gradient from the middle outwards
    sheen: true,         // a light sweep across the body
    label: "",           // what the legend reads
    seed: "",            // decides the lobe count and phase. The provider key.
    minContrast: 8,      // ink against field. WCAG's ceiling is 21; 8 is comfortably safe.
    minModulePx: 6,      // floor on a module, in device pixels, in the backing store
    /* The smallest the coin may be PHYSICALLY DRAWN and still be trusted to scan. Measured,
     * not chosen: decoding every payload at descending sizes, the worst code in the book
     * stopped reading below 370 physical pixels, so this is that with half again on top.
     * Below it the app draws the plain code instead, which reads down to 230. The two numbers
     * are re-measured by test/verify.mjs on every run, so this one cannot quietly go stale. */
    safePhysicalPx: 560,
    plain: false,        // true draws an ordinary square code on a white square
    /* DECORATIVE: draw the coin at any size, as an icon, and do not fall back to the plain
     * code when it is too small to scan.
     *
     * This is the one door out of the safe-size rule and it exists for exactly one caller: the
     * thumbnail on an account tile, which is 38 pixels across and is a picture of a coin
     * rather than a code anybody could point a camera at. It also drops the rim legend, which
     * at that size is mush. Never pass it for anything a person might actually scan; the suite
     * asserts that the code view does not. */
    decorative: false
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

    function darkestAt(cap) {
      for (var l = Math.min(hsl[2], cap); l >= 0.04; l -= 0.01) {
        var cand = hsl2rgb([hsl[0], Math.min(hsl[1], 0.9), l]);
        if (contrast(cand, field) >= minContrast) return cand;
      }
      return null;
    }
    var ink = darkestAt(0.30) || [17, 17, 20];
    /* The ink runs as a gradient from the middle of the code outwards, which is what gives the
     * modules their depth. Both ends are checked against the field, not just the lighter one:
     * a gradient is only decorative if every point of it still reads as dark. */
    var inkEdge = hsl2rgb([hsl[0], Math.min(hsl[1], 0.95), Math.max(0.05, rgb2hsl(ink)[2] * 0.62)]);
    if (contrast(inkEdge, field) < minContrast) inkEdge = ink;

    // Rim lettering sits on the brand ring, so it takes whichever of white or near-black
    // reads against that colour rather than assuming the brand is dark.
    var onBrandWhite = contrast([255, 255, 255], base);
    var onBrandDark = contrast([26, 22, 18], base);

    /* The reverse face is metal rather than paper, so its lettering is measured against the
     * metal. Embossing supplies the edges; the fill still has to carry the reading, so it is
     * pushed away from the face until it clears 3.5:1, in whichever direction has room. */
    /* 4.5:1, the same bar as body text, because this is a number somebody has to read off a
     * phone and then type into a banking app. The embossing supplies edges, not legibility.
     * Whichever direction has room wins: a deep navy brand cannot go darker usefully, so its
     * lettering goes light instead. */
    var faceMid = mix(base, [0, 0, 0], 0.10);
    var faceInk = null;
    for (var t = 0.35; t <= 0.95; t += 0.02) {
      var darker = mix(base, [0, 0, 0], t);
      if (contrast(darker, faceMid) >= 4.5) { faceInk = darker; break; }
    }
    if (!faceInk) {
      for (var u = 0.35; u <= 0.97; u += 0.02) {
        var lighter = mix(base, [255, 255, 255], u);
        if (contrast(lighter, faceMid) >= 4.5) { faceInk = lighter; break; }
      }
    }
    if (!faceInk) faceInk = [12, 12, 14];

    return {
      brand: rgb2hex(base),
      brandLift: rgb2hex(mix(base, [255, 255, 255], 0.34)),
      brandSink: rgb2hex(mix(base, [0, 0, 0], 0.30)),
      field: rgb2hex(field),
      fieldEdge: rgb2hex(mix([255, 255, 255], base, 0.10)),
      ink: rgb2hex(ink),
      inkEdge: rgb2hex(inkEdge),
      inkSoft: rgb2hex(mix(ink, base, 0.22)),
      rimInk: onBrandWhite >= onBrandDark ? "rgba(255,255,255,0.92)" : "rgba(24,20,16,0.78)",
      faceInk: rgb2hex(faceInk),
      faceDim: rgb2hex(mix(faceInk, base, 0.42)),
      faceContrast: contrast(faceInk, faceMid),
      contrast: Math.min(contrast(ink, field), contrast(inkEdge, field))
    };
  }

  /* A small stable hash, so each provider's coin gets its own edge without anything being
   * stored per provider. Same key, same coin, on every device and for ever. */
  function seedOf(s) {
    var h = 2166136261;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  /* -------------------------------------------------------------------- encode */

  function encoder(opts) {
    var e = (opts && opts.encoder) || (typeof self !== "undefined" && self.qrcode);
    if (!e) throw new Error("qr-art: no QR encoder. Load qrcode.js first.");
    return e;
  }

  /* Encode at the first level that can carry the payload. See the note on DEFAULTS.ecl for
   * why the list starts at M rather than at the strongest level available.
   *
   * CACHED, because encoding is the expensive half of drawing a coin and none of it depends on
   * how the coin will look. Measured in Chrome: 4.8ms to encode against 2ms to draw, so it was
   * seventy per cent of a full-size render and effectively the whole cost of a thumbnail, paid
   * again on every redraw, every step between accounts and every resize. The matrix is a pure
   * function of the payload and the level, and it is only ever read, so one per account for the
   * life of the page is both correct and the entire saving. */
  var PLANS = {};
  function plan(payload, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var levels = [].concat(opts.ecl);
    var key = levels.join(",") + " " + payload;
    if (PLANS[key]) return PLANS[key];

    var qrcode = encoder(opts);
    for (var i = 0; i < levels.length; i++) {
      try {
        var q = qrcode(0, levels[i]);
        q.addData(payload);            // auto mode, exactly as the master page calls it
        q.make();
        var n = q.getModuleCount();
        PLANS[key] = { ecl: levels[i], n: n, version: (n - 17) / 4, qr: q };
        return PLANS[key];
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
  /* The parts of the coin that do not depend on how many modules the code has: the silhouette,
   * the lettered band and the face inside it. Both faces are struck from this same frame, which
   * is what makes the flip read as one object turning over rather than two pictures. */
  function coinFrame(size, opts) {
    var R = size / 2;                                    // the furthest a scallop tip reaches
    var Rbase = R * (1 - opts.scallop);                  // the circle the scallops sit on
    var ring = Math.max(4, R * opts.ringWidth);          // the lettered band
    return { R: R, Rbase: Rbase, ring: ring, Rd: Rbase - ring };
  }

  function coinGeometry(n, size, opts) {
    var f = coinFrame(size, opts);
    var R = f.R, Rbase = f.Rbase, ring = f.ring;
    var Rd = f.Rd;                                       // radius of the light field
    var unitsAcross = (n + 2 * opts.quiet) * Math.SQRT2; // module units spanning the diameter
    var m = (2 * Rd) / unitsAcross;                      // one module, in pixels
    var S = m * n;
    var x0 = R - S / 2, y0 = R - S / 2;
    return {
      R: R, Rbase: Rbase, ring: ring, Rd: Rd, m: m, S: S, x0: x0, y0: y0,
      gx: function (c) { return Math.round(x0 + c * m); },
      gy: function (r) { return Math.round(y0 + r * m); }
    };
  }

  /* ------------------------------------------------------------------- drawing */

  /* ONE FILL PER MODULE, and it must stay that way.
   *
   * The obvious optimisation is to accumulate every module into a single Path2D and fill once,
   * on the reasoning that fifteen hundred fills must cost more than one. It was tried and
   * measured, and it is fourteen times SLOWER: 25.8ms against 1.84ms for the same 1,172
   * modules in the same browser. A fill is charged by the bounding box of its path, so one
   * path spanning the whole 686px code makes the rasteriser walk every scanline of the whole
   * box and sort an edge list of thousands, where each small fill touches only its own nine
   * pixels. Batching turned a 6ms draw into 17ms and was the cause of visible jitter when
   * stepping between accounts. Do not do it again. */
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

  function fillRRect(g, x, y, w, h, r) {
    rrect(g, x, y, w, h, [r, r, r, r]);
    g.fill();
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

  function eye(g, geo, row, col, pal, inkStyle) {
    var x = geo.gx(col), y = geo.gy(row);
    var x7 = geo.gx(col + 7), y7 = geo.gy(row + 7);
    var x1 = geo.gx(col + 1), y1 = geo.gy(row + 1);
    var x6 = geo.gx(col + 6), y6 = geo.gy(row + 6);
    var x2 = geo.gx(col + 2), y2 = geo.gy(row + 2);
    var x5 = geo.gx(col + 5), y5 = geo.gy(row + 5);
    var m = geo.m;

    var ro = EYE_OUTER * m, ri = EYE_INNER * m, rp = EYE_PUPIL_R * m;
    var ink = inkStyle || pal.ink;
    // Three fills, and they must stay three: the light ring between them is painted over the
    // dark block, so they cannot be batched into one path.
    g.fillStyle = ink;   fillRRect(g, x, y, x7 - x, y7 - y, ro);
    g.fillStyle = pal.field; fillRRect(g, x1, y1, x6 - x1, y6 - y1, ri);
    g.fillStyle = ink;   fillRRect(g, x2, y2, x5 - x2, y5 - y2, rp);
  }

  /* The scalloped silhouette. The radius wobbles between Rbase and R on a raised cosine, so
   * the edge is a smooth flower rather than a saw. Everything about it is decoration: it lives
   * entirely outside the light field, so it cannot touch the quiet zone however deep the
   * lobes go. Lobe count and phase come from a hash of the provider key, which gives each
   * coin its own outline for nothing and keeps it identical on every device for ever. */
  function scallopPath(g, cx, cy, rBase, rTip, lobes, phase) {
    var steps = Math.max(240, lobes * 26);
    g.beginPath();
    for (var i = 0; i <= steps; i++) {
      var a = (i / steps) * Math.PI * 2;
      var r = rBase + (rTip - rBase) * (0.5 + 0.5 * Math.cos(lobes * a + phase));
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  /* The provider's name struck around the rim, the way a coin carries its legend. Repeated
   * with a diamond between each pass until it closes the circle. Outside the quiet zone, so
   * it costs the code nothing. */
  function rimLegend(g, cx, cy, radius, label, pal, px) {
    var text = String(label || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!text) return;
    g.save();
    g.fillStyle = pal.rimInk;
    g.font = "700 " + px.toFixed(1) + "px " + FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";

    var tracking = px * 0.34;
    function widthOf(s) {
      var w = 0;
      for (var i = 0; i < s.length; i++) w += g.measureText(s[i]).width + tracking;
      return w;
    }
    // A middle dot rather than anything decorative: it is in every system font, and a glyph
    // the device does not have is struck around the rim as a tofu box.
    var unit = text + "  ·  ";
    var uw = widthOf(unit);
    if (uw <= 0) { g.restore(); return; }
    var circumference = 2 * Math.PI * radius;
    var reps = Math.max(1, Math.round(circumference / uw));
    var full = "";
    for (var k = 0; k < reps; k++) full += unit;

    var scale = circumference / widthOf(full);
    var angle = -Math.PI / 2;
    for (var i2 = 0; i2 < full.length; i2++) {
      var ch = full[i2];
      var w = (g.measureText(ch).width + tracking) * scale;
      var step = w / radius;
      g.save();
      g.translate(cx, cy);
      g.rotate(angle + step / 2);
      g.translate(0, -radius);
      g.fillText(ch, 0, 0);
      g.restore();
      angle += step;
    }
    g.restore();
  }

  function drawCoin(g, p, size, pal, opts) {
    var n = p.n, geo = coinGeometry(n, size, opts), R = geo.R, m = geo.m;
    var seed = seedOf(opts.seed || opts.label || "");
    var lobes = 11 + (seed % 9);                       // 11 to 19, per provider
    var phase = ((seed >>> 4) % 360) * Math.PI / 180;

    // The body: brand at full strength with a light sweeping across it.
    var lg = g.createLinearGradient(0, 0, size, size);
    lg.addColorStop(0, pal.brandSink);
    lg.addColorStop(0.42, pal.brandLift);
    lg.addColorStop(0.62, pal.brand);
    lg.addColorStop(1, pal.brandSink);
    g.fillStyle = opts.sheen ? lg : pal.brand;
    if (opts.scallop > 0) scallopPath(g, R, R, geo.Rbase, R, lobes, phase);
    else { g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); }
    g.fill();

    // The legend, struck into the middle of the ring band.
    if (opts.legend) rimLegend(g, R, R, geo.Rd + geo.ring * 0.52, opts.label, pal, geo.ring * 0.46);

    // Two struck hairlines, the bezel, sitting either side of the legend.
    g.strokeStyle = "rgba(0,0,0,0.20)";
    g.lineWidth = Math.max(1, geo.ring * 0.055);
    g.beginPath(); g.arc(R, R, geo.Rbase - geo.ring * 0.10, 0, Math.PI * 2); g.stroke();

    /* The field is FLAT, and deliberately so on two counts.
     *
     * It is the largest single area of the coin, and a smooth gradient across it is the most
     * expensive thing a PNG can be asked to store: every row differs slightly, so the format's
     * filters find nothing to fold away. Measured, a washed field roughly doubled the size of
     * the image saved to the gallery, for a wash nobody can see at arm's length.
     *
     * It is also the safer of the two for scanning. palette() measures the ink's contrast
     * against one field colour; with a wash, part of the field is lighter than the number that
     * was checked and part is darker. Flat, the measured contrast is the contrast everywhere. */
    g.fillStyle = pal.field;
    g.beginPath();
    g.arc(R, R, geo.Rd, 0, Math.PI * 2);
    g.fill();

    // A hairline where field meets ring, so the two never bleed into one another.
    g.strokeStyle = "rgba(0,0,0,0.12)";
    g.lineWidth = Math.max(1, m * 0.18);
    g.beginPath();
    g.arc(R, R, geo.Rd, 0, Math.PI * 2);
    g.stroke();

    /* The ink, as a gradient from the middle of the code outwards. Both stops were checked
     * against the field in palette(), so every module is at or above the contrast floor
     * wherever it happens to sit. */
    var ig = g.createRadialGradient(R, R, geo.S * 0.06, R, R, geo.S * 0.78);
    ig.addColorStop(0, pal.ink);
    ig.addColorStop(1, pal.inkEdge);
    drawModules(g, p, geo, pal, opts, opts.depth ? ig : pal.ink);
  }

  function drawModules(g, p, geo, pal, opts, inkStyle) {
    var n = p.n;
    var dark = function (r, c) { return p.qr.isDark(r, c); };
    var ink = inkStyle || pal.ink;

    g.fillStyle = ink;
    /* A thumbnail is 36 pixels across, which puts a module at about one pixel. Rounded corners
     * on a one-pixel square are not a shape, they are noise, and each one costs a path and a
     * fill. Plain rects there are visually identical and several times faster, which is what
     * lets all thirteen be drawn in one go at startup rather than trickling in one at a time
     * like a download. */
    if (opts.decorative) {
      for (var dr = 0; dr < n; dr++) {
        for (var dc = 0; dc < n; dc++) {
          if (!dark(dr, dc) || inFinder(n, dr, dc)) continue;
          var bx = geo.gx(dc), by = geo.gy(dr);
          g.fillRect(bx, by, geo.gx(dc + 1) - bx, geo.gy(dr + 1) - by);
        }
      }
    } else {
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (!dark(r, c) || inFinder(n, r, c)) continue;
          blob(g, dark, n, r, c, geo, opts.dot);
        }
      }
    }
    eye(g, geo, 0, 0, pal, ink);
    eye(g, geo, 0, n - 7, pal, ink);
    eye(g, geo, n - 7, 0, pal, ink);
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
    var fellBack = !opts.plain && !opts.decorative && physical < opts.safePhysicalPx;
    var plainNow = opts.plain || fellBack;
    if (opts.decorative) opts = Object.assign({}, opts, { legend: false });

    var device = opts.decorative ? physical : Math.max(minDeviceFor(p.n, opts), physical);
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

  /* ------------------------------------------------------------- the reverse */

  /* The other face of the coin: solid struck metal, with the DuitNow name and the account
   * number embossed into it.
   *
   * There is no QR here, so nothing needs a light field or a quiet zone, and the face can be
   * the brand metal itself rather than paper. That is what makes it read as the back of the
   * same object: identical silhouette, identical rim, and a surface you could only get by
   * turning it over.
   *
   * "DuitNow" is set as a WORDMARK, not as the official logo. The master carries no DuitNow
   * artwork, and drawing a trademark from memory would get it subtly wrong; a clean wordmark
   * says the same thing honestly. Drop the official asset into the master and this is the one
   * function that needs to change. */
  /* The official mark, filled from its own path data at its own aspect ratio. No outline, no
   * shadow, no rotation, no stretch: the scale is uniform and the colour is one of the two the
   * pack ships. Everything here is deliberately dull, because the guidelines leave no room for
   * anything else. */
  function mark_clearRatio(mark) {
    // 1.5X, where X is the height of the letter D in the logotype. Measured from the official
    // artwork when the mark was vendored, not estimated here.
    return (mark && mark.clearRatio) || 0.249;
  }

  function drawMark(g, mark, x, y, w, h) {
    var P = (typeof Path2D !== "undefined") ? Path2D
          : (typeof self !== "undefined" && self.Path2D) ? self.Path2D : null;
    if (!P) return false;
    var sx = w / (mark.viewBox[2] - mark.viewBox[0]);
    var sy = h / (mark.viewBox[3] - mark.viewBox[1]);
    g.save();
    g.translate(x, y);
    g.scale(sx, sy);
    g.translate(-mark.viewBox[0], -mark.viewBox[1]);
    // Each path in the colour the official file gives it, in the order it gives them: white
    // container first, then the ruby logomark, then the black logotype over the top.
    for (var i = 0; i < mark.paths.length; i++) {
      g.fillStyle = mark.paths[i].fill;
      g.fill(new P(mark.paths[i].d));
    }
    g.restore();
    return true;
  }

  function emboss(g, text, cx, cy, px, weight, ink, depth) {
    g.font = weight + " " + px.toFixed(1) + "px " + FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    var d = Math.max(1, px * (depth || 0.055));
    // The struck look is three passes: the shadow the light does not reach, the highlight on
    // the raised edge, then the face of the letter itself.
    g.fillStyle = "rgba(0,0,0,0.42)";
    g.fillText(text, cx + d, cy + d);
    g.fillStyle = "rgba(255,255,255,0.42)";
    g.fillText(text, cx - d * 0.85, cy - d * 0.85);
    g.fillStyle = ink;
    g.fillText(text, cx, cy);
  }

  function drawBack(canvas, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var cssSize = Math.max(64, Math.round(opts.size || 512));
    var dpr = opts.pixelRatio || 1;
    var size = Math.max(opts.minDevice || 0, Math.round(cssSize * dpr));

    canvas.width = size;
    canvas.height = size;
    var g = canvas.getContext("2d");
    g.clearRect(0, 0, size, size);

    var pal = palette(opts.brand || "#5a5a5a", opts.minContrast);
    var f = coinFrame(size, opts);
    var R = f.R;
    var seed = seedOf(opts.seed || opts.label || "");
    var lobes = 11 + (seed % 9);
    var phase = ((seed >>> 4) % 360) * Math.PI / 180;

    // The body, struck from the same die as the front.
    var lg = g.createLinearGradient(0, 0, size, size);
    lg.addColorStop(0, pal.brandSink);
    lg.addColorStop(0.42, pal.brandLift);
    lg.addColorStop(0.62, pal.brand);
    lg.addColorStop(1, pal.brandSink);
    g.fillStyle = opts.sheen ? lg : pal.brand;
    if (opts.scallop > 0) scallopPath(g, R, R, f.Rbase, R, lobes, phase);
    else { g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); }
    g.fill();

    if (opts.legend) rimLegend(g, R, R, f.Rd + f.ring * 0.52, opts.label, pal, f.ring * 0.46);

    g.strokeStyle = "rgba(0,0,0,0.20)";
    g.lineWidth = Math.max(1, f.ring * 0.055);
    g.beginPath(); g.arc(R, R, f.Rbase - f.ring * 0.10, 0, Math.PI * 2); g.stroke();

    // The inner face: the same metal, dished, so the embossing has something to sit in.
    var rg = g.createRadialGradient(R, R * 0.82, f.Rd * 0.1, R, R, f.Rd);
    rg.addColorStop(0, pal.brandLift);
    rg.addColorStop(1, pal.brandSink);
    g.fillStyle = rg;
    g.beginPath(); g.arc(R, R, f.Rd, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.16)";
    g.lineWidth = Math.max(1, f.Rd * 0.008);
    g.beginPath(); g.arc(R, R, f.Rd, 0, Math.PI * 2); g.stroke();

    var acct = String(opts.acct || "").trim();
    var D = f.Rd * 2;

    /* THE OFFICIAL MARK, and everything about how it is drawn is a rule rather than a choice.
     *
     * It is filled flat, in one of its own two monochrome colours, at its own aspect ratio,
     * with 1.5X of clear space kept empty beneath it. It is NOT embossed and carries no shadow,
     * outline or holding shape, all of which the brand guidelines forbid in as many words. The
     * account number below IS embossed, because that is our own typography and ours to treat.
     *
     * Black or white is chosen by measuring against the face, which is what "use for high
     * contrast application" asks for: the face is a different brand colour for every account,
     * gold for one and navy for the next, and a fixed choice would be illegible on half of them.
     * Choosing between two official variants is not "changing the colour of the logo".
     *
     * Below the minimum size the mark is omitted rather than shrunk, because 40 pixels is a
     * floor in the guidelines and a mark too small to read is worse than none. */
    /* There is no colour decision to make here, and that is exactly why the container is the
     * right asset. Inside it the logo sits on its own white, which is a sanctioned combination
     * whatever the coin's metal happens to be, and the only thing touching the account's colour
     * is PayNet's own shape. Below the minimum width the graphic is omitted rather than shrunk,
     * because the minimum is a rule and a mark too small to read is worse than none. */
    var mark = (typeof self !== "undefined" && self.DuitNowMark) || null;
    var markH = 0, markW = 0;
    if (mark) {
      markH = D * 0.25;
      markW = markH * mark.aspect;
      if (markW * (cssSize / size) < mark.minWidthPx) { markH = 0; markW = 0; }
    }

    /* The number, laid out to be read.
     *
     * One line if it nearly fits, because a number in one piece is easier to check against a
     * banking app than one in two. If it must break, it breaks at the MOST BALANCED point
     * rather than in the middle of the group list: splitting by group count left a single
     * orphan digit on the second line for five of the thirteen, which looks like a mistake.
     * Balance is measured in rendered width, not in characters, and a tie keeps more on the
     * first line. */
    var groups = acct.split(/\s+/).filter(Boolean);
    var base = D * 0.17;
    g.font = "700 " + base + "px " + FONT;
    var room = D * 0.78;
    var oneLine = g.measureText(acct).width;

    var lines, px;
    if (groups.length < 2 || oneLine <= room) {
      lines = [acct];
      px = base * Math.min(1, room / oneLine);
    } else {
      var bestK = 1, bestGap = Infinity, bestWide = Infinity;
      for (var k = 1; k < groups.length; k++) {
        var w1 = g.measureText(groups.slice(0, k).join(" ")).width;
        var w2 = g.measureText(groups.slice(k).join(" ")).width;
        var gap = Math.abs(w1 - w2), wide = Math.max(w1, w2);
        if (gap < bestGap - 0.5 || (Math.abs(gap - bestGap) <= 0.5 && w1 > w2)) {
          bestGap = gap; bestK = k; bestWide = wide;
        }
      }
      lines = [groups.slice(0, bestK).join(" "), groups.slice(bestK).join(" ")];
      px = base * Math.min(1, room / bestWide);
    }
    var widest = 0;
    g.font = "700 " + px + "px " + FONT;
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, g.measureText(lines[i]).width);
    if (widest > room) px *= room / widest;

    /* THE WHOLE STACK IS LAID OUT AT ONCE and centred in the face, rather than each piece being
     * placed from the middle and hoping. Positioned piecemeal, the caption drifted down into
     * the rim legend on every account whose number ran to two lines. Measure the block, centre
     * it, then draw: the only way the pieces cannot collide is if their heights are added up
     * before anything is committed. */
    var clear = markH * mark_clearRatio(mark);        // 1.5X, and nothing may enter it
    var capPx = D * 0.055;
    var linesH = px + (lines.length - 1) * px * 1.22;
    var gap = px * 0.62;
    var blockH = (markH ? markH + clear : 0) + linesH + gap + capPx;

    var top = R - blockH / 2;
    if (markH) {
      drawMark(g, mark, R - markW / 2, top, markW, markH);
      top += markH + clear;
    }
    for (var k = 0; k < lines.length; k++) {
      emboss(g, lines[k], R, top + px * 0.5 + k * px * 1.22, px, "700", pal.faceInk, 0.05);
    }
    top += linesH + gap;
    emboss(g, "ACCOUNT NUMBER", R, top + capPx * 0.5, capPx, "700", pal.faceDim, 0.045);

    return { size: cssSize, deviceSize: size, palette: pal, acct: acct };
  }

  /* ----------------------------------------------------------------- the card */

  /* What gets saved to the gallery. The coin, large, on a dark brand-tinted ground with the
   * provider underneath, so the picture is worth keeping and worth sending.
   *
   * It is drawn at a fixed 1400 pixels regardless of the screen, which matters more here than
   * anywhere else in this file: a saved image is scanned from somebody else's photo library,
   * often after their messaging app has recompressed it, and there is no second chance to
   * pinch and zoom. 1400 is nearly four times the measured floor. The card carries the
   * provider name only, the same as the page, and the test suite decodes it. */
  function drawCard(canvas, payload, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var W = Math.max(600, Math.round(opts.cardWidth || 1200));
    var pad = Math.round(W * 0.085);
    var coinSize = W - pad * 2;
    var titleH = Math.round(W * 0.145);
    var H = pad + coinSize + titleH;

    canvas.width = W;
    canvas.height = H;
    var g = canvas.getContext("2d");
    var pal = palette(opts.brand || "#5a5a5a", opts.minContrast);
    var base = hex2rgb(pal.brand);

    /* A FLAT ground, and that is a size decision rather than a taste one. PNG cannot compress
     * a smooth gradient: every row differs slightly, so its filters find nothing to fold away.
     * Measured on this very card, a full-bleed gradient background cost 1,244 KB against 45 KB
     * for a flat fill of the same area, on an image whose whole point is to be saved and sent.
     * The glow stays, because it is what stops the coin looking pasted on, but it is confined
     * to a disc around the coin rather than washing the whole card. */
    g.fillStyle = rgb2hex(mix([16, 15, 26], base, 0.11));
    g.fillRect(0, 0, W, H);

    var cxg = W / 2, cyg = pad + coinSize / 2, rg0 = coinSize * 0.52, rg1 = coinSize * 0.68;
    var glow = g.createRadialGradient(cxg, cyg, rg0, cxg, cyg, rg1);
    glow.addColorStop(0, "rgba(" + base.map(Math.round).join(",") + ",0.26)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cxg, cyg, rg1, 0, Math.PI * 2);
    g.fill();

    var coin = makeCanvas(canvas, 8, 8);
    var meta = draw(coin, payload, Object.assign({}, opts, {
      size: coinSize, pixelRatio: 1, minModulePx: Math.max(opts.minModulePx, 8),
    }));
    g.drawImage(coin, pad, pad, coinSize, coinSize);

    var hsl = rgb2hsl(base), soft = null;
    for (var l = Math.max(hsl[2], 0.62); l <= 0.94; l += 0.02) {
      var cand = hsl2rgb([hsl[0], Math.min(hsl[1], 0.82), l]);
      if (contrast(cand, [20, 18, 31]) >= 4.5) { soft = cand; break; }
    }
    g.fillStyle = rgb2hex(soft || [232, 236, 245]);
    g.font = "700 " + Math.round(W * 0.062) + "px " + FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(opts.label || ""), W / 2, pad + coinSize + titleH * 0.44);

    return Object.assign({}, meta, { cardWidth: W, cardHeight: H });
  }

  /* A blank canvas of the same kind as the one handed in, so the card works in a browser and
   * under the headless canvas the tests use without either being named here. */
  function makeCanvas(like, w, h) {
    if (typeof document !== "undefined" && document.createElement) {
      var el = document.createElement("canvas");
      el.width = w; el.height = h;
      return el;
    }
    var ctor = like && like.constructor;
    if (ctor) { try { return new ctor(w, h); } catch (e) { /* fall through */ } }
    throw new Error("qr-art: cannot create a working canvas here.");
  }

  return {
    DEFAULTS: DEFAULTS,
    draw: draw,
    drawBack: drawBack,
    drawCard: drawCard,
    plan: plan,
    coinFrame: coinFrame,
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
