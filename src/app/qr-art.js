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
    /* THE LENS. Light from behind the disc, bent around it. See the block above lensBehind()
     * for what is and is not allowed to touch the code.
     *
     * lensScale is the disc as a fraction of the canvas, and it is the ONLY part of this frame
     * that costs anything: the arcs, the ring and the glow were each ablated and none of them
     * moved the decode floor, while shrinking the disc moved it a great deal, because a
     * smaller disc is a smaller code. 0.78 is where the measured floor still sits under the
     * safe size with the same half-again margin the safe size was chosen for. */
    lens: true,
    lensScale: 0.78,
    lensArcs: 26,        // smeared arcs. Their count, place and sweep come from the key.
    label: "",           // what the legend reads
    seed: "",            // decides the lobe count and phase. The provider key.
    minContrast: 8,      // ink against field. WCAG's ceiling is 21; 8 is comfortably safe.
    minModulePx: 6,      // floor on a module, in device pixels, in the backing store
    /* The smallest the coin may be PHYSICALLY DRAWN and still be trusted to scan. Measured,
     * not chosen: every payload is rendered as the app renders it, DOWNSCALED to the size the
     * glass would show, and decoded. The worst code in the book stops reading below 380
     * physical pixels with the lens on, and 440 without it, so this is 380 with half again on
     * top. Below it the app draws the plain code instead, which reads down to 230.
     *
     * The downscale is the whole of the measurement. The backing store never drops below
     * minDeviceFor(), so decoding the buffer proves only that the buffer is big, and it passes
     * at every size. The suite measured the buffer for a while and so reported whatever size
     * its sweep happened to start at; it now downscales, and these numbers are that. */
    safePhysicalPx: 580,
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

  /* A stream of numbers from that hash, for the lens sky. Math.random is deliberately not used
   * anywhere in this file: an account's coin must be the same picture on every device and on
   * every redraw, or the thumbnail and the full-size render would disagree and the zoom would
   * stop being one object moving. Xorshift, seeded by the provider key, nothing stored. */
  function randOf(seed) {
    var x = (seed >>> 0) || 1;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
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

  /* ---------------------------------------------------------------------- lens */

  /* THE LENS. The disc is a mass and the light behind it is bent around it: arcs smeared into
   * rings, and at the radius where the smearing closes, the one complete Einstein ring.
   *
   * Three rules hold it up, and each is asserted.
   *
   * 1. NOTHING IS PAINTED OVER THE FIELD. Every arc, the ring and the rim glow live outside
   *    the light disc the code sits on. Measured by ablation, the whole frame costs the decode
   *    exactly nothing: stars, arcs, ring and glow were switched off one at a time and the
   *    floor did not move. What DID move it was shrinking the disc to make room, which is why
   *    lensScale is a measured number and not a taste.
   *
   * 2. THE CANVAS STAYS TRANSPARENT OUTSIDE THE ARTWORK. No opaque backdrop is painted here.
   *    The coin's shadow is cast from its alpha by `filter: drop-shadow`, so an opaque fill
   *    would put a hard square shadow behind a round object. The dark of space belongs to the
   *    page, in app.css, where it also covers the whole screen rather than one box.
   *
   * 3. THE ARCS ARE THE PROVIDER'S SIGNATURE. The scalloped outline is gone, because a lens
   *    has a smooth horizon, so the identity that outline carried moves here: how many arcs,
   *    where they fall and how far they sweep all come from a hash of the provider key. Two
   *    accounts sharing a brand colour exactly, as Boost Bank and Boost do, still get their
   *    own sky, and nothing is stored to remember it. */
  function lensBehind(g, size, coinPx, pal, opts) {
    var R = size / 2, Rc = coinPx / 2;
    var seed = seedOf(opts.seed || opts.label || "");
    var rand = randOf(seed ^ 0x2bd1);
    var lift = hex2rgb(pal.brandLift);
    var n = opts.lensArcs;

    g.save();
    g.translate(R, R);
    for (var i = 0; i < n; i++) {
      var r = Rc * (1.05 + rand() * 0.48);
      var a0 = rand() * Math.PI * 2;
      var span = 0.12 + rand() * 0.55;
      g.strokeStyle = "rgba(" + mix(lift, [255, 255, 255], rand() * 0.7).map(Math.round).join(",") +
                      "," + (0.16 + rand() * 0.5).toFixed(3) + ")";
      g.lineWidth = Math.max(1, Rc * (0.006 + rand() * 0.022));
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, 0, r, a0, a0 + span);
      g.stroke();
    }
    // The Einstein ring: the one closed circle, where the smearing completes.
    g.strokeStyle = "rgba(" + mix(lift, [255, 255, 255], 0.6).map(Math.round).join(",") + ",0.55)";
    g.lineWidth = Math.max(1, Rc * 0.012);
    g.beginPath();
    g.arc(0, 0, Rc * 1.035, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /* The lit horizon, laid over the coin's own ring band and stopping short of the field. It is
   * a `screen` blend so it brightens the band without touching what is under the code. */
  function lensRim(g, size, coinPx, geo, pal) {
    var R = size / 2, Rc = coinPx / 2;
    var lift = hex2rgb(pal.brandLift);
    g.save();
    g.globalCompositeOperation = "screen";
    var rim = g.createRadialGradient(R, R, Rc * 0.90, R, R, Rc);
    rim.addColorStop(0, "rgba(" + lift.map(Math.round).join(",") + ",0)");
    rim.addColorStop(1, "rgba(" + lift.map(Math.round).join(",") + ",0.75)");
    g.fillStyle = rim;
    /* Clipped clear of the field, so the measured contrast under the code is the contrast that
     * was measured. Without this the glow washes the outer modules and the palette's number
     * stops being true where it matters most. */
    g.beginPath();
    g.rect(0, 0, size, size);
    g.arc(R, R, geo.Rd, 0, Math.PI * 2);
    g.clip("evenodd");
    g.beginPath();
    g.arc(R, R, Rc, 0, Math.PI * 2);
    g.fill();
    g.restore();
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

    /* The lens holds the disc back from the edge of the canvas to make room for the light it
     * bends. The backing store has to grow to match, or the module floor would be met against
     * the canvas while the code itself came out smaller than the floor was meant to protect.
     * A thumbnail is exempt: at 36 pixels the sky is noise, and the tile is a picture rather
     * than something anyone points a camera at. */
    var lensOn = opts.lens && !plainNow && !opts.decorative;
    var scale = lensOn ? opts.lensScale : 1;
    var device = opts.decorative ? physical
               : Math.max(Math.ceil(minDeviceFor(p.n, opts) / scale), physical);
    var coinPx = lensOn ? Math.round(device * scale) : device;
    var off = Math.round((device - coinPx) / 2);

    canvas.width = device;
    canvas.height = device;
    var g = canvas.getContext("2d");
    g.clearRect(0, 0, device, device);

    /* A lens has a smooth horizon, so the scalloped edge goes and the arcs carry the provider's
     * signature instead. The geometry MUST be computed from the same options the drawing uses:
     * coinFrame takes the scallop depth off the radius, so deriving the grid from the unmodified
     * options put every reported module position out by that depth. The suite reads this grid to
     * find the painted pixels, so the symptom was finder ratios of 0.33:1.44:1.33 and a quiet
     * zone that measured dark, which reads like a broken renderer rather than a bad measurement. */
    var lopts = lensOn ? Object.assign({}, opts, { scallop: 0 }) : opts;
    var geo = coinGeometry(p.n, coinPx, lopts);

    if (plainNow) {
      drawPlain(g, p, device, opts);
    } else if (lensOn) {
      lensBehind(g, device, coinPx, pal, opts);
      g.save();
      g.translate(off, off);
      drawCoin(g, p, coinPx, pal, lopts);
      g.restore();
      lensRim(g, device, coinPx, geo, pal);
    } else {
      drawCoin(g, p, device, pal, opts);
    }
    return {
      ecl: p.ecl, version: p.version, modules: p.n,
      plain: plainNow, fellBack: fellBack,
      /* WHERE THE CODE ACTUALLY LANDED, in canvas pixels. The lens holds the disc back from
       * the edge, so a caller can no longer assume the coin fills the canvas and re-derive the
       * grid from its width. Anything that inspects the painted pixels, which is most of the
       * geometry half of the suite, asks here instead of working it out a second time. Null
       * for the plain code, which has a layout of its own. */
      grid: plainNow ? null : {
        m: geo.m, size: coinPx, offset: off,
        gx: function (c) { return off + geo.gx(c); },
        gy: function (r) { return off + geo.gy(r); }
      },
      modulePxDevice: plainNow ? device / (p.n + 2 * opts.quiet) : geo.m,
      modulePxPhysical: (plainNow ? device / (p.n + 2 * opts.quiet) : geo.m) * (physical / device),
      contrast: pal.contrast, palette: pal,
      cssSize: cssSize, physicalSize: physical, deviceSize: device, pixelRatio: dpr
    };
  }

  /* ------------------------------------------------- the struck face, and the plate */

  /* THE COIN HAS ONE SIDE. It used to have a reverse: struck metal carrying PayNet's brand
   * graphic and the account number, reached by turning the coin over. Copying the number
   * therefore meant putting it on screen first.
   *
   * `Copy account number` puts it straight on the clipboard instead, so it never has to be
   * displayed at all, and that left the reverse with nothing to carry. drawBack, drawMark and
   * the vendored DuitNow artwork went with it, on the owner's decision of 25 Aug 2026. The
   * mark in particular is not something to keep lying around unused: it is PayNet's, its use
   * is governed, and a copy of it in the bundle that nothing draws is a compliance surface
   * with no benefit. tools/mark.mjs, which generated it, is gone for the same reason.
   *
   * What survives is struckFace, because an account with NO DuitNow code still draws one:
   * see drawPlate. */

  // `family` is optional and defaults to the system sans.
  function emboss(g, text, cx, cy, px, weight, ink, depth, track, family) {
    g.font = weight + " " + px.toFixed(1) + "px " + (family || FONT);
    if ("letterSpacing" in g) g.letterSpacing = ((track || 0) * px).toFixed(2) + "px";
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
    if ("letterSpacing" in g) g.letterSpacing = "0px";
  }

  /* THE BLANK STRUCK FACE, shared by every face that is not the code.
   *
   * The reverse of a coin and the single face of an account that has no code are the same object
   * down to the last pixel: lens, body, rim legend, dished inner face. Only what is inscribed on
   * them differs. Drawn twice they would drift, and the drift would be invisible, because the
   * two faces are never on screen at the same moment to be compared.
   *
   * BOTH FACES ARE THE SAME OBJECT, so the reverse is held back from the edge by exactly the
   * amount the front is. Left full-bleed while the front wore the lens, the coin would grow as
   * it turned over and shrink as it turned back, which reads as two pictures being swapped
   * rather than one thing rotating. The lens sky is drawn behind this face too, for the same
   * reason: it is the same object, seen from the other side.
   *
   * Leaves the context TRANSLATED into the coin and saved; the caller inscribes, then restores
   * and draws the rim glow. */
  /* `rimPal` colours the BODY, which is the part that shows as a ring around the inner face, and
   * the legend struck into it. It defaults to the coin's own palette, so a coin is one colour
   * unless somebody asks for two.
   *
   * The rim's lettering is measured against the RIM, and the face's inscriptions against the
   * FACE, which is the whole reason this takes two palettes rather than one colour: pick the
   * legend's ink from the face's palette and a light ring gets light lettering on it. */
  function struckFace(g, size, opts, pal, rimPal) {
    rimPal = rimPal || pal;
    var lensOn = opts.lens && !opts.decorative;
    var lopts = lensOn ? Object.assign({}, opts, { scallop: 0 }) : opts;
    var coinPx = lensOn ? Math.round(size * opts.lensScale) : size;
    var off = Math.round((size - coinPx) / 2);

    var f = coinFrame(coinPx, lopts);
    var R = f.R;
    var seed = seedOf(opts.seed || opts.label || "");
    var lobes = 11 + (seed % 9);
    var phase = ((seed >>> 4) % 360) * Math.PI / 180;

    if (lensOn) lensBehind(g, size, coinPx, pal, opts);
    g.save();
    g.translate(off, off);

    // The body, struck from the same die as the front. It is what shows as the ring.
    var lg = g.createLinearGradient(0, 0, coinPx, coinPx);
    lg.addColorStop(0, rimPal.brandSink);
    lg.addColorStop(0.42, rimPal.brandLift);
    lg.addColorStop(0.62, rimPal.brand);
    lg.addColorStop(1, rimPal.brandSink);
    g.fillStyle = opts.sheen ? lg : rimPal.brand;
    if (lopts.scallop > 0) scallopPath(g, R, R, f.Rbase, R, lobes, phase);
    else { g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); }
    g.fill();

    if (opts.legend) rimLegend(g, R, R, f.Rd + f.ring * 0.52, opts.label, rimPal, f.ring * 0.46);

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

    return { f: f, R: R, coinPx: coinPx, lensOn: lensOn, D: f.Rd * 2 };
  }

  /* Fit one line to the CHORD at its own height, not to the face's widest point.
   *
   * A circle's width falls away fast towards the rim: at four fifths of the radius down there is
   * only three fifths of the diameter to write on. Fitted to the flat width instead, tracked
   * lettering runs straight over the rim legend, which is what happened to the caption the
   * moment the account number was opened up. Half-chord = sqrt(Rd^2 - y^2). What gives is the
   * type size, which is ours, never the tracking, which is what makes it read as an inscription.
   */
  function fitChord(g, text, y, R, Rd, px, track, weight, family) {
    var dy = Math.abs(y - R) + px * 0.5;
    var half = Rd > dy ? Math.sqrt(Rd * Rd - dy * dy) : Rd * 0.1;
    var room = half * 2 * 0.86;                        // a little undisturbed metal either side
    g.font = (weight || "600") + " " + px.toFixed(1) + "px " + (family || FONT);
    if ("letterSpacing" in g) g.letterSpacing = (track * px).toFixed(2) + "px";
    var w = g.measureText(text).width;
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    return w > room ? px * (room / w) : px;
  }

  /* Draw a traced mark centred on (cx, cy), `h` tall, scaled down if its width would overrun the
   * chord at that height. A circle narrows away from the middle, and a wordmark is wide, so the
   * width is the binding constraint every time. */
  function drawMark(g, mark, cx, cy, h, R, Rd, ink) {
    var P = (typeof Path2D !== "undefined") ? Path2D
          : (typeof self !== "undefined" && self.Path2D) ? self.Path2D : null;
    if (!P) return false;
    var w = h * mark.aspect;
    // R is the face CENTRE, Rd its radius. Measuring from the radius instead put every mark's
    // chord out by the difference, which on a small face is most of the face.
    var dy = Math.abs(cy - R) + h * 0.5;
    var half = Rd > dy ? Math.sqrt(Rd * Rd - dy * dy) : Rd * 0.1;
    var room = half * 2 * 0.86;
    if (w > room) { var k = room / w; w *= k; h *= k; }
    g.save();
    g.translate(cx - w / 2, cy - h / 2);
    g.scale(w / mark.viewBox[2], h / mark.viewBox[3]);
    g.translate(-mark.viewBox[0], -mark.viewBox[1]);
    g.fillStyle = ink;
    g.fill(new P(mark.d), "evenodd");
    g.restore();
    return true;
  }

  /* WRAP RATHER THAN SHRINK PAST LEGIBILITY, because a circle punishes long text twice over.
   *
   * A chord is the widest thing this face has, so fitting a 30-character name to it on one line
   * drives the type down to about a fifth of the size the vertical room would allow: measured,
   * "WISE PAYMENTS MALAYSIA SDN BHD" fitted to one line comes out near 10 CSS px on a phone,
   * where broken at its most balanced word boundary it holds about 18. Height was never the
   * constraint here; width was, and two lines buy width back.
   *
   * The split is chosen by RENDERED WIDTH rather than by word count, and the most balanced break
   * wins. Splitting down the middle of the word list left "WISE" alone above "PAYMENTS MALAYSIA
   * SDN BHD", which looks like a mistake rather than a line break. */
  function layoutValue(g, text, px, track, maxW, minPx) {
    var measure = function (s, size) {
      g.font = "600 " + size.toFixed(1) + "px " + FONT;
      if ("letterSpacing" in g) g.letterSpacing = (track * size).toFixed(2) + "px";
      var w = g.measureText(s).width;
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      return w;
    };
    var one = measure(text, px);
    if (one <= maxW) return { lines: [text], px: px };

    var fitted = px * (maxW / one);
    var words = text.split(/\s+/).filter(Boolean);
    // One line is preferred while it stays readable, and is the only option for a single word.
    if (fitted >= minPx || words.length < 2) return { lines: [text], px: fitted };

    var bestK = 1, bestGap = Infinity, bestWide = Infinity;
    for (var k = 1; k < words.length; k++) {
      var w1 = measure(words.slice(0, k).join(" "), px);
      var w2 = measure(words.slice(k).join(" "), px);
      var d = Math.abs(w1 - w2);
      if (d < bestGap) { bestGap = d; bestK = k; bestWide = Math.max(w1, w2); }
    }
    return {
      lines: [words.slice(0, bestK).join(" "), words.slice(bestK).join(" ")],
      px: bestWide > maxW ? px * (maxW / bestWide) : px
    };
  }

  /* ---------------------------------------------------------------- the plate */

  /* An account with NO CODE AT ALL, paid by naming the bank, the number and the person.
   *
   * It is the same struck coin, with one face instead of two, because there is no code to put on
   * the other one. Three inscriptions, in the order somebody filling in a transfer form needs
   * them: the bank it is held at, the number, and the name it is in. The provider is already
   * around the rim, so it is not repeated here.
   *
   * NO DUITNOW MARK, and that is a rule rather than an oversight. The mark is PayNet's, and it
   * says a DuitNow code is present. This account has none, so putting their artwork on it would
   * be using their brand to label something it does not cover.
   *
   * Everything is laid out as one block and centred, for the reason the reverse is: positioned
   * piece by piece from the middle, the lower lines drift into the rim legend as soon as the
   * number runs long. Each line is then fitted to its own chord, because the room on a circle
   * depends on how far from the middle it sits. */
  function drawPlate(canvas, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var cssSize = Math.max(64, Math.round(opts.size || 512));
    var dpr = opts.pixelRatio || 1;
    var size = Math.max(opts.minDevice || 0, Math.round(cssSize * dpr));

    canvas.width = size;
    canvas.height = size;
    var g = canvas.getContext("2d");
    g.clearRect(0, 0, size, size);

    var pal = palette(opts.brand || "#5a5a5a", opts.minContrast);
    /* TWO COLOURS, and the ring is the second. `brand` strikes the face and everything inscribed
     * on it; `ring` strikes the band around it and the legend struck into that band. It exists
     * because this account is two brands at once: held at one bank, received by another, and the
     * coin can say so without a word. Absent, the ring is the brand and the coin is one colour,
     * which is every other account. */
    var rimPal = opts.ring ? palette(opts.ring, opts.minContrast) : pal;
    var b = struckFace(g, size, opts, pal, rimPal);
    var f = b.f, R = b.R, D = b.D;

    var bank = String(opts.bank || "").trim().toUpperCase();
    var holder = String(opts.holder || "").trim().toUpperCase();

    /* THE ACCOUNT NUMBER IS NOT DRAWN HERE EITHER, and `acct` is deliberately not read.
     *
     * It used to be the largest thing on this face. Taking it off the coin's reverse and leaving
     * it on this one would have been the odd account out: twelve that never show a number and
     * one that does, which is the sort of inconsistency that reads as an oversight. The number
     * reaches a banking app through `Copy account number` without being displayed anywhere, so
     * the face carries what you cannot copy instead: the bank it is held at, which somebody
     * filling in a transfer has to read and type themselves. Owner's decision, 25 Aug 2026.
     *
     * The bank is therefore the PRIMARY inscription now rather than a caption over the number,
     * and it is sized as one. Bank names run long, so it is started generously and fitted to its
     * chord, which is what stops "JPMORGAN CHASE BANK BERHAD" running over the rim legend. */
    /* THE FACE IS AN INSTRUCTION, not a label. Somebody paying this account picks a bank from a
     * list and then has to confirm a receiver name that is NOT the person they think they are
     * paying, so both are set out under their own headings. Being surprised by that second name
     * is how a payer aborts a transfer half way through. */
    var LTRACK = 0.16, VTRACK = 0.05;
    var labelPx = D * 0.045;
    var valuePx = D * 0.086;
    var minValuePx = D * 0.058;   // below this a value wraps rather than shrinking further
    var maxW = D * 0.78;          // the working chord; each line is refitted to its own below

    /* A MARK IS THE ARTWORK'S OWN OUTLINE, traced from the supplied file by tools/vectorise.mjs.
     *
     * This is not the thing this repo refused. That rule is about a trademark REDRAWN FROM
     * MEMORY, which comes out subtly wrong; a trace invents nothing, it follows the pixels of
     * the artwork it was given. It is still a derivative of a raster, so an official vector
     * should replace it the day one exists.
     *
     * PATH DATA, NOT A RASTER, and that is why it is affordable. Drawing an image would need
     * `img-src data:` added to a Content-Security-Policy that is `default-src 'none'`; a Path2D
     * built from a string needs nothing. The security header stays shut and the mark stays sharp.
     *
     * Filled FLAT and EVEN-ODD, in one ink: even-odd means a counter inside a P subtracts itself
     * with no winding order to maintain, and flat means the mark is never embossed. Embossing is
     * our own typographic treatment and ours to apply to our own lettering; somebody else's
     * logotype gets no effects. */
    var markOf = function (m) {
      return (m && typeof m.d === "string" && m.d && m.viewBox) ? m : null;
    };

    /* A MARK REPLACES ITS NAME, it does not sit above it. Owner's instruction, 26 Aug 2026.
     *
     * What that costs is worth naming: the name was there to be MATCHED, letter for letter,
     * against the string a payer's banking app shows them at the confirm step, and a logo cannot
     * be compared to a string. What it buys is a face you can read at a glance instead of four
     * lines of legal name. The brands are still unambiguous, the rim still reads JPMORGAN CHASE,
     * and the full names are still in the coin's accessibility label, which is where a logo's
     * text alternative belongs anyway.
     *
     * A row with no traced mark still draws its name, so an account whose bank has no logo is
     * not a blank space. */
    var rows = [];
    if (bank) rows.push({ label: "BANK", value: bank, mark: markOf(opts.bankMark) });
    if (holder) rows.push({ label: "RECEIVER", value: holder, mark: markOf(opts.holderMark) });

    /* MARKS ARE MATCHED ON WIDTH, NOT HEIGHT, and that falls out of the circle rather than being
     * a preference. Set the cap high and the chord limits both to the same width, so two
     * wordmarks of very different proportions sit as one column. Matched on height instead, the
     * wider one (Wise, at 4.4:1) would run to the rim while JPMC at 2.8:1 looked half empty. */
    var markCap = D * 0.30;
    var markGap = D * 0.03;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].mark) {
        // The height the chord actually allows, so the block reserves what will be drawn.
        rows[r].markPx = Math.min(markCap, maxW / rows[r].mark.aspect);
      } else {
        rows[r].fit = layoutValue(g, rows[r].value, valuePx, VTRACK, maxW, minValuePx);
      }
    }

    var lineStep = 1.2;
    var labelGap = labelPx * 0.5;
    var rowGap = D * 0.075;
    var heightOf = function (row) {
      return labelPx + labelGap + (row.mark
        ? row.markPx
        : row.fit.px * (1 + (row.fit.lines.length - 1) * lineStep));
    };
    var sumH = function () {
      var t = rowGap * Math.max(0, rows.length - 1);
      for (var i = 0; i < rows.length; i++) t += heightOf(rows[i]);
      return t;
    };

    var blockH = sumH();
    var room = D * 0.84;
    if (blockH > room) {
      var k = room / blockH;
      labelPx *= k; labelGap *= k; rowGap *= k;
      for (var i3 = 0; i3 < rows.length; i3++) {
        if (rows[i3].mark) rows[i3].markPx *= k; else rows[i3].fit.px *= k;
      }
      blockH = sumH();
    }

    var y = R - blockH / 2;
    for (var i5 = 0; i5 < rows.length; i5++) {
      var row = rows[i5];
      var ly = y + labelPx * 0.5;
      emboss(g, row.label, R, ly, fitChord(g, row.label, ly, R, f.Rd, labelPx, LTRACK),
             "700", pal.faceDim, 0.03, LTRACK);
      y += labelPx + labelGap;

      if (row.mark) {
        drawMark(g, row.mark, R, y + row.markPx * 0.5, row.markPx, R, f.Rd, pal.faceInk);
        y += row.markPx + rowGap;
        continue;
      }

      /* ONE NAME IS ONE SIZE. Fitting each line to its own chord independently made the lower
       * line of a wrapped name smaller than the upper one, because a circle narrows as you go
       * down: "WISE PAYMENTS" came out visibly bigger than "MALAYSIA SDN BHD" beneath it, which
       * reads as a rendering fault rather than a line break. Every line is measured first and
       * the whole name takes the smallest size any of them needs. */
      var vPx = row.fit.px;
      for (var j0 = 0; j0 < row.fit.lines.length; j0++) {
        var y0 = y + row.fit.px * 0.5 + j0 * row.fit.px * lineStep;
        vPx = Math.min(vPx, fitChord(g, row.fit.lines[j0], y0, R, f.Rd, row.fit.px, VTRACK));
      }
      for (var j = 0; j < row.fit.lines.length; j++) {
        var vy = y + row.fit.px * 0.5 + j * row.fit.px * lineStep;
        emboss(g, row.fit.lines[j], R, vy, vPx, "600", pal.faceInk, 0.042, VTRACK);
      }
      y += row.fit.px * (1 + (row.fit.lines.length - 1) * lineStep) + rowGap;
    }

    g.restore();
    if (b.lensOn) lensRim(g, size, b.coinPx, f, pal);

    return { size: cssSize, deviceSize: size, coinPx: b.coinPx, palette: pal,
             bank: bank, holder: holder, rows: rows.length, plate: true };
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
    drawPlate: drawPlate,
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
