#!/usr/bin/env python3
"""
Anki Note Type Theme Switcher
==============================
Doi mau theme (chi mau sac - khong dong den layout/HTML/JS) cho mot
note type Anki, thong qua addon AnkiConnect.

KHONG can cai them thu vien nao (chi dung thu vien chuan cua Python:
urllib, json, re, datetime). Yeu cau duy nhat: Anki dang mo va da
cai addon AnkiConnect (code: 2055492159).

Cach chay:
    python3 apply_theme.py

Xem README.md de biet cach tao theme moi.
"""

import base64
import json
import os
import platform
import re
import sys
import random
import urllib.request
import urllib.error
from datetime import datetime

ANKI_CONNECT_URL = "http://127.0.0.1:8765"
ANKI_CONNECT_VERSION = 6
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
THEMES_DIR = os.path.join(SCRIPT_DIR, "themes")
BACKUPS_DIR = os.path.join(SCRIPT_DIR, "backups")

MARKER_START = "/* === THEME:{slug}:START === */"
MARKER_END = "/* === THEME:{slug}:END === */"
# Regex nhan dien BAT KY khoi theme nao da duoc chen truoc do (de go bo
# truoc khi chen khoi moi), bat ke slug la gi.
ANY_MARKER_BLOCK_RE = re.compile(
    r"\n?/\* === THEME:[a-zA-Z0-9_\-]+:START === \*/.*?/\* === THEME:[a-zA-Z0-9_\-]+:END === \*/\n?",
    re.DOTALL,
)

# Cho phep tat mau bang bien moi truong NO_COLOR (quy uoc chuan: no-color.org)
# hoac khi output khong phai la mot terminal thuc su (vd bi redirect ra file).
USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def enable_windows_ansi():
    """Bat ho tro ANSI truecolor tren cmd.exe / PowerShell doi cu (Windows 10+).
    Cac terminal khac (macOS, Linux, Windows Terminal moi) da ho tro san."""
    if platform.system() != "Windows":
        return
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            # 0x0004 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        # Neu khong bat duoc thi thoi, chi la mat phan mau, khong anh huong chuc nang
        pass


# ----------------------------------------------------------------------
# Color-swatch helpers (hien mau truc quan trong menu chon theme)
# ----------------------------------------------------------------------

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def hex_to_rgb(hex_color):
    """'#12805B' -> (18, 128, 91). Tra ve None neu khong phai hex hop le
    (vd theme dung rgba(...) cho key nay thay vi hex)."""
    if not isinstance(hex_color, str):
        return None
    m = _HEX_RE.match(hex_color.strip())
    if not m:
        return None
    h = m.group(1)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ansi_block(hex_color, chars="██"):
    """Tra ve mot khoi ky tu duoc to mau ANSI truecolor giong het ma hex dua vao.
    Neu mau khong hop le hoac terminal khong ho tro mau -> tra ve khoang trang
    cung do rong de menu khong bi lech."""
    rgb = hex_to_rgb(hex_color)
    if not USE_COLOR or rgb is None:
        return " " * len(chars)
    r, g, b = rgb
    return "\033[38;2;{};{};{}m{}\033[0m".format(r, g, b, chars)


def theme_swatch(theme):
    """Ghep 4 khoi mau dai dien cho theme: nen + accent, cho ca light & dark.
    Giup nguoi dung hinh dung nhanh 'theme nay mau gi' ngay trong menu CLI,
    khong can mo file .json ra xem."""
    light = theme.get("light", {})
    dark = theme.get("dark", {})
    parts = [
        ansi_block(light.get("--bg-base"), "██"),
        ansi_block(light.get("--aurora-accent"), "██"),
        ansi_block(dark.get("--bg-base"), "██"),
        ansi_block(dark.get("--aurora-accent"), "██"),
    ]
    return "".join(parts)


# ----------------------------------------------------------------------
# AnkiConnect helpers
# ----------------------------------------------------------------------

def invoke(action, **params):
    payload = json.dumps({"action": action, "version": ANKI_CONNECT_VERSION, "params": params}).encode("utf-8")
    req = urllib.request.Request(ANKI_CONNECT_URL, payload, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise ConnectionError(
            "Khong ket noi duoc AnkiConnect tai {}.\n"
            "  -> Hay chac chan: (1) Anki dang MO, (2) da cai addon AnkiConnect "
            "(code 2055492159), (3) da restart Anki sau khi cai.\n"
            "  Chi tiet loi: {}".format(ANKI_CONNECT_URL, e)
        )
    if len(body) != 2:
        raise RuntimeError("Phan hoi AnkiConnect khong hop le: " + str(body))
    if body.get("error") is not None:
        raise RuntimeError("AnkiConnect bao loi: " + str(body["error"]))
    return body["result"]


# ----------------------------------------------------------------------
# Theme file helpers
# ----------------------------------------------------------------------

def load_themes():
    """Doc tat ca *.json trong themes/ (bo qua file bat dau bang '_')."""
    themes = []
    if not os.path.isdir(THEMES_DIR):
        return themes
    for fname in sorted(os.listdir(THEMES_DIR)):
        if not fname.endswith(".json") or fname.startswith("_"):
            continue
        path = os.path.join(THEMES_DIR, fname)
        slug = fname[:-5]
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print("  [!] Bo qua {} (loi doc file: {})".format(fname, e))
            continue
        if "light" not in data or "dark" not in data:
            print("  [!] Bo qua {} (thieu key 'light' hoac 'dark')".format(fname))
            continue
        themes.append({
            "slug": slug,
            "name": data.get("name", slug),
            "description": data.get("description", ""),
            "light": data["light"],
            "dark": data["dark"],
        })
    return themes


def build_css_block(slug, light_vars, dark_vars):
    """Sinh khoi CSS ghi de tu dung nhung bien co trong file theme JSON.

    CSS (_hna_styles_v6.css) la nguon chuan duy nhat cho danh sach bien mau.
    Script KHONG tu them/doan bat ky bien nao ngoai nhung gi theme JSON khai
    bao — neu mot theme muon override bien nao (vd --aurora-1, --bg-base,
    --text-primary, --surface-glass...) thi phai khai ro trong file JSON cua
    no, dung dung ten bien nhu trong CSS. Bien nao theme khong khai se giu
    nguyen gia tri goc dinh nghia san trong CSS.

    NGOAI LE: 3 token mesh nen fullscreen (--aurora-mesh-blobs,
    --aurora-mesh-curtain, --constellation-layer) luon duoc sinh tu dong
    boi build_mesh_css_vars() tu palette cua theme (xem phan Mesh art
    generation) va duoc merge vao day truoc khi tao block — theme JSON
    khong can (va khong nen) khai chung.

    Moi bien duoc ghi kem !important: file CSS ngoai trong collection.media
    van con khoi :root/.night-mode mac dinh (dung lam fallback khi Anki
    Styling con trong), va tuy vao thu tu nap file trong template, khoi do
    co the thang cascade truoc ca Anki Styling du cung specificity. Dung
    !important dam bao Anki Styling (noi script ghi de) LUON thang, bat ke
    file ngoai nap truoc hay sau.
    """
    def fmt(vars_dict):
        lines = ["    {}: {} !important;".format(k, v) for k, v in vars_dict.items()]
        return "\n".join(lines)

    block = (
        MARKER_START.format(slug=slug) + "\n"
        + ":root {\n" + fmt(light_vars) + "\n}\n\n"
        + ".night-mode {\n" + fmt(dark_vars) + "\n}\n"
        + MARKER_END.format(slug=slug)
    )
    return block


def strip_existing_theme_block(css_text):
    """Xoa khoi theme (bat ky slug nao) da ton tai trong CSS, tra ve CSS sach."""
    return ANY_MARKER_BLOCK_RE.sub("\n", css_text).rstrip() + "\n"


# ----------------------------------------------------------------------
# Mesh art generation (v7 fullscreen background layers)
# ----------------------------------------------------------------------
# _hna_styles_v7.css ships default renders of --aurora-mesh-blobs /
# --aurora-mesh-curtain / --constellation-layer, but they are per-theme art:
# regenerate them here from the theme's --aurora-1/--aurora-2/
# --aurora-accent hexes and --blob-a/b/c/d-rgb triplets so switching theme
# recolors the fullscreen background too, not just the card.
# Geometry/opacities mirror the scratch templates (aurora-mesh-blobs-*.svg,
# aurora-mesh-curtain-*.svg, constellation-*.svg).


def rgb_to_hex(rgb):
    """(18, 128, 91) -> '#12805B'."""
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def parse_rgb_triplet(text):
    """'179, 202, 212' (or '179,202,212') -> (179, 202, 212).
    Tra ve None neu khong phai bo ba so hop le."""
    if not isinstance(text, str):
        return None
    try:
        parts = [int(x.strip()) for x in text.split(",")]
    except ValueError:
        return None
    if len(parts) != 3 or not all(0 <= p <= 255 for p in parts):
        return None
    return tuple(parts)


def mix_hex(base_hex, color_hex, t):
    """Pha `t` cua color_hex len tren base_hex -> '#RRGGBB'."""
    base = hex_to_rgb(base_hex)
    color = hex_to_rgb(color_hex)
    if base is None or color is None:
        raise ValueError("mix_hex can hai mau hex hop le")
    return rgb_to_hex(tuple(int(round(base[i] + t * (color[i] - base[i]))) for i in range(3)))


def _data_uri(svg_text):
    """Ma hoa SVG thanh url(\"data:image/svg+xml;base64,...\") (nhan doi trong url)."""
    encoded = base64.b64encode(svg_text.encode("utf-8")).decode("ascii")
    return 'url("data:image/svg+xml;base64,{}")'.format(encoded)


# --- Blobs: 6 ellipses blurred, giong aurora-mesh-blobs-*.svg ---

_BLOB_LINES = [
    '    <ellipse cx="190"  cy="150"  rx="520" ry="420" fill="{0}" opacity="0.26"/>',
    '    <ellipse cx="1730" cy="170"  rx="480" ry="400" fill="{0}" opacity="0.22"/>',
    '    <ellipse cx="1760" cy="980"  rx="520" ry="420" fill="{0}" opacity="0.20"/>',
    '    <ellipse cx="170"  cy="960"  rx="480" ry="380" fill="{0}" opacity="0.20"/>',
    '    <ellipse cx="960"  cy="540"  rx="640" ry="470" fill="{0}" opacity="0.13"/>',
    '    <ellipse cx="960"  cy="20"   rx="700" ry="260" fill="{0}" opacity="0.16"/>',
]


def _mesh_blobs_svg(mode):
    """6 blob: blob-a/b/c/d-rgb (chuyen sang hex), accent, aurora-1."""
    fills = []
    for key in ("--blob-a-rgb", "--blob-b-rgb", "--blob-c-rgb", "--blob-d-rgb"):
        t = parse_rgb_triplet(mode.get(key))
        if t is None:
            raise ValueError("thieu/hong " + key)
        fills.append(rgb_to_hex(t))
    for key in ("--aurora-accent", "--aurora-1"):
        if hex_to_rgb(mode.get(key)) is None:
            raise ValueError("thieu/hong " + key)
        fills.append(mode[key])
    body = "\n".join(line.format(fill) for line, fill in zip(_BLOB_LINES, fills))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">\n'
        '  <defs>\n'
        '    <filter id="inkBlur" x="-60%" y="-60%" width="220%" height="220%">\n'
        '      <feGaussianBlur stdDeviation="110"/>\n'
        '    </filter>\n'
        '  </defs>\n'
        '  <g filter="url(#inkBlur)">\n'
        + body + "\n"
        '  </g>\n'
        '</svg>'
    )


# --- Curtain: 3 ribbon gradients + skyGlow, giong aurora-mesh-curtain-*.svg ---
# (0% / 32% / 68%) cho ribGrad1, (0% / 45%) cho ribGrad2,
# (0% / 55%) cho ribGrad3 va skyGlow.
_CURTAIN_OPACITIES = {
    # light: cac opacity "calmed" cua aurora-mesh-curtain-0.svg
    "light": ((0.38, 0.26, 0.12), (0.24, 0.18), (0.18, 0.10), (0.22, 0.09)),
    # dark: opacity ban dem cua aurora-mesh-curtain-1.svg
    "dark": ((0.62, 0.44, 0.20), (0.40, 0.30), (0.30, 0.16), (0.35, 0.14)),
}

_CURTAIN_SKELETON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
  <defs>
{ribbon_defs}
    <filter id="curtain1" x="-40%" y="-70%" width="180%" height="300%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.028" numOctaves="2" seed="7" stitchTiles="stitch" result="n1"/>
      <feDisplacementMap in="SourceGraphic" in2="n1" scale="70" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <filter id="curtain2" x="-40%" y="-70%" width="180%" height="300%">
      <feTurbulence type="fractalNoise" baseFrequency="0.005 0.024" numOctaves="2" seed="19" stitchTiles="stitch" result="n2"/>
      <feDisplacementMap in="SourceGraphic" in2="n2" scale="85" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="11"/>
    </filter>
    <filter id="curtain3" x="-40%" y="-70%" width="180%" height="300%">
      <feTurbulence type="fractalNoise" baseFrequency="0.007 0.03" numOctaves="2" seed="31" stitchTiles="stitch" result="n3"/>
      <feDisplacementMap in="SourceGraphic" in2="n3" scale="60" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="13"/>
    </filter>
    <filter id="starGlow" x="-250%" y="-250%" width="600%" height="600%">
      <feGaussianBlur stdDeviation="0.9"/>
    </filter>
  </defs>

  <!-- Ambient sky glow, brightest near the top -->
  <ellipse cx="960" cy="-20" rx="980" ry="360" fill="url(#skyGlow)"/>

  <!-- Flowing aurora curtain bands — static, organic edges via fixed-seed noise displacement -->
  <g filter="url(#curtain1)">
    <path fill="url(#ribGrad1)" d="M -100,170 C 150,70 350,240 620,140 C 900,20 1150,210 1420,105 C 1650,20 1820,150 2020,85
      L 2020,300 C 1820,365 1650,240 1420,320 C 1150,415 900,225 620,340 C 350,445 150,275 -100,375 Z"/>
  </g>
  <g filter="url(#curtain2)">
    <path fill="url(#ribGrad2)" d="M -100,400 C 200,320 460,470 760,370 C 1060,270 1310,440 1610,355
      C 1790,300 1900,395 2020,330 L 2020,520 C 1900,560 1790,500 1610,545 C 1310,610 1060,470 760,560
      C 460,645 200,515 -100,575 Z"/>
  </g>
  <g filter="url(#curtain3)" opacity="0.85">
    <path fill="url(#ribGrad3)" d="M -100,555 C 250,495 500,625 820,540 C 1150,455 1400,585 1700,515
      C 1850,480 1950,560 2020,525 L 2020,690 C 1950,715 1850,650 1700,690 C 1400,745 1150,610 820,695
      C 500,750 250,660 -100,715 Z"/>
  </g>

  <!-- Chòm sao trang trí — tĩnh, mỗi ngôi sao có quầng sáng nhẹ -->
  <g stroke="#EAF4FF" stroke-width="0.9" stroke-opacity="0.32" fill="none">
    <polyline points="128,652 190,628 258,644 320,682 298,742 228,760 168,730"/>
    <polyline points="1498,762 1558,700 1620,750 1682,690 1742,742"/>
    <polyline points="856,900 948,828 1000,890 856,900"/>
  </g>
  <g fill="#F4FAFF">
    <g>
      <circle cx="128" cy="652" r="4.2" opacity="0.22" filter="url(#starGlow)"/><circle cx="128" cy="652" r="1.7"/>
      <circle cx="190" cy="628" r="3.6" opacity="0.20" filter="url(#starGlow)"/><circle cx="190" cy="628" r="1.4"/>
      <circle cx="258" cy="644" r="4.0" opacity="0.22" filter="url(#starGlow)"/><circle cx="258" cy="644" r="1.6"/>
      <circle cx="320" cy="682" r="4.6" opacity="0.24" filter="url(#starGlow)"/><circle cx="320" cy="682" r="1.9"/>
      <circle cx="298" cy="742" r="3.6" opacity="0.20" filter="url(#starGlow)"/><circle cx="298" cy="742" r="1.4"/>
      <circle cx="228" cy="760" r="4.0" opacity="0.22" filter="url(#starGlow)"/><circle cx="228" cy="760" r="1.6"/>
      <circle cx="168" cy="730" r="3.4" opacity="0.18" filter="url(#starGlow)"/><circle cx="168" cy="730" r="1.3"/>
    </g>
    <g>
      <circle cx="1498" cy="762" r="4.0" opacity="0.20" filter="url(#starGlow)"/><circle cx="1498" cy="762" r="1.6"/>
      <circle cx="1558" cy="700" r="4.4" opacity="0.24" filter="url(#starGlow)"/><circle cx="1558" cy="700" r="1.8"/>
      <circle cx="1620" cy="750" r="3.8" opacity="0.20" filter="url(#starGlow)"/><circle cx="1620" cy="750" r="1.5"/>
      <circle cx="1682" cy="690" r="4.4" opacity="0.24" filter="url(#starGlow)"/><circle cx="1682" cy="690" r="1.8"/>
      <circle cx="1742" cy="742" r="3.6" opacity="0.18" filter="url(#starGlow)"/><circle cx="1742" cy="742" r="1.4"/>
    </g>
    <g>
      <circle cx="856" cy="900" r="3.6" opacity="0.18" filter="url(#starGlow)"/><circle cx="856" cy="900" r="1.4"/>
      <circle cx="948" cy="828" r="4.2" opacity="0.22" filter="url(#starGlow)"/><circle cx="948" cy="828" r="1.7"/>
      <circle cx="1000" cy="890" r="3.4" opacity="0.18" filter="url(#starGlow)"/><circle cx="1000" cy="890" r="1.3"/>
    </g>
    <circle cx="1220" cy="600" r="3.2" opacity="0.16" filter="url(#starGlow)"/><circle cx="1220" cy="600" r="1.2"/>
    <circle cx="540" cy="560" r="3.2" opacity="0.16" filter="url(#starGlow)"/><circle cx="540" cy="560" r="1.2"/>
  </g>
</svg>"""


def _curtain_ribbon_defs(mode, is_light):
    aurora1 = mode.get("--aurora-1")
    aurora2 = mode.get("--aurora-2")
    accent = mode.get("--aurora-accent")
    blob_b = mode.get("--blob-b-rgb")
    blob_c = mode.get("--blob-c-rgb")
    for label, value in (("--aurora-1", aurora1), ("--aurora-2", aurora2),
                         ("--aurora-accent", accent)):
        if hex_to_rgb(value) is None:
            raise ValueError("thieu/hong " + label)
    blob_b = parse_rgb_triplet(blob_b)
    blob_c = parse_rgb_triplet(blob_c)
    if blob_b is None or blob_c is None:
        raise ValueError("thieu/hong --blob-b-rgb/--blob-c-rgb")

    (r1, r2, r3, glow) = _CURTAIN_OPACITIES["light" if is_light else "dark"]
    def stop(offset, color, opacity, pad=False):
        # Can le cot offset giong template (chi trong 3 ribbon gradient,
        # skyGlow khong can) de cac cot stop-color thang hang.
        attr = 'offset="{}"'.format(offset)
        if pad:
            attr += " "
        return '      <stop {} stop-color="{}" stop-opacity="{}"/>'.format(
            attr, color, opacity)

    def fmt(o):
        return "{:.2f}".format(o)

    b_hex = rgb_to_hex(blob_b)
    c_hex = rgb_to_hex(blob_c)
    lines = [
        '    <linearGradient id="ribGrad1" x1="0.05" y1="0" x2="0.85" y2="1">',
        stop("0%", aurora1, fmt(r1[0]), pad=True),
        stop("32%", accent, fmt(r1[1])),
        stop("68%", c_hex, fmt(r1[2])),
        stop("100%", c_hex, "0"),
        '    </linearGradient>',
        '    <linearGradient id="ribGrad2" x1="0" y1="0.1" x2="1" y2="0.9">',
        stop("0%", c_hex, fmt(r2[0]), pad=True),
        stop("45%", b_hex, fmt(r2[1])),
        stop("100%", b_hex, "0"),
        '    </linearGradient>',
        '    <linearGradient id="ribGrad3" x1="0.1" y1="0" x2="0.9" y2="1">',
        stop("0%", aurora2, fmt(r3[0]), pad=True),
        stop("55%", accent, fmt(r3[1])),
        stop("100%", accent, "0"),
        '    </linearGradient>',
        '    <radialGradient id="skyGlow" cx="50%" cy="-4%" r="65%">',
        stop("0%", aurora1, fmt(glow[0])),
        stop("55%", accent, fmt(glow[1])),
        stop("100%", accent, "0"),
        '    </radialGradient>',
        '',
    ]
    return "\n".join(lines)


def _mesh_curtain_svg(mode, is_light):
    ribbon_defs = _curtain_ribbon_defs(mode, is_light)
    return _CURTAIN_SKELETON.format(ribbon_defs=ribbon_defs)


# --- Constellation: single-color lines + stars, giong constellation-*.svg ---

_CONSTELLATION_POLYLINES = [
    '150,90 240,120 330,95 415,135 470,215 400,265 320,235',
    '690,70 760,140 840,80 915,150 990,85',
    '1480,140 1560,110 1640,150',
    '1560,110 1520,50',
    '1640,150 1690,230',
    '220,470 290,430 350,490 280,530 220,470',
    '900,430 960,560',
    '830,490 1030,490',
    '1420,640 1500,690 1580,700 1650,760 1700,840',
    '260,800 380,760 340,880 260,800',
    '1760,420 1840,470',
    '560,900 650,860 730,915',
]

_CONSTELLATION_MAIN_CIRCLES = [
    ('150', '90', '2.2'), ('240', '120', '1.9'), ('330', '95', '2.4'),
    ('415', '135', '2'), ('470', '215', '2.3'), ('400', '265', '1.8'),
    ('320', '235', '2'), ('690', '70', '2.1'), ('760', '140', '2.4'),
    ('840', '80', '1.9'), ('915', '150', '2.3'), ('990', '85', '2'),
    ('1480', '140', '2.2'), ('1560', '110', '2.6'), ('1640', '150', '2.2'),
    ('1520', '50', '1.9'), ('1690', '230', '2'), ('220', '470', '2'),
    ('290', '430', '2.3'), ('350', '490', '1.9'), ('280', '530', '2.1'),
    ('900', '430', '2.4'), ('960', '560', '2'), ('830', '490', '1.9'),
    ('1030', '490', '2.1'), ('1420', '640', '2'), ('1500', '690', '2.3'),
    ('1580', '700', '1.9'), ('1650', '760', '2.2'), ('1700', '840', '2'),
    ('260', '800', '2.1'), ('380', '760', '2.4'), ('340', '880', '1.9'),
    ('1760', '420', '2.2'), ('1840', '470', '1.9'), ('560', '900', '2'),
    ('650', '860', '2.3'), ('730', '915', '1.9'),
]

_CONSTELLATION_FAINT_CIRCLES = [
    ('100', '300', '1.4'), ('480', '420', '1.2'), ('620', '250', '1.5'),
    ('1100', '300', '1.3'), ('1250', '180', '1.4'), ('1350', '560', '1.2'),
    ('1150', '760', '1.5'), ('900', '700', '1.3'), ('500', '620', '1.4'),
    ('1800', '700', '1.2'), ('80', '650', '1.4'), ('1900', '180', '1.3'),
    ('700', '480', '1.2'), ('1550', '380', '1.4'), ('300', '150', '1.3'),
    ('1050', '950', '1.4'), ('430', '990', '1.2'), ('1450', '950', '1.3'),
    ('170', '1000', '1.2'), ('1870', '930', '1.4'),
]


def _constellation_svg(color_hex, stroke_opacity, main_opacity, faint_opacity):
    polylines = "".join("<polyline points='{}'/>".format(p) for p in _CONSTELLATION_POLYLINES)
    main = "".join("<circle cx='{}' cy='{}' r='{}'/>".format(*t) for t in _CONSTELLATION_MAIN_CIRCLES)
    faint = "".join("<circle cx='{}' cy='{}' r='{}'/>".format(*t) for t in _CONSTELLATION_FAINT_CIRCLES)
    return (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080'>"
        "<g fill='none' stroke='{c}' stroke-opacity='{so}' stroke-width='1.1' "
        "stroke-linecap='round' stroke-linejoin='round'>{poly}</g>"
        "<g fill='{c}' fill-opacity='{mo}'>{main}</g>"
        "<g fill='{c}' fill-opacity='{fo}'>{faint}</g>"
        "</svg>"
    ).format(c=color_hex, so=stroke_opacity, poly=polylines,
             mo=main_opacity, main=main, fo=faint_opacity, faint=faint)


def build_mesh_css_vars(light, dark):
    """Sinh lai 3 token mesh nen fullscreen cho CA HAI mode tu palette cua theme.

    Tra ve (light_vars, dark_vars) — moi cai la dict
    {token_name: 'url("data:image/svg+xml;base64,...")'} cho
    --aurora-mesh-blobs / --aurora-mesh-curtain / --constellation-layer.
    """
    light_blobs = _mesh_blobs_svg(light)
    light_curtain = _mesh_curtain_svg(light, True)
    light_accent = light.get("--aurora-accent")
    if hex_to_rgb(light_accent) is None:
        raise ValueError("thieu/hong light --aurora-accent")
    light_const = _constellation_svg(light_accent, ".20", ".34", ".18")

    dark_blobs = _mesh_blobs_svg(dark)
    dark_curtain = _mesh_curtain_svg(dark, False)
    dark_accent = dark.get("--aurora-accent")
    if hex_to_rgb(dark_accent) is None:
        raise ValueError("thieu/hong dark --aurora-accent")
    # Ban dem dung mau accent pha sang (~12% white) nhu constellation-1.svg.
    dark_tint = mix_hex("#FFFFFF", dark_accent, 0.12)
    dark_const = _constellation_svg(dark_tint, ".22", ".62", ".30")

    return (
        {
            "--aurora-mesh-blobs": _data_uri(light_blobs),
            "--aurora-mesh-curtain": _data_uri(light_curtain),
            "--constellation-layer": _data_uri(light_const),
        },
        {
            "--aurora-mesh-blobs": _data_uri(dark_blobs),
            "--aurora-mesh-curtain": _data_uri(dark_curtain),
            "--constellation-layer": _data_uri(dark_const),
        },
    )


# ----------------------------------------------------------------------
# CLI helpers
# ----------------------------------------------------------------------

def choose_from_list(items, label_fn, prompt, allow_zero=None, allow_random=False):
    print()
    if allow_zero is not None:
        print("  [0] {}".format(allow_zero))
    if allow_random:
        print("  [R] Chon theme ngau nhien")
    for i, item in enumerate(items, start=1):
        print("  [{}] {}".format(i, label_fn(item)))
    print()
    while True:
        raw = input(prompt).strip()
        if allow_zero is not None and raw == "0":
            return None
        if allow_random and raw.upper() == "R":
            return random.choice(items) if items else None
        if raw.isdigit() and 1 <= int(raw) <= len(items):
            return items[int(raw) - 1]
        print("  -> Nhap so trong danh sach tren, 0, hoac R cho ngau nhien.")


def backup_styling(model_name, css_text):
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = re.sub(r"[^a-zA-Z0-9_\-]+", "_", model_name)
    path = os.path.join(BACKUPS_DIR, "{}_{}.css".format(safe_name, ts))
    with open(path, "w", encoding="utf-8") as f:
        f.write(css_text)
    return path


# ----------------------------------------------------------------------
# Main flow
# ----------------------------------------------------------------------

def main():
    enable_windows_ansi()
    print("=" * 60)
    print(" ANKI NOTE TYPE THEME SWITCHER")
    print("=" * 60)

    print("\n[1/5] Dang ket noi AnkiConnect...")
    try:
        invoke("version")
    except ConnectionError as e:
        print("\n[LOI]", e)
        sys.exit(1)
    print("      OK.")

    print("\n[2/5] Dang lay danh sach note type...")
    model_names = invoke("modelNames")
    if not model_names:
        print("Khong tim thay note type nao trong Anki.")
        sys.exit(1)

    model_name = choose_from_list(
        model_names, lambda m: m, "Chon note type (nhap so): "
    )
    print("      Da chon: {}".format(model_name))

    print("\n[3/5] Dang doc thu vien theme...")
    themes = load_themes()
    if not themes:
        print("Khong tim thay theme nao trong thu muc 'themes/'. "
              "Xem README.md de biet cach tao theme.")
        sys.exit(1)

    def theme_label(t):
        swatch = theme_swatch(t)
        label = "{}  {}".format(swatch, t["name"])
        if t["description"]:
            label += "  -  {}".format(t["description"])
        return label

    if USE_COLOR:
        print("\n      (4 o mau truoc ten theme = nen-sang | accent-sang | nen-toi | accent-toi)")
    theme = choose_from_list(
        themes, theme_label, "Chon theme (nhap so, R cho ngau nhien, hoac 0 de KHOI PHUC MAC DINH goc): ",
        allow_zero="Khoi phuc mac dinh goc (go theme dang ap dung)",
        allow_random=True,
    )

    print("\n[4/5] Dang doc CSS hien tai cua note type & sao luu...")
    current_css = invoke("modelStyling", modelName=model_name)["css"]
    backup_path = backup_styling(model_name, current_css)
    print("      Da sao luu ban goc tai: {}".format(backup_path))

    cleaned_css = strip_existing_theme_block(current_css)

    if theme is None:
        new_css = cleaned_css
        applied_label = "mac dinh goc (khong theme)"
    else:
        light_vars = dict(theme["light"])
        dark_vars = dict(theme["dark"])
        try:
            mesh_light, mesh_dark = build_mesh_css_vars(light_vars, dark_vars)
        except (KeyError, ValueError) as e:
            print("  [!] Khong sinh duoc mesh art tu theme nay "
                  "(van dung mesh mac dinh cua CSS): {}".format(e))
            mesh_light, mesh_dark = {}, {}
        light_vars.update(mesh_light)
        dark_vars.update(mesh_dark)
        block = build_css_block(theme["slug"], light_vars, dark_vars)
        new_css = cleaned_css.rstrip() + "\n\n" + block + "\n"
        applied_label = theme["name"]

    print("\n[5/5] Dang ghi styling moi vao Anki...")
    invoke("updateModelStyling", model={"name": model_name, "css": new_css})

    print("\n" + "=" * 60)
    print(" XONG! Da ap dung theme: {}".format(applied_label))
    print(" note type: {}".format(model_name))
    print("=" * 60)
    print("\n>>> Hay DONG HAN Anki roi MO LAI de thay thay doi <<<\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n(Da huy.)")
        sys.exit(1)
    except RuntimeError as e:
        print("\n[LOI]", e)
        sys.exit(1)
