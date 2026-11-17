/* THE MOOD FOLLOWS THE HOUR (his word, 17 Nov 2026): Ambient's moods, dark only, by the phone's
 * own clock, each blending into the next over an hour so that nothing is ever seen to change.
 * Lagoon by day, Flare at golden hour, Dusk by night. The blend is the browser's own transition
 * of Ambient's registered colours on <html> (app.css, --mood-run and --mood-lag), given the hour
 * and started part of the way through by a negative delay, so a page opened mid-blend stands
 * where the blend has reached. The inks are not registered and turn at the blend's start; their
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
  var moodTimer = null;
  function setMood() {
    var root = document.documentElement;
    if (!root || !root.style) return;
    var d = new Date();
    var m = moodAt(((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds());
    var wait = m.wait;
    root.style.setProperty("--mood-run", "0s");
    if (m.into >= 0 && !reduced.matches) {
      root.setAttribute("data-mood", m.from);
      getComputedStyle(root).getPropertyValue("--amb-base");   // the old mood is where the transition starts
      root.style.setProperty("--mood-lag", -m.into + "ms");
      root.style.setProperty("--mood-run", HOUR_MS + "ms");
      root.setAttribute("data-mood", m.to);
      wait = Math.min(wait, 60000);
    } else if (m.into >= 0 && m.into < HOUR_MS / 2) {
      root.setAttribute("data-mood", m.from);
      wait = HOUR_MS / 2 - m.into;
    } else root.setAttribute("data-mood", m.to);
    var meta = document.querySelector('meta[name="theme-color"]');
    var base = getComputedStyle(root).getPropertyValue("--amb-base").trim();
    if (meta && base) meta.setAttribute("content", base);
    clearTimeout(moodTimer);
    moodTimer = setTimeout(setMood, wait);
  }
  self.setMood = setMood;
  setMood();
  /* In <head> the root has no style yet to transition from, so a blend asked for there lands at
   * its end; asked again on the first frame, it starts where the hour has reached. */
  if (self.requestAnimationFrame) self.requestAnimationFrame(function () { setMood(); });
})();
