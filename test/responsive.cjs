/* Browser checks run separately from the no-browser payment suite. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium, firefox, webkit } = require("playwright");

const root = path.resolve(__dirname, "..", "public");
const data = fs.readFileSync(path.join(root, "data.js"), "utf8");
const accounts = JSON.parse(data.slice(data.indexOf("["), data.lastIndexOf("]") + 1));
const state = { maintenance: Object.fromEntries(accounts.map((a) => [a.key, false])), order: [] };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let saved;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/state.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  if (url.pathname === "/api/me") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, email: "owner@example.test" }));
    return;
  }
  if (url.pathname === "/api/state" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { saved = JSON.parse(body); res.end('{"ok":true}'); });
    return;
  }
  const name = url.pathname === "/" ? "/index.html" : url.pathname === "/admin/" ? "/admin/index.html" : url.pathname;
  const file = path.resolve(root, "." + name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

const sizes = [
  ["narrow zoom", 280, 320, 2], ["square zoom", 320, 320, 2],
  ["small phone", 320, 568, 2], ["phone", 390, 844, 3],
  ["small landscape", 568, 320, 3], ["landscape", 667, 375, 3],
  ["large landscape", 844, 390, 3], ["tablet", 768, 1024, 2],
  ["below width", 959, 640, 1], ["below height", 960, 639, 1],
  ["pane threshold", 960, 640, 1], ["short desktop", 1180, 560, 2],
  ["laptop", 1180, 820, 2], ["wide desktop", 1920, 1080, 1],
  ["zoomed-out desktop", 1920, 1080, 0.8]
];

function within(rect, width, height, label) {
  assert(rect.width > 0 && rect.height > 0, `${label} has no size`);
  assert(rect.x >= -1 && rect.y >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1,
    `${label} is outside ${width}x${height}: ${JSON.stringify(rect)}`);
}
function separate(a, b, label) {
  const x = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  assert(x <= 1 || y <= 1, `${label} overlap`);
}

async function checkSize(browser, base, [name, width, height, dpr]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/#maybank/qr/123456.78/abcdefghijklmnopqrst");
    await page.waitForFunction(() => document.body.classList.contains("view-code") && document.querySelector("#coin").width > 8);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return {
        coin: rect("#coinbtn"), due: rect("#due"), tools: rect(".tools"), back: rect("#back"),
        accounts: rect("#accounts"), detail: rect("#codeview"),
        visible: getComputedStyle(document.querySelector("#accounts")).visibility,
        plain: document.querySelector("#coinbtn").classList.contains("plainmode"),
        scrollWidth: document.documentElement.scrollWidth,
        detailScroll: document.querySelector("#codeview").scrollHeight > document.querySelector("#codeview").clientHeight
      };
    });
    for (const k of ["coin", "due", "tools", "back"]) {
      if (layout.detailScroll) {
        const locator = page.locator({ coin: "#coinbtn", due: "#due", tools: ".tools", back: "#back" }[k]);
        await locator.scrollIntoViewIfNeeded();
        const r = await locator.boundingBox();
        within({ ...r, right: r.x + r.width, bottom: r.y + r.height }, width, height, `${name}: ${k}`);
      } else within(layout[k], width, height, `${name}: ${k}`);
    }
    separate(layout.coin, layout.back, `${name}: coin and back`);
    separate(layout.coin, layout.due, `${name}: coin and due`);
    separate(layout.coin, layout.tools, `${name}: coin and actions`);
    separate(layout.due, layout.tools, `${name}: due and actions`);
    assert(layout.scrollWidth <= width, `${name}: horizontal overflow`);
    assert.equal(layout.plain, Math.round(layout.coin.width * dpr) < 580, `${name}: unsafe coin fallback`);
    if (name === "zoomed-out desktop") assert.equal(layout.plain, false, `${name}: unnecessary fallback`);
    if (width >= 960 && height >= 640) {
      assert.equal(layout.visible, "visible", `${name}: list hidden in panes`);
      separate(layout.accounts, layout.detail, `${name}: panes`);
    } else assert.equal(layout.visible, "hidden", `${name}: list visible over detail`);
    await page.goto(base + "/#maybank/transfer/123456.78/abcdefghijklmnopqrst");
    await page.waitForFunction(() => document.body.getAttribute("data-view") === "transfer" &&
      document.querySelectorAll("#due .prow").length === 2);
    const plateLayout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const detail = document.querySelector("#codeview");
      return { plate: rect("#plate"), due: rect("#due"), tools: rect(".tools"), back: rect("#back"),
        scroll: detail.scrollHeight > detail.clientHeight };
    });
    for (const k of ["plate", "due", "tools", "back"]) {
      if (plateLayout.scroll) {
        const locator = page.locator({ plate: "#plate", due: "#due", tools: ".tools", back: "#back" }[k]);
        await locator.scrollIntoViewIfNeeded();
        const r = await locator.boundingBox();
        within({ ...r, right: r.x + r.width, bottom: r.y + r.height }, width, height, `${name}: ${k}`);
      } else within(plateLayout[k], width, height, `${name}: ${k}`);
    }
    separate(plateLayout.plate, plateLayout.due, `${name}: plate and due`);
    separate(plateLayout.plate, plateLayout.tools, `${name}: plate and actions`);
    separate(plateLayout.due, plateLayout.tools, `${name}: due and actions`);
    separate(plateLayout.plate, plateLayout.back, `${name}: plate and back`);
    assert.deepEqual(errors, [], `${name}: browser errors`);
  } finally { await context.close(); }
}

async function checkInteractions(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(base + "/#maybank/qr/1/test");
    await page.waitForFunction(() => document.body.classList.contains("view-code") && document.querySelector("#coin").width > 8);
    await page.getByRole("button", { name: /Transfer/ }).click();
    assert.equal(await page.locator("body").getAttribute("data-view"), "transfer");
    assert.equal(new URL(page.url()).hash, "#maybank/transfer/1.00/test");
    assert.equal(await page.locator("#due .prow").count(), 2);
    await page.getByRole("button", { name: /JomPAY/ }).click();
    assert.equal(new URL(page.url()).hash, "");
    assert(await page.locator("body").evaluate((body) => body.classList.contains("view-list")));
    await page.getByRole("button", { name: /^QR/ }).click();
    const tiles = page.locator("#grid .tile:visible");
    await tiles.nth(0).click();
    const firstHash = new URL(page.url()).hash;
    await tiles.nth(1).focus();
    await page.keyboard.press("Enter");
    assert.notEqual(new URL(page.url()).hash, firstHash);
    assert(await page.locator("body").evaluate((body) => body.classList.contains("view-code")));
    await page.locator("#back").click();
    await page.waitForFunction(() => document.body.classList.contains("view-list") && !location.hash);
    await tiles.nth(1).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#accounts")).visibility === "hidden");
    assert(await page.locator("#coinbtn").isVisible());
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#accounts")).visibility === "visible");

    // An account opened from the list, then a rail it is not on: the list must come back on the
    // list's own history entry, not on a dead copy that one more Back would merely repeat.
    const fresh = await context.newPage();
    await fresh.goto(base + "/");
    await fresh.waitForFunction(() => document.body.classList.contains("view-list"));
    await fresh.getByRole("button", { name: /Transfer/ }).click();
    await fresh.locator("#grid .tile:visible", { hasText: "Maybank" }).first().click();
    await fresh.waitForFunction(() => /^#maybank(\/|$)/.test(location.hash));
    await fresh.getByRole("button", { name: /JomPAY/ }).click();
    await fresh.waitForFunction(() => document.body.classList.contains("view-list") && !location.hash &&
      history.state === null, null, { timeout: 5000 });
    await fresh.close();

    await page.goto(base + "/admin/");
    await page.waitForSelector(".row");
    for (const [width, height] of [[320, 568], [568, 320], [960, 640], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `admin ${width}x${height}: horizontal overflow`);
      for (const selector of [".row .handle", ".row .switch", "#save"]) {
        const r = await page.locator(selector).first().boundingBox();
        assert(r.width >= 44 && r.height >= 44, `admin ${width}x${height}: small ${selector}: ${JSON.stringify(r)}`);
      }
    }
    await page.setViewportSize({ width: 1180, height: 820 });
    const first = await page.locator(".row").nth(0).getAttribute("data-key");
    const second = await page.locator(".row").nth(1).getAttribute("data-key");
    await page.locator(".row .handle").nth(1).focus();
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator(".row").nth(0).getAttribute("data-key"), second);
    const handle = page.locator(".row .handle").nth(1);
    const target = page.locator(".row").nth(2);
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4);
    await page.mouse.up();
    assert.equal(await page.locator(".row").nth(2).getAttribute("data-key"), first);
    await page.locator(".row .switch").nth(0).click();
    await page.locator("#save").click();
    await page.waitForFunction(() => document.querySelector("#say").textContent.startsWith("Saved."));
    assert.equal(saved.order[0], second);
    assert.equal(saved.order[2], first);
    assert.equal(saved.maintenance[second], true);
    state.maintenance.maybank = true;
    await page.goto(base + "/#maybank/qr/1/test");
    await page.waitForFunction(() => document.body.classList.contains("maintenance"));
    assert.equal(await page.locator("#coin").evaluate((coin) => coin.width), 8);
    assert.equal(await page.locator("#due .prow").count(), 0);
    await page.goto(base + "/#maybank/transfer/1/test");
    await page.waitForFunction(() => document.body.classList.contains("maintenance"));
    assert.equal(await page.locator("#plate .prow").count(), 0);
  } finally { state.maintenance.maybank = false; await context.close(); }
}

async function checkNoScript(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(base);
    const notice = page.locator(".noscript");
    assert(await notice.isVisible());
    const r = await notice.boundingBox();
    within({ ...r, right: r.x + r.width, bottom: r.y + r.height }, 390, 844, "no-script notice");
  } finally { await context.close(); }
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox], ["WebKit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const size of sizes) await checkSize(browser, base, size);
        await checkInteractions(browser, base);
        await checkNoScript(browser, base);
        console.log(`${name}: ${sizes.length} sizes and interactions passed`);
      } finally { await browser.close(); }
    }
  } finally { server.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
