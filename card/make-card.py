#!/usr/bin/env python3
"""Build the offline card: every stored code on one A5 page, as a PDF.

    python3 make-card.py                 -> pay-card.pdf
    python3 make-card.py out.pdf         -> a different name
    python3 make-card.py --only ryt,tng,spay wallet.pdf

Fewer codes means bigger codes and wider gaps, which is the only thing that
actually stops a phone locking onto the code next door. The script prints how
close you have to hold the phone for the grid it chose.

Needs reportlab. It will also use the `qrcode` package if node is not around:

    pip install reportlab qrcode

WHY THE ENCODER IS FUSSY
Three QR encoders were tried against these thirteen payloads and only one gave
codes a decoder could read every time: the `qrcode.js` this site already ships,
in plain 8-bit byte mode. ReportLab's own encoder produced three unreadable
codes; the Python `qrcode` package produced one, on a different mask. So this
script prefers node with `qrcode.js`, which makes the printed codes byte for
byte the ones the app draws on screen and exports as PNG.

Without node it falls back to Python and, if OpenCV is installed, decodes every
code it drew and refuses to write the PDF if any of them fails to read back.

THE RULE: payloads are read and encoded, never rewritten.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

from reportlab.lib.colors import Color
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
# Carried over from the retired laptop master on 12 Sep 2026; the store and the encoder now
# live in this repo, one level up.
DATA = os.path.join(HERE, "..", "data", "accounts.json")
ENCODER = os.path.join(HERE, "..", "src", "vendor", "qrcode.js")

# --- page ---------------------------------------------------------------
PAGE_W, PAGE_H = 148 * mm, 210 * mm          # A5 portrait
MARGIN_X = 12 * mm
MARGIN_TOP = 9 * mm
MARGIN_BOT = 12 * mm
LABEL_BLOCK = 3.2 * mm                        # gap plus the key
ROW_GAP = 3.0 * mm
MIN_GUTTER = 8.0 * mm                         # clear paper between columns
QUIET = 4                                     # modules, the spec minimum
MIN_MODULE_MM = 0.40                          # below this, phones start to struggle

INK = Color(0, 0, 0)
LABEL_GREY = Color(0.42, 0.42, 0.42)
FAINT = Color(0.72, 0.72, 0.72)

MYT = timezone(timedelta(hours=8))
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# --- encoding -----------------------------------------------------------

NODE_SCRIPT = r"""
const fs = require("fs");
eval(fs.readFileSync(process.argv[2], "utf8"));
const payloads = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const out = payloads.map(p => {
  const q = qrcode(0, "M");
  q.addData(p);
  q.make();
  const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) {
    let s = "";
    for (let c = 0; c < n; c++) s += q.isDark(r, c) ? "1" : "0";
    rows.push(s);
  }
  return rows;
});
process.stdout.write(JSON.stringify(out));
"""


def encode_with_node(payloads):
    if not shutil.which("node") or not os.path.exists(ENCODER):
        return None
    with tempfile.TemporaryDirectory() as tmp:
        js = os.path.join(tmp, "dump.js")
        pj = os.path.join(tmp, "payloads.json")
        open(js, "w", encoding="utf-8").write(NODE_SCRIPT)
        json.dump(payloads, open(pj, "w", encoding="utf-8"))
        try:
            raw = subprocess.run(["node", js, ENCODER, pj], check=True,
                                 capture_output=True, timeout=60).stdout
        except Exception as e:
            print("  node failed (%s), falling back to Python" % e)
            return None
    return [[[ch == "1" for ch in row] for row in m] for m in json.loads(raw)]


def encode_with_python(payloads):
    try:
        import qrcode
        from qrcode.constants import ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H
        from qrcode.util import QRData, MODE_8BIT_BYTE
    except ImportError:
        sys.exit("Neither node nor the Python `qrcode` package is available.\n"
                 "Install one:  pip install qrcode")
    try:
        import numpy as np
        import cv2
        checker = cv2.QRCodeDetector()
    except ImportError:
        np = cv2 = checker = None
        print("  OpenCV not installed, so the codes cannot be proof-read. "
              "Scan a few before you trust the card.")

    def build(payload, level):
        q = qrcode.QRCode(version=None, error_correction=level, box_size=1, border=0)
        q.add_data(QRData(payload.encode("utf-8"), mode=MODE_8BIT_BYTE))
        q.make(fit=True)
        return q.get_matrix()

    def reads_back(mods, payload):
        if checker is None:
            return True
        n, s = len(mods), 8
        img = np.full(((n + 8) * s,) * 2, 255, np.uint8)
        for r in range(n):
            for c in range(n):
                if mods[r][c]:
                    img[(r + 4) * s:(r + 5) * s, (c + 4) * s:(c + 5) * s] = 0
        return checker.detectAndDecode(img)[0] == payload

    out = []
    for p in payloads:
        for level in (ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H):
            m = build(p, level)
            if reads_back(m, p):
                out.append([[bool(c) for c in row] for row in m])
                break
        else:
            sys.exit("A payload could not be encoded into a readable code. "
                     "Install node so the site's own encoder can be used.")
    return out


# --- drawing ------------------------------------------------------------

def draw_code(c, mods, x, y, box):
    """x, y is the bottom-left of the box. The quiet zone lives inside it."""
    n = len(mods)
    unit = box / (n + 2 * QUIET)
    c.setFillColor(INK)
    for r in range(n):
        row = mods[r]
        cy = y + box - (r + QUIET + 1) * unit
        run = 0
        for col in range(n + 1):
            dark = col < n and row[col]
            if dark:
                run += 1
                continue
            if run:
                # one rectangle per horizontal run: fewer, cleaner vector ops,
                # and no hairline seams between adjacent modules in a viewer
                c.rect(x + (col - run + QUIET) * unit, cy, run * unit, unit,
                       stroke=0, fill=1)
                run = 0
    return unit


def build_pdf(out_path, only=None):
    doc = json.load(open(DATA, encoding="utf-8"))
    accounts = [a for a in doc.get("accounts", []) if a.get("payload")]
    if only:
        wanted = [k.strip() for k in only.split(",") if k.strip()]
        by_key = {a["key"]: a for a in accounts}
        missing = [k for k in wanted if k not in by_key]
        if missing:
            sys.exit("No code with key: %s\nAvailable: %s"
                     % (", ".join(missing), ", ".join(by_key)))
        accounts = [by_key[k] for k in wanted]
    if not accounts:
        sys.exit("accounts.json holds no codes.")

    print("Encoding %d codes..." % len(accounts))
    payloads = [a["payload"] for a in accounts]
    mats = encode_with_node(payloads)
    print("  encoder: %s" % ("node with the site's qrcode.js, identical to the app"
                             if mats else "Python qrcode, proof-read after drawing"))
    if mats is None:
        mats = encode_with_python(payloads)

    # geometry
    cols, rows, box = choose_grid(len(accounts))
    gutter = ((PAGE_W - 2 * MARGIN_X - cols * box) / (cols - 1)) if cols > 1 else 0
    row_pitch = box + LABEL_BLOCK + ROW_GAP
    grid_h = rows * row_pitch - ROW_GAP
    top = MARGIN_TOP + ((PAGE_H - MARGIN_TOP - MARGIN_BOT) - grid_h) / 2

    worst = min(box / (len(m) + 2 * QUIET) for m in mats) / mm
    iso = isolation_mm(box, box + gutter, row_pitch) / mm
    print("  grid %d x %d | box %.1f mm | gutter %.1f mm | smallest module %.3f mm"
          % (cols, rows, box / mm, gutter / mm, worst))
    print("  one code only while the camera sees under %.0f mm of paper, so hold"
          % iso)
    print("  the phone closer than about %.0f cm." % (iso / FRAME_PER_MM / 10))
    if worst < MIN_MODULE_MM:
        sys.exit("Smallest module is %.3f mm, under the %.2f mm floor. Phones will "
                 "struggle. Remove a code or use landscape." % (worst, MIN_MODULE_MM))

    c = canvas.Canvas(out_path, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("")            # no metadata that names anybody
    c.setAuthor("")
    c.setSubject("")
    c.setCreator("")
    c.setProducer("")

    for i, (a, mods) in enumerate(zip(accounts, mats)):
        col, row = i % cols, i // cols
        x = MARGIN_X + col * (box + gutter)
        y = PAGE_H - top - row * row_pitch - box
        draw_code(c, mods, x, y, box)
        c.setFillColor(LABEL_GREY)
        c.setFont("Courier", 5.2)
        c.drawCentredString(x + box / 2, y - 2.5 * mm, a["key"])

    # corner ticks, for cutting if this is printed on A4
    c.setStrokeColor(FAINT)
    c.setLineWidth(0.25)
    t, off = 3.5 * mm, 5 * mm
    for cx, sx in ((0, 1), (PAGE_W, -1)):
        for cy, sy in ((0, 1), (PAGE_H, -1)):
            c.line(cx + sx * off, cy + sy * off, cx + sx * (off + t), cy + sy * off)
            c.line(cx + sx * off, cy + sy * off, cx + sx * off, cy + sy * (off + t))

    now = datetime.now(MYT)
    c.setFillColor(FAINT)
    c.setFont("Helvetica", 5)
    c.drawCentredString(PAGE_W / 2, 6 * mm,
                        "%d  %02d %s %d" % (len(accounts), now.day,
                                            MONTHS[now.month - 1], now.year))
    c.showPage()
    c.save()
    print("Wrote %s" % out_path)
    return box


# --- how many fit, and how big -----------------------------------------
#
# A slide-over mask cannot work here: to cover an A5 card at every window
# position it would have to be card plus travel, about 260 x 384 mm. So the
# only lever left is spacing, and spacing means fewer codes per page.
#
# The grid is therefore chosen to make each code as large as it can be, and
# the script reports how far away a phone can be and still see only one.

def choose_grid(n):
    """Largest box for n codes on this page, over every sensible grid."""
    best = None
    for cols in range(1, 6):
        rows = -(-n // cols)
        if rows > 8:
            continue
        h = (PAGE_H - MARGIN_TOP - MARGIN_BOT - rows * LABEL_BLOCK
             - (rows - 1) * ROW_GAP) / rows
        w = (PAGE_W - 2 * MARGIN_X - (cols - 1) * MIN_GUTTER) / cols
        box = min(h, w)
        if box <= 0:
            continue
        if best is None or box > best[2]:
            best = (cols, rows, box)
    if best is None:
        sys.exit("%d codes will not fit one A5 page at a usable size." % n)
    return best


def isolation_mm(box, pitch_x, pitch_y):
    """Widest camera frame that still holds only one whole code.

    A neighbour sits `pitch` away and is `box` across, so its far edge is at
    pitch + box/2. A frame centred on this code takes the neighbour in whole
    once its half-width reaches that, i.e. at frame = 2*pitch + box. Anything
    narrower leaves the neighbour clipped, and a clipped code will not decode."""
    return 2 * min(pitch_x, pitch_y) + box


# A phone main camera is about 65 degrees across, so the paper it takes in is
# roughly 1.27 times its distance. Rough, but the right order.
FRAME_PER_MM = 1.274


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1]
        del args[i:i + 2]
    build_pdf(args[0] if args else os.path.join(HERE, "pay-card.pdf"), only)
