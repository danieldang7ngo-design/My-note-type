#!/usr/bin/env python3
"""
Recompute HNA theme JSONs against the v7 token contract
========================================================

For every themes/*.json:

1. WHITELIST: a key is kept only if it exists in the current :root or
   .night-mode token lists of the ROOT _hna_styles_v7.css (the whitelist is
   parsed from the CSS itself, never hardcoded). Any other key is DROPPED and
   reported per theme. Per-theme user knobs (--glass-mesh-opacity,
   --glass-sheen-alpha, --glass-edge-alpha, --glass-crown, --glass-foot,
   --glass-lift-alpha) are kept as-is if present.

2. RECOMPUTE color-derived keys (both modes) from each theme's own palette
   instead of the hardcoded v6-era values:
     --glass-tint-rgb   = --aurora-1 triplet (r, g, b)
     --glass-lift-rgb   = mix(white, aurora-1, 30%)  (light, r, g, b)
                          mix(black, aurora-1, 35%)  (dark,  r, g, b)
     --aurora-card-base = mix(bg-base, aurora-2, 28%) (light only; dark kept)
     --surface-glass    = rgba(var(--glass-tint-rgb), 0.78)
     --surface-elevated = rgba(var(--glass-lift-rgb), 0.88)
     --surface-card     = rgba(var(--aurora-card-base), 0.92)
   Every other whitelisted key is left untouched.

3. WCAG contrast report per theme: --text-muted on the new light
   --glass-lift-rgb and --text-primary on the new light --aurora-card-base
   (target >= 4.5).

4. Formatting is preserved exactly as the existing files (2-space top level,
   4-space nested, existing key order, per-file trailing newline).

Usage:
    python3 recompute_themes.py
"""

import glob
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
THEMES_DIR = os.path.join(SCRIPT_DIR, "themes")
ROOT_CSS = os.path.join(SCRIPT_DIR, "..", "_hna_styles_v7.css")

# Per-theme user knobs: always kept, never recomputed.
KEEP_AS_IS = {
    "--glass-mesh-opacity",
    "--glass-sheen-alpha",
    "--glass-edge-alpha",
    "--glass-crown",
    "--glass-foot",
    "--glass-lift-alpha",
}

# Keys required for recomputation; a theme missing any of these is reported
# and skipped instead of crashing the batch.
REQUIRED = [
    "--aurora-1",
    "--aurora-2",
    "--bg-base",
    "--aurora-accent",
    "--text-primary",
    "--text-muted",
]

RECOMPUTED = [
    "--glass-tint-rgb",
    "--glass-lift-rgb",
    "--aurora-card-base",
    "--surface-glass",
    "--surface-elevated",
    "--surface-card",
]

_GLASS_TINT = "rgba(var(--glass-tint-rgb), 0.78)"
_LIFT_ELEVATED = "rgba(var(--glass-lift-rgb), 0.88)"
def _card_surface(card_base_hex):
    """rgba() with a hex var (rgba(var(--aurora-card-base), .92)) fails
    legacy parsing after substitution in old QtWebEngine, so emit the
    literal triplet of the computed card base."""
    r, g, b = hex_to_rgb(card_base_hex)
    return "rgba(%d, %d, %d, 0.92)" % (r, g, b)


# ----------------------------------------------------------------------
# CSS token extraction (whitelist source of truth)
# ----------------------------------------------------------------------

def extract_block(css_text, selector):
    """Return the text of the first '{...}' block whose opening line starts
    with `selector`, or None. Tracks brace depth so nested braces (e.g. inside
    data URIs) cannot break the extraction."""
    start = None
    depth = 0
    for i, line in enumerate(css_text.splitlines()):
        stripped = line.strip()
        if start is None:
            if stripped.startswith(selector + " ") or stripped == selector + "{":
                if stripped.rstrip().endswith("{"):
                    start = i
                    depth = stripped.count("{") - stripped.count("}")
                    if depth == 0:
                        return css_text.splitlines()[start + 1]
                    continue
        if start is not None:
            depth += stripped.count("{") - stripped.count("}")
            if depth <= 0:
                return "\n".join(css_text.splitlines()[start + 1:i])
    return None


def token_names(block_text):
    """All `--name:` occurrences inside a CSS token block."""
    return set(re.findall(r"(--[a-zA-Z0-9_-]+)\s*:", block_text))


def load_whitelist(css_path):
    """Parse the :root and .night-mode token blocks of the root CSS and return
    the combined whitelist of token names."""
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    light = extract_block(css, ":root")
    dark = extract_block(css, ".night-mode")
    if light is None or dark is None:
        raise RuntimeError("Could not locate :root/.night-mode blocks in " + css_path)
    return token_names(light) | token_names(dark)


# ----------------------------------------------------------------------
# Color math
# ----------------------------------------------------------------------

def hex_to_rgb(hex_color):
    if not isinstance(hex_color, str):
        return None
    m = re.match(r"^#?([0-9a-fA-F]{6})$", hex_color.strip())
    if not m:
        return None
    h = m.group(1)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def mix(base, color, t):
    """t of `color` over `base` (both rgb triplets), rounded."""
    return tuple(int(round(base[i] + t * (color[i] - base[i]))) for i in range(3))


def fmt_triplet(rgb):
    return "{}, {}, {}".format(*rgb)


def linearize(channel):
    c = channel / 255.0
    return ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])


def contrast(fg, bg):
    l1, l2 = luminance(fg), luminance(bg)
    if l1 >= l2:
        return (l1 + 0.05) / (l2 + 0.05)
    return (l2 + 0.05) / (l1 + 0.05)


# ----------------------------------------------------------------------
# JSON serialization (preserve the existing style exactly)
# ----------------------------------------------------------------------

def dump_theme(data, light_order, dark_order, trailing_newline):
    """Serialize a theme dict with 2-space top-level / 4-space nested indent,
    preserving key order and the file's own trailing-newline state."""
    top_keys = list(data.keys())
    lines = ["{"]
    for i, key in enumerate(top_keys):
        comma = "," if i < len(top_keys) - 1 else ""
        if key in ("light", "dark"):
            order = light_order if key == "light" else dark_order
            lines.append('  "{}": {{'.format(key))
            for j, token in enumerate(order):
                inner = "," if j < len(order) - 1 else ""
                lines.append('    "{}": {}{}'.format(
                    token, json.dumps(data[key][token], ensure_ascii=False), inner))
            lines.append("  }" + comma)
        else:
            lines.append('  "{}": {}{}'.format(
                key, json.dumps(data[key], ensure_ascii=False), comma))
    lines.append("}")
    text = "\n".join(lines)
    if trailing_newline:
        text += "\n"
    return text


# ----------------------------------------------------------------------
# Per-theme processing
# ----------------------------------------------------------------------

def recompute_mode(mode, is_light):
    """Drop dead keys and recompute the derived glass/surface/card tokens for
    one mode dict. Returns (new_mode, key_order, dropped, warnings)."""
    mode = dict(mode)
    warnings = []

    dropped = [k for k in mode if k not in WHITELIST]
    for k in dropped:
        del mode[k]

    missing = [k for k in REQUIRED if k not in mode]
    if missing:
        raise ValueError("missing required keys: " + ", ".join(missing))

    aurora1 = hex_to_rgb(mode["--aurora-1"])
    aurora2 = hex_to_rgb(mode["--aurora-2"])
    bg_base = hex_to_rgb(mode["--bg-base"])
    accent = hex_to_rgb(mode["--aurora-accent"])
    if None in (aurora1, aurora2, bg_base, accent):
        raise ValueError("aurora/bg keys are not #RRGGBB hex")

    existing_tint = mode.get("--glass-tint-rgb")
    if existing_tint and tuple(int(x.strip()) for x in existing_tint.split(",")) != aurora1:
        warnings.append("--glass-tint-rgb did not match --aurora-1 (recomputed)")

    mode["--glass-tint-rgb"] = fmt_triplet(aurora1)
    if is_light:
        mode["--glass-lift-rgb"] = fmt_triplet(mix((255, 255, 255), aurora1, 0.30))
        mode["--aurora-card-base"] = rgb_to_hex(mix(bg_base, aurora2, 0.28))
    else:
        mode["--glass-lift-rgb"] = fmt_triplet(mix((0, 0, 0), aurora1, 0.35))
    mode["--surface-glass"] = _GLASS_TINT
    mode["--surface-elevated"] = _LIFT_ELEVATED
    mode["--surface-card"] = _card_surface(mode["--aurora-card-base"])

    order = [k for k in mode if k != "--glass-lift-rgb"]
    if "--glass-tint-rgb" in order:
        order.insert(order.index("--glass-tint-rgb") + 1, "--glass-lift-rgb")
    else:
        order.append("--glass-lift-rgb")

    return mode, order, dropped, warnings


def parse_triplet(text):
    if not isinstance(text, str):
        return None
    try:
        parts = [int(x.strip()) for x in text.split(",")]
    except ValueError:
        return None
    if len(parts) != 3 or not all(0 <= p <= 255 for p in parts):
        return None
    return tuple(parts)


def contrast_report(theme):
    """WCAG check: light --text-muted vs light --glass-lift-rgb and light
    --text-primary vs light --aurora-card-base (target >= 4.5)."""
    light = theme["light"]
    rows = []
    lift_rgb = parse_triplet(light["--glass-lift-rgb"])
    if lift_rgb is not None:
        muted = hex_to_rgb(light["--text-muted"])
        if muted is not None:
            rows.append(("text-muted vs lift (light)", contrast(muted, lift_rgb)))
    card = hex_to_rgb(light["--aurora-card-base"])
    if card is not None:
        primary = hex_to_rgb(light["--text-primary"])
        if primary is not None:
            rows.append(("text-primary vs card-base (light)", contrast(primary, card)))
    return rows


def grade(ratio):
    if ratio >= 4.5:
        return "PASS"
    if ratio >= 3.0:
        return "WARN"
    return "FAIL"


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main():
    global WHITELIST

    if not os.path.isfile(ROOT_CSS):
        print("[LOI] Khong tim thay CSS goc tai: {}".format(ROOT_CSS))
        sys.exit(1)
    WHITELIST = load_whitelist(ROOT_CSS)
    print("Whitelist: {} token names parsed from :root/.night-mode of {}".format(
        len(WHITELIST), os.path.basename(ROOT_CSS)))

    paths = sorted(glob.glob(os.path.join(THEMES_DIR, "*.json")))
    if not paths:
        print("[LOI] Khong co theme JSON nao trong themes/")
        sys.exit(1)

    dropped_all = {}
    errors = []
    tint_mismatches = 0
    summaries = {"muted_lift": {"PASS": 0, "WARN": 0, "FAIL": 0, "SKIP": 0},
                 "primary_card": {"PASS": 0, "WARN": 0, "FAIL": 0, "SKIP": 0}}

    for path in paths:
        slug = os.path.basename(path)[:-5]
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
                data = json.loads(raw)
        except (json.JSONDecodeError, OSError) as e:
            errors.append("{}: cannot read ({})".format(slug, e))
            continue

        trailing = raw.endswith("\n")
        light_order = list(data["light"].keys())
        dark_order = list(data["dark"].keys())

        try:
            new_light, light_order, dropped_light, warn_light = recompute_mode(data["light"], True)
            new_dark, dark_order, dropped_dark, warn_dark = recompute_mode(data["dark"], False)
        except (ValueError, KeyError) as e:
            errors.append("{}: skipped ({})".format(slug, e))
            continue

        dropped = dropped_light + dropped_dark
        if dropped:
            dropped_all[slug] = dropped

        data["light"] = new_light
        data["dark"] = new_dark

        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(dump_theme(data, light_order, dark_order, trailing))

        print("== {} ==".format(slug))
        if dropped:
            print("  dropped: " + ", ".join(sorted(set(dropped))))
        for w in warn_light + warn_dark:
            if w.startswith("--glass-tint-rgb"):
                tint_mismatches += 1
                continue
            print("  [!] " + w)
        for label, ratio in contrast_report(data):
            g = grade(ratio)
            summaries["muted_lift" if "muted" in label else "primary_card"][g] += 1
            print("  contrast {}: {:.2f}:1  {}".format(label, ratio, g))

    print()
    print("=" * 60)
    print("TOTAL: {} themes processed".format(len(paths) - len(errors)))
    if tint_mismatches:
        print("Stale --glass-tint-rgb (was != --aurora-1, now derived): {} of {} modes".format(
            tint_mismatches, (len(paths) - len(errors)) * 2))
    if errors:
        print("ERRORS ({}):".format(len(errors)))
        for e in errors:
            print("  - " + e)
    all_dropped = {}
    for keys in dropped_all.values():
        for k in keys:
            all_dropped[k] = all_dropped.get(k, 0) + 1
    if all_dropped:
        print("Dropped keys across themes (key: theme count):")
        for k in sorted(all_dropped):
            print("  {}: {}".format(k, all_dropped[k]))
    for target, counts in summaries.items():
        print("{} -> PASS:{} WARN:{} FAIL:{} SKIP:{}".format(
            target, counts["PASS"], counts["WARN"], counts["FAIL"], counts["SKIP"]))


if __name__ == "__main__":
    main()