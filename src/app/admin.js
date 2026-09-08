/* Manage - the edit surface, behind Cloudflare Access.
 *
 * Two edits and no more: which accounts are shown, and the order the tiles stand in. Both are
 * one JSON value in KV, written through POST /api/state, which the Worker gates on the Access
 * token. The page itself decides nothing about who is here; if the token is missing the Worker
 * answers 401 and the page says so.
 *
 * The state written is COMPLETE: every account gets an explicit boolean, and the order names
 * every key. The phone treats a key the state names as overriding the bundle's flag, so a
 * complete state is what makes the bundle's flag irrelevant after the first save.
 */
(function () {
  "use strict";

  var CODES = self.QR_CODES || [];
  var elRows = document.getElementById("rows");
  var elSave = document.getElementById("save");
  var elSay = document.getElementById("say");
  var elWho = document.getElementById("who");
  var rows = [];
  var dirty = false;

  function say(t) { elSay.textContent = t; }

  function setDirty(on) {
    dirty = on;
    elSave.disabled = !on;
    if (on) say("Unsaved changes");
  }

  function byKey(key) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].key === key) return CODES[i];
    return null;
  }

  function setRow(row, off) {
    row.classList.toggle("off", off);
    row.sw.setAttribute("aria-pressed", String(!off));
    row.sw.textContent = off ? "Hidden" : "Shown";
  }

  function move(row, delta) {
    var kids = Array.prototype.slice.call(elRows.children);
    var i = kids.indexOf(row), j = i + delta;
    if (j < 0 || j >= kids.length) return;
    elRows.insertBefore(row, delta < 0 ? kids[j] : kids[j].nextSibling);
    setDirty(true);
  }

  function build(state) {
    elRows.textContent = "";
    rows = [];
    // The state's order first, then anything it does not name in build order.
    var keys = state.order.slice();
    CODES.forEach(function (a) { if (keys.indexOf(a.key) < 0) keys.push(a.key); });
    keys.forEach(function (key) {
      var a = byKey(key);
      if (!a) return;
      var li = document.createElement("li");
      li.className = "row";
      li.dataset.key = key;
      li.style.setProperty("--dot", a.brand);

      var h = document.createElement("button");
      h.type = "button";
      h.className = "handle";
      h.setAttribute("aria-label", "Move " + a.name + ". Drag, or use the arrow keys.");
      h.textContent = "≡";

      var dot = document.createElement("span");
      dot.className = "rowdot";
      dot.setAttribute("aria-hidden", "true");

      var name = document.createElement("span");
      name.className = "rowname";
      name.textContent = a.name;

      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "pill switch";
      li.sw = sw;

      li.appendChild(h);
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(sw);
      elRows.appendChild(li);
      rows.push(li);

      var off = Object.prototype.hasOwnProperty.call(state.maintenance, key)
        ? state.maintenance[key] === true
        : a.maintenance === true;
      setRow(li, off);

      sw.addEventListener("click", function () {
        setRow(li, !li.classList.contains("off"));
        setDirty(true);
      });
      h.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") { e.preventDefault(); move(li, -1); h.focus(); }
        if (e.key === "ArrowDown") { e.preventDefault(); move(li, 1); h.focus(); }
      });
      drag(h, li);
    });
  }

  /* Drag by the handle. The row under the pointer is found by elementFromPoint, which works
   * under pointer capture, and the dragged row is moved before or after it depending on which
   * half of it the pointer is in. touch-action:none on the handle keeps the page from scrolling
   * instead. */
  function drag(h, li) {
    var on = false;
    h.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      on = true;
      li.classList.add("lift");
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener("pointermove", function (e) {
      if (!on) return;
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var r = over && over.closest ? over.closest(".row") : null;
      if (!r || r === li) return;
      var rect = r.getBoundingClientRect();
      var before = e.clientY < rect.top + rect.height / 2;
      elRows.insertBefore(li, before ? r : r.nextSibling);
      setDirty(true);
    });
    var end = function () { on = false; li.classList.remove("lift"); };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
  }

  function collect() {
    var state = { maintenance: {}, order: [] };
    Array.prototype.forEach.call(elRows.children, function (li) {
      state.order.push(li.dataset.key);
      state.maintenance[li.dataset.key] = li.classList.contains("off");
    });
    return state;
  }

  function save() {
    if (!dirty) return;
    elSave.disabled = true;
    say("Saving");
    fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(collect()),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.ok) {
          setDirty(false);
          say("Saved. Live on the phone now.");
        } else if (res.status === 401) {
          elSave.disabled = false;
          say("Not signed in. Reload to sign in again.");
        } else {
          elSave.disabled = false;
          say("Not saved: " + ((res.body && res.body.error) || ("HTTP " + res.status)));
        }
      })
      .catch(function () { elSave.disabled = false; say("Not saved: no connection"); });
  }

  function clean(j) {
    var s = { maintenance: {}, order: [] };
    if (!j || typeof j !== "object") return s;
    if (j.maintenance && typeof j.maintenance === "object") {
      for (var k in j.maintenance) if (typeof j.maintenance[k] === "boolean") s.maintenance[k] = j.maintenance[k];
    }
    if (Array.isArray(j.order)) s.order = j.order.filter(function (k) { return typeof k === "string"; });
    return s;
  }

  elSave.addEventListener("click", save);
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  fetch("/api/me", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { elWho.textContent = j && j.ok ? j.email : "Not signed in"; })
    .catch(function () { elWho.textContent = ""; });

  fetch("/state.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { build(clean(j)); })
    .catch(function () { build(clean(null)); say("Could not read the current state; showing the build's."); });
})();
