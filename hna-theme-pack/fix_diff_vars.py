#!/usr/bin/env python3
"""Add --diff-* variables to all theme JSON files with consistent semantic colors.

These variables exist in _hna_styles_v7.css with hardcoded light/dark values
but are missing from all theme JSONs. We add them with the same values across
all themes to keep semantic color signals (correct=green, wrong=red, etc.)
consistent regardless of theme choice.
"""
import json, glob, os

THEMES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "themes")

DIFF_COLORS = {
    # Light block must agree with the shipped CSS :root values (line ~236-246
    # of _hna_styles_v7.css). All text tokens clear 4.5:1 and all borders
    # clear 3:1 against the D1 painted light plate (0.3 lift over the aurora
    # veil — the model pinned in tests/design/design.test.js). Keep the two
    # files in lockstep; dark block is unchanged.
    "light": {
        "--diff-correct-text": "#0B3D2E",
        "--diff-correct-border": "#39764A",
        "--diff-wrong-text": "#833125",
        "--diff-wrong-border": "#A5513C",
        "--diff-fixed-text": "#35517B",
        "--diff-fixed-border": "#4C6B96",
        "--diff-orange-text": "#66470F",
        "--diff-orange-border": "#A45208",
    },
    "dark": {
        "--diff-correct-text": "#B9F0D6",
        "--diff-correct-border": "#34D399",
        "--diff-wrong-text": "#FFD3C8",
        "--diff-wrong-border": "#F08A7C",
        "--diff-fixed-text": "#A8C6F0",
        "--diff-fixed-border": "#6E9EE0",
        "--diff-orange-text": "#F5E3B0",
        "--diff-orange-border": "#E8963A",
    },
}

for path in sorted(glob.glob(os.path.join(THEMES_DIR, "*.json"))):
    fname = os.path.basename(path)
    if fname.startswith("_"):
        continue
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    modified = False
    for mode_key in ("light", "dark"):
        mode = data.get(mode_key, {})
        for key, val in DIFF_COLORS[mode_key].items():
            if key not in mode:
                mode[key] = val
                modified = True
    if modified:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("  [OK] {}: added diff-* variables".format(fname))
    else:
        print("  [SKIP] {}: already has diff-* variables".format(fname))

print("\nDone.")
