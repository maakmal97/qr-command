/* THE MOOD FOLLOWS THE HOUR (his word, 17 Nov 2026): Ambient's moods, dark only, by the phone's
 * own clock, each blending into the next over an hour so that nothing is ever seen to change.
 * Lagoon by day, Flare at golden hour, Dusk by night. The blend mixes Ambient's registered
 * colours of the two moods on <html>, stepped once a minute (below), so a page opened mid-blend
 * stands where the blend has reached. The inks are not registered and turn at the blend's start; their
 * contrast is Ambient's on every dark base. Under reduced motion nothing glides, and the mood
 * turns at the blend's middle instead. It colours the page and does nothing else.
 *
 * Loaded in <head>, before the body is parsed, so the first frame is already in the hour's mood
 * (from app.js it ran after the first paint, and the page opened in Lagoon and then snapped).
 * theme-color follows the base, once a minute while a blend runs. app.js calls self.setMood on
 * the return to the front: a pocket can outlast a turn, and a hidden page's timers are held back. */
(function () {
  "use strict";
  var MOOD_TURNS = [[5, "dusk", "lagoon"], [16, "lagoon", "flare"], [19, "flare", "dusk"]];   // [hour the blend starts, from, to]
  var HOUR_MS = 3600000, DAY_MS = 24 * HOUR_MS;
  // ms since local midnight: the turn in force, how far into its blend (-1 once it has ended), and the wait to the next turn
  function moodAt(ms) {
    var i = MOOD_TURNS.length - 1;
    while (i >= 0 && MOOD_TURNS[i][0] * HOUR_MS > ms) i--;
    var turn = MOOD_TURNS[i < 0 ? MOOD_TURNS.length - 1 : i];
    var into = (ms - turn[0] * HOUR_MS + DAY_MS) % DAY_MS;
    var next = MOOD_TURNS[(i + 1) % MOOD_TURNS.length][0] * HOUR_MS;
    return { from: turn[1], to: turn[2], into: into < HOUR_MS ? into : -1, wait: (next - ms + DAY_MS) % DAY_MS || DAY_MS };
  }
  var reduced = self.matchMedia ? self.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  /* THE BLEND IS STEPPED HERE, ONCE A MINUTE, NEVER BY A CSS TRANSITION (17 Nov 2026). An hour's
   * transition of these inherited colours on <html>, even at steps(360), kept the browser
   * restyling the whole page on every frame for the hour: a tap took 6 to 10 times as long in a
   * blend hour, measured. Here each colour is the two moods' mix at the minute, set on <html>, so
   * the page restyles 60 times in the hour; each step is a sixtieth of the turn, too small to see. */
  var BLENDED = ["--amb-base", "--amb-surface", "--amb-raised", "--amb-well", "--amb-mesh-1", "--amb-mesh-2", "--amb-mesh-3"];
  var canMix = !!(self.CSS && CSS.supports && CSS.supports("color", "color-mix(in srgb, red 50%, blue)"));
  var moodTimer = null;
  function readMood(root, mood) {
    root.setAttribute("data-mood", mood);
    var cs = getComputedStyle(root);
    return BLENDED.map(function (p) { return cs.getPropertyValue(p).trim(); });
  }
  function setMood() {
    var root = document.documentElement;
    if (!root || !root.style) return;
    var d = new Date();
    var m = moodAt(((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds());
    var wait = m.wait;
    BLENDED.forEach(function (p) { root.style.removeProperty(p); });
    if (m.into >= 0 && !reduced.matches && canMix) {
      var a = readMood(root, m.from), b = readMood(root, m.to);   // ends on the new mood: its inks turn now
      var pc = Math.round(m.into / HOUR_MS * 1000) / 10;
      BLENDED.forEach(function (p, i) {
        if (a[i] && b[i]) root.style.setProperty(p, "color-mix(in srgb, " + a[i] + ", " + b[i] + " " + pc + "%)");
      });
      wait = Math.min(wait, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() || 60000);
    } else if (m.into >= 0 && m.into < HOUR_MS / 2) {
      root.setAttribute("data-mood", m.from);
      wait = HOUR_MS / 2 - m.into;
    } else root.setAttribute("data-mood", m.to);
    var meta = document.querySelector('meta[name="theme-color"]');
    var base = getComputedStyle(root).getPropertyValue("--amb-base").trim();
    // A mixed base computes to color(srgb r g b) in 0..1; the bar gets plain rgb(), which every engine reads.
    var c = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(base);
    if (c) base = "rgb(" + [c[1], c[2], c[3]].map(function (v) { return Math.round(v * 255); }).join(", ") + ")";
    if (meta && base) meta.setAttribute("content", base);
    clearTimeout(moodTimer);
    moodTimer = setTimeout(setMood, wait);
  }
  self.setMood = setMood;
  setMood();
  /* Asked again on the first frame, once the body's styles exist, in case the head's read of a
   * mood's colours came too early on some engine. One extra restyle, at open only. */
  if (self.requestAnimationFrame) self.requestAnimationFrame(function () { setMood(); });
})();
