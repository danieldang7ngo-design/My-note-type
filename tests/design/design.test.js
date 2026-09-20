'use strict';
/* Design contract tests: token consistency (hex <-> rgb companions),
   WCAG contrast pairs, type-scale stepping, dead-code contracts,
   stripe lockstep, glass recipe values, kill-switches, and muted-text rules. */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = process.env.HNA_ROOT || path.resolve(__dirname, '..', '..');
const cssRaw = fs.readFileSync(path.join(ROOT, '_hna_styles_v7.css'), 'utf8');
// Stripping comments keeps rule lookup from matching selectors mentioned
// only in prose (e.g. a removed selector inside a design note).
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const frontHtml = fs.readFileSync(path.join(ROOT, 'Front.html'), 'utf8');
const backHtml = fs.readFileSync(path.join(ROOT, 'Back.html'), 'utf8');

/* ---------- tiny CSS helpers ---------- */

function tokenBlock(selectorRegex) {
  const re = new RegExp(selectorRegex + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  if (!m) throw new Error('block not found: ' + selectorRegex);
  const tokens = {};
  m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach((decl) => {
    const dm = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (dm) tokens[dm[1]] = dm[2].trim();
  });
  return tokens;
}

/* Brace-matched rule block starting at the first occurrence of a selector. */
function ruleBlock(selectorRegex) {
  const m = css.match(new RegExp(selectorRegex + '[^{]*\\{'));
  if (!m) throw new Error('rule not found: ' + selectorRegex);
  let depth = 0;
  for (let i = m.index; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(m.index, i + 1);
    }
  }
  throw new Error('unbalanced rule: ' + selectorRegex);
}

/* Brace-matched top-level rule whose selector list contains `sel` verbatim.
   Formatting-agnostic (works on the readable ROOT css and the minified
   publish artifact, which has no newlines). Skips descendant/nested rules
   like `.night-mode .aurora-card` and media-query copies. */
function ruleBlockExact(sel) {
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) {
        const parts = css.slice(segStart, i).trim().split(',').map((s) => s.trim());
        if (parts.indexOf(sel) !== -1) {
          let d = 1;
          for (let j = i + 1; j < css.length; j++) {
            if (css[j] === '{') d++;
            else if (css[j] === '}') { d--; if (d === 0) return css.slice(i, j + 1); }
          }
          throw new Error('unbalanced rule: ' + sel);
        }
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth < 0) throw new Error('unbalanced css');
      if (depth === 0) segStart = i + 1;
    }
  }
  throw new Error('rule not found (exact selector): ' + sel);
}

function mediaBlock(maxWidth) {
  const start = css.indexOf('@media (max-width: ' + maxWidth + 'px) {');
  if (start === -1) throw new Error('media block ' + maxWidth + ' not found');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced media block ' + maxWidth);
}

/* Last (source-last, so cascade-winning) media block at a given max-width.
   The file may carry several same-width tiers; the tail override is the one
   that actually wins the cascade. Formatting-agnostic like mediaBlock. */
function lastMediaBlock(maxWidth) {
  const start = css.lastIndexOf('@media (max-width: ' + maxWidth + 'px) {');
  if (start === -1) throw new Error('media block ' + maxWidth + ' not found (last)');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced media block ' + maxWidth);
}

/* First (source-first) media block at a given max-width. Used when a width
   rule lives in an early tier and later tiers only refine spacing. */
function firstMediaBlock(maxWidth) {
  const start = css.indexOf('@media (max-width: ' + maxWidth + 'px) {');
  if (start === -1) throw new Error('media block ' + maxWidth + ' not found (first)');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced media block ' + maxWidth);
}

/* Last (source-last, so cascade-winning) media block at a given min-width.
   Formatting-agnostic like lastMediaBlock. */
function lastMediaMinWidth(minWidth) {
  const start = css.lastIndexOf('@media (min-width: ' + minWidth + 'px) {');
  if (start === -1) throw new Error('media block (min-width) ' + minWidth + ' not found (last)');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced media block (min-width) ' + minWidth);
}

function tokenBlockFrom(src) {
  const tokens = {};
  src.split(';').forEach((decl) => {
    const dm = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (dm) tokens[dm[1]] = dm[2].trim();
  });
  return tokens;
}

/* Token block looked up by exact top-level selector (formatting-agnostic —
   works on the readable root and the single-line minified publish artifact). */
function tokenBlockExact(sel) {
  return tokenBlockFrom(ruleBlockExact(sel).replace(/^\s*\{/, '').replace(/\}\s*$/, ''));
}

/* ---------- colour math ---------- */

function hexToRgb(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('not a hex colour: ' + hex);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  return l1 >= l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05);
}
function alphaBlend(fg, bg, a) {
  return fg.map((v, i) => Math.round(a * v + (1 - a) * bg[i]));
}
function rgbToken(name, block) {
  let v = block[name];
  if (!v) throw new Error('token missing: ' + name);
  const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) v = block[m[1]];
  if (!v) throw new Error('token unresolvable: ' + name);
  return v.split(',').map((s) => parseInt(s.trim(), 10));
}
function hexToken(name, block) {
  const v = block[name];
  if (!v) throw new Error('token missing: ' + name);
  return hexToRgb(v);
}

/* ---------- fixture tokens ---------- */

// Exact-selector lookup (no line anchors): the @font-face rules precede :root,
// so a `^` anchor would only match on the multi-line readable copy, never the
// minified publish artifact. ruleBlockExact finds the first top-level `:root`.
const light = tokenBlockExact(':root');
// No newline anchor: the FIRST `\.night-mode\s*\{` in the comment-stripped css
// is the token block itself (no selector ends in `.night-mode` ahead of it), so
// the lookup is identical on the readable root and the minified publish file.
const night = tokenBlock('\\.night-mode');

const cases = [];

/* BUG-017 regression: light hexes must equal their rgb companions. */
cases.push({
  name: 'design: light-mode aurora hexes match their -rgb companions (BUG-017)',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--aurora-1-rgb', light), hexToRgb(light['--aurora-1']), 'light --aurora-1 vs --aurora-1-rgb');
    assert.deepStrictEqual(rgbToken('--aurora-2-rgb', light), hexToRgb(light['--aurora-2']), 'light --aurora-2 vs --aurora-2-rgb');
    assert.deepStrictEqual(rgbToken('--aurora-accent-rgb', light), hexToRgb(light['--aurora-accent']), 'light --aurora-accent vs --aurora-accent-rgb');
  }
});

cases.push({
  name: 'design: night-mode aurora hexes match their -rgb companions',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--aurora-1-rgb', night), hexToRgb(night['--aurora-1']), 'night --aurora-1 vs --aurora-1-rgb');
    assert.deepStrictEqual(rgbToken('--aurora-2-rgb', night), hexToRgb(night['--aurora-2']), 'night --aurora-2 vs --aurora-2-rgb');
    assert.deepStrictEqual(rgbToken('--aurora-accent-rgb', night), hexToRgb(night['--aurora-accent']), 'night --aurora-accent vs --aurora-accent-rgb');
  }
});

cases.push({
  name: 'design: light accent is a dark green (the #12805B family, AA intent) not pink',
  fn: () => {
    const accent = hexToken('--aurora-accent', light);
    assert.ok(accent[1] > accent[0] && accent[1] > accent[2], 'accent must be green-dominant (G > R and G > B)');
    assert.ok(luminance(accent) < 0.25, 'accent must be dark enough for text use');
  }
});

/* ---------- WCAG contrast ---------- */

const AA = 4.5, AA_LARGE = 3.0;

const pairs = [
  ['light text-primary on lift', hexToken('--text-primary', light), rgbToken('--glass-lift-rgb', light), AA],
  ['light text-secondary on lift', hexToken('--text-secondary', light), rgbToken('--glass-lift-rgb', light), AA],
  ['light text-muted on lift', hexToken('--text-muted', light), rgbToken('--glass-lift-rgb', light), AA],
  ['light text-primary on card base', hexToken('--text-primary', light), hexToken('--aurora-card-base', light), AA],
  ['light text-secondary on card base', hexToken('--text-secondary', light), hexToken('--aurora-card-base', light), AA],
  // muted is a chrome-only token (menu shortcuts, scrollbars, placeholders at low
  // opacity). #5A5244 clears 4.5:1 on every surface it sits on: card base 4.72,
  // painted glass 4.80, opaque lift 6.22 — so all three pairs are STRICT.
  ['light text-muted on card base', hexToken('--text-muted', light), hexToken('--aurora-card-base', light), AA],
  ['light char-correct on lift (36px large text)', hexToken('--diff-correct-text', light), rgbToken('--glass-lift-rgb', light), AA_LARGE],
  ['light char-wrong on lift (36px large text)', hexToken('--diff-wrong-text', light), rgbToken('--glass-lift-rgb', light), AA_LARGE],
  ['light char-extra on lift (36px large text)', hexToken('--diff-orange-text', light), rgbToken('--glass-lift-rgb', light), AA_LARGE],
  ['night text-primary on lift', hexToken('--text-primary', night), rgbToken('--glass-lift-rgb', night), AA],
  ['night text-secondary on lift', hexToken('--text-secondary', night), rgbToken('--glass-lift-rgb', night), AA],
  ['night text-muted on lift', hexToken('--text-muted', night), rgbToken('--glass-lift-rgb', night), AA],
  ['night char-correct on lift (36px large text)', hexToken('--diff-correct-text', night), rgbToken('--glass-lift-rgb', night), AA_LARGE],
  ['night char-wrong on lift (36px large text)', hexToken('--diff-wrong-text', night), rgbToken('--glass-lift-rgb', night), AA_LARGE],
  ['night char-extra on lift (36px large text)', hexToken('--diff-orange-text', night), rgbToken('--glass-lift-rgb', night), AA_LARGE],
  // accent-as-text: #0A5F41 clears 4.5:1 on the rethemed lift (6.22:1) and on
  // the card base (4.72:1), so both light pairs are STRICT. Night accent
  // clears AA against the night lift (7.10:1) too.
  ['light accent on lift (11-13px text)', hexToken('--aurora-accent', light), rgbToken('--glass-lift-rgb', light), AA],
  ['light accent on card base (11-13px text)', hexToken('--aurora-accent', light), hexToken('--aurora-card-base', light), AA],
  ['night accent on lift (11-13px text)', hexToken('--aurora-accent', night), rgbToken('--glass-lift-rgb', night), AA],
  // Settings menu / tooltip chrome stays a NEUTRAL surface with a whisper of
  // the aurora accent: the 2026-09-18 tint paints linear-gradient(180deg,
  // rgba(accent-rgb, 0.07) 0%, rgba(accent-rgb, 0.03) 100%) over the opaque
  // --surface-elevated. Model the painted backdrop at the strongest tint stop
  // (0.07) so a token tweak can't pass the optimistic opaque pairs while the
  // painted surface falls below AA.
  ['light text-primary on menu surface', hexToken('--text-primary', light), alphaBlend(hexToken('--aurora-accent', light), hexToken('--surface-elevated', light), 0.07), AA],
  ['light text-secondary on menu surface', hexToken('--text-secondary', light), alphaBlend(hexToken('--aurora-accent', light), hexToken('--surface-elevated', light), 0.07), AA],
  ['light accent on menu surface (11-13px text)', hexToken('--aurora-accent', light), alphaBlend(hexToken('--aurora-accent', light), hexToken('--surface-elevated', light), 0.07), AA],
  ['night text-primary on menu surface', hexToken('--text-primary', night), alphaBlend(hexToken('--aurora-accent', night), hexToken('--surface-elevated', night), 0.07), AA],
  ['night text-secondary on menu surface', hexToken('--text-secondary', night), alphaBlend(hexToken('--aurora-accent', night), hexToken('--surface-elevated', night), 0.07), AA],
  ['night accent on menu surface (11-13px text)', hexToken('--aurora-accent', night), alphaBlend(hexToken('--aurora-accent', night), hexToken('--surface-elevated', night), 0.07), AA]
];

pairs.forEach(([name, fg, bg, threshold]) => {
  cases.push({
    name: 'design contrast: ' + name,
    fn: () => {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= threshold, name + ': contrast ' + ratio.toFixed(2) + ':1 < ' + threshold + ':1 (fg ' + fg + ' bg ' + bg + ')');
    }
  });
});

/* ---------- D1: painted-backdrop contrast ----------
   The glass surfaces are not the flat lift colour. .glass-pseudo::before
   paints rgba(lift-rgb, --surface-transparency-alpha) — the lift at 55%
   (light) / 72% (night) over the aurora veil (.aurora-bg::before at
   --aurora-veil-base 0.85) over the body::before art. Model the real
   backdrop as that alpha composite and pin the same thresholds, so a token
   tweak can't pass the optimistic opaque-lift pairs above while the painted
   surface falls below AA. Light veil = dusk-ribbon average over the
   near-white top zone; night veil = opaque ink floor. Lift alpha read from
   the shipped token (0.55 light / 0.72 night), not hardcoded. */
const veilLight = alphaBlend(hexToRgb('#A2BBD7'), hexToRgb('#E6F3E8'), 0.85);
const veilNight = alphaBlend(hexToRgb('#1D2924'), hexToRgb('#12100C'), 1.0);
// Lift is painted as rgba(lift-rgb, --surface-transparency-alpha) over the
// veil. The knob lives on the glass components (cue/recall/tags/typing all
// set 0.55 in light mode, 0.72 in night since the 2026-08-16 frosted-tint
// pass); read it from .cue-card so a future show-through change is tracked
// by the test instead of silently invalidating the model. Night is modelled
// at the LIGHT value (0.55) — a conservative underestimate: the real night
// plate (0.72) is denser/darker, so its measured contrast can only be
// better than the model claims.
const liftAlpha = parseFloat(tokenBlock('\\.cue-card')['--surface-transparency-alpha'] || '0.55');
const paintedLight = alphaBlend(rgbToken('--glass-lift-rgb', light), veilLight, liftAlpha);
const paintedNight = alphaBlend(rgbToken('--glass-lift-rgb', night), veilNight, liftAlpha);

const paintedPairs = [
  ['light text-primary on painted glass', hexToken('--text-primary', light), paintedLight, AA],
  ['light text-secondary on painted glass', hexToken('--text-secondary', light), paintedLight, AA],
  ['light text-muted on painted glass', hexToken('--text-muted', light), paintedLight, AA],
  // Wave-1 audit: light diff text tokens are now ≥4.5:1 on the painted plate,
  // so the char-* pairs tighten from AA_LARGE (3.0) to AA (4.5). Night text
  // also clears 4.5:1 on the night painted plate (8.38-11.52:1), so its pairs
  // tighten in lockstep — tightening only, never relaxing a STRICT case.
  ['light char-correct on painted glass', hexToken('--diff-correct-text', light), paintedLight, AA],
  ['light char-wrong on painted glass', hexToken('--diff-wrong-text', light), paintedLight, AA],
  ['light char-extra on painted glass', hexToken('--diff-orange-text', light), paintedLight, AA],
  ['night text-primary on painted glass', hexToken('--text-primary', night), paintedNight, AA],
  ['night text-secondary on painted glass', hexToken('--text-secondary', night), paintedNight, AA],
  ['night text-muted on painted glass', hexToken('--text-muted', night), paintedNight, AA],
  ['night char-correct on painted glass', hexToken('--diff-correct-text', night), paintedNight, AA],
  ['night char-wrong on painted glass', hexToken('--diff-wrong-text', night), paintedNight, AA],
  ['night char-extra on painted glass', hexToken('--diff-orange-text', night), paintedNight, AA]
];

paintedPairs.forEach(([name, fg, bg, threshold]) => {
  cases.push({
    name: 'design contrast painted: ' + name,
    fn: () => {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= threshold, name + ': contrast ' + ratio.toFixed(2) + ':1 < ' + threshold + ':1 (fg ' + fg + ' painted bg ' + bg + ')');
    }
  });
});

/* ---------- wave-1 audit: no backdrop-filter in the shipped CSS ----------
   The settings-menu rule once carried `backdrop-filter: blur(12px)` (with
   -webkit- prefix) on a fixed, scrollable container — a live blur layer for
   as long as the menu is open. Removed 2026-08-14; the painted tint does the
   legibility work alone. Scanned on the comment-stripped css (what the
   minified publish artifact ships), so prose that merely mentions the word
   in a comment does not trip it. */
cases.push({
  name: 'design: shipped CSS contains zero backdrop-filter declarations (settings-menu blur removed)',
  fn: () => {
    assert.ok(css.indexOf('backdrop-filter') === -1,
      'backdrop-filter must not appear in the shipped CSS — the settings-menu blur re-arms the compositor layer while the menu is open');
    assert.ok(css.indexOf('-webkit-backdrop-filter') === -1,
      '-webkit-backdrop-filter must not appear either');
  }
});

/* ---------- wave-1 audit: theme-matrix diff contrast ----------
   The four flagged themes carry their own --diff-* tokens (injected by
   hna-theme-pack/fix_diff_vars.py). Every text token must clear 4.5:1 and
   every border token 3:1 against the SAME painted plate the CSS tokens are
   held to (light lift [202,237,246] @ 0.55 over veilLight, night lift
   [2,53,37] @ 0.55 over veilNight — the night plate is modelled at the
   light alpha, conservatively, since the shipped night surfaces paint
   0.72) — the theme palette must never be able to silently drop the diff
   feedback below AA. The light block must also agree token-for-token with
   the shipped :root values (fix_diff_vars.py mirrors them; keep all three
   sources in lockstep). */
const AUDIT_THEMES = ['midnight-navy', 'teal-harbor', 'violet-storm', 'denim-worn'];
const DIFF_TEXT_TOKENS = ['--diff-correct-text', '--diff-wrong-text', '--diff-fixed-text', '--diff-orange-text'];
const DIFF_BORDER_TOKENS = ['--diff-correct-border', '--diff-wrong-border', '--diff-fixed-border', '--diff-orange-border'];
// Theme JSONs are NOT part of the shipped bundle (HNA_ROOT flips to publish/
// under --publish); resolve them from the source tree so the gate still runs
// against the staged CSS.
const AUDIT_THEMES_DIR = path.join(path.resolve(__dirname, '..', '..'), 'hna-theme-pack', 'themes');

cases.push({
  name: 'design: flagged themes — light/dark --diff-* tokens clear 4.5:1 (text) / 3:1 (border) on the painted plate and agree with :root',
  fn: () => {
    AUDIT_THEMES.forEach((t) => {
      const file = path.join(AUDIT_THEMES_DIR, t + '.json');
      assert.ok(fs.existsSync(file), 'theme file missing: ' + file);
      const theme = JSON.parse(fs.readFileSync(file, 'utf8'));
      [['light', light, paintedLight], ['dark', night, paintedNight]].forEach(([mode, cssBlock, plate]) => {
        const tok = theme[mode];
        assert.ok(tok, t + ' missing ' + mode + ' block');
        DIFF_TEXT_TOKENS.forEach((name) => {
          assert.ok(tok[name], t + ' ' + mode + ' missing ' + name);
          assert.strictEqual(tok[name], cssBlock[name],
            t + ' ' + mode + ' ' + name + ' (' + tok[name] + ') must match the shipped CSS token ' + cssBlock[name] + ' — fix_diff_vars.py and the theme JSONs are meant to be in lockstep');
          const ratio = contrast(hexToRgb(tok[name]), plate);
          assert.ok(ratio >= AA,
            t + ' ' + mode + ' ' + name + ' = ' + ratio.toFixed(2) + ':1 < 4.5:1 on the painted plate (fg ' + tok[name] + ')');
        });
        DIFF_BORDER_TOKENS.forEach((name) => {
          assert.ok(tok[name], t + ' ' + mode + ' missing ' + name);
          assert.strictEqual(tok[name], cssBlock[name],
            t + ' ' + mode + ' ' + name + ' (' + tok[name] + ') must match the shipped CSS token ' + cssBlock[name]);
          const ratio = contrast(hexToRgb(tok[name]), plate);
          assert.ok(ratio >= AA_LARGE,
            t + ' ' + mode + ' ' + name + ' = ' + ratio.toFixed(2) + ':1 < 3:1 on the painted plate (fg ' + tok[name] + ')');
        });
      });
    });
  }
});

/* ---------- sweden-blue / sweden-yellow slot swap regression ----------
   BUG-033: four themes carried the sweden values swapped against their
   names (sweden-blue held the gold, sweden-yellow the blue/purple). The
   slot must be hue-correct in BOTH modes: sweden-blue is the cooler,
   blue-dominant colour and sweden-yellow the warm gold. */

cases.push({
  name: 'design: flagged themes — sweden-blue is blue-dominant and sweden-yellow warm in both modes (BUG-033)',
  fn: () => {
    const blueDominance = (hex) => {
      const rgb = hexToRgb(hex);
      return rgb[2] - rgb[0];
    };
    AUDIT_THEMES.forEach((t) => {
      const file = path.join(AUDIT_THEMES_DIR, t + '.json');
      const theme = JSON.parse(fs.readFileSync(file, 'utf8'));
      ['light', 'dark'].forEach((mode) => {
        const sb = theme[mode]['--sweden-blue'];
        const sy = theme[mode]['--sweden-yellow'];
        assert.ok(sb && sy, t + ' ' + mode + ' missing sweden tokens');
        assert.ok(blueDominance(sb) > blueDominance(sy),
          t + ' ' + mode + ' sweden-blue (' + sb + ') is not bluer than sweden-yellow (' + sy + ') — values swapped against their names');
      });
    });
  }
});

/* ---------- type scale stepping ---------- */

function fsVal(block, name) {
  const v = block[name];
  assert.ok(v, name + ' missing in media block');
  const m = v.match(/^([\d.]+)rem$/);
  assert.ok(m, name + ' not a rem: ' + v);
  return parseFloat(m[1]);
}

function fsValInBlock(block, name) {
  const m = block.match(new RegExp(name + '\\s*:\\s*([\\d.]+)rem'));
  assert.ok(m, name + ' missing in media block');
  return parseFloat(m[1]);
}

/* ---------- baseline type scale (pre-compact revert, 2026-09-18) ----------
   The type ladder is back to the pre-compact fixed rem values in :root,
   with per-tier media-block overrides stepping down at 1025/768/480px.
   The contract: every token is a fixed rem (no fluid clamp), the ladder
   stays strictly ordered, and the media overrides step down monotonically
   (--fs-3xl: 3rem -> 2.5rem -> 2.375rem -> 2.125rem). */

cases.push({
  name: 'design: baseline type scale — fixed rem ladder in :root with monotonic media-block step-downs',
  fn: () => {
    const root = tokenBlock(':root');
    const expect = {
      '--fs-2xs': '0.6875rem', '--fs-xs': '0.75rem', '--fs-sm': '0.8125rem',
      '--fs-base': '0.9375rem', '--fs-md': '1.125rem', '--fs-lg': '1.375rem',
      '--fs-xl': '1.625rem', '--fs-2xl': '2.25rem', '--fs-3xl': '3rem',
    };
    Object.keys(expect).forEach((t) => {
      assert.strictEqual(root[t], expect[t],
        t + ' must be the fixed baseline value ' + expect[t] + ' — got ' + root[t]);
    });
    const ladder = Object.keys(expect);
    const vals = ladder.map((t) => parseFloat(expect[t]));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] > vals[i - 1],
        ladder[i] + ' must stay above ' + ladder[i - 1] + ': ' + vals.join(' > '));
    }
    // media-block step-downs (source-first tiers carry the :root overrides)
    const b1024 = firstMediaBlock(1024);
    assert.ok(/--fs-3xl\s*:\s*2\.5rem\s*;/.test(b1024), '@1024 must step --fs-3xl down to 2.5rem');
    assert.ok(/--fs-2xl\s*:\s*2rem\s*;/.test(b1024), '@1024 must step --fs-2xl down to 2rem');
    const b768 = firstMediaBlock(768);
    assert.ok(/--fs-3xl\s*:\s*2\.375rem\s*;/.test(b768), '@768 must step --fs-3xl down to 2.375rem');
    assert.ok(/--fs-2xl\s*:\s*1\.75rem\s*;/.test(b768), '@768 must step --fs-2xl down to 1.75rem');
    assert.ok(/--fs-lg\s*:\s*1\.25rem\s*;/.test(b768), '@768 must step --fs-lg down to 1.25rem');
    const b480 = firstMediaBlock(480);
    assert.ok(/--fs-3xl\s*:\s*2\.125rem\s*;/.test(b480), '@480 must step --fs-3xl down to 2.125rem');
    assert.ok(/--fs-lg\s*:\s*1\.1875rem\s*;/.test(b480), '@480 must step --fs-lg down to 1.1875rem');
  }
});

/* ---------- baseline token ladder (pre-compact revert, 2026-09-18) ----------
   The spacing rungs and radii are back to the pre-compact fixed values
   (4/6/8/10/12/14/16/16/20px and 8/10/16/32px). The contract: every rung is
   a fixed px value (no fluid clamp), the ladder stays strictly ordered, and
   the region heights are restored (--cue-region-height: 100px,
   --typing-region-height: 64px). Colors are untouched — the 52-pair contrast
   suite still governs ink/backdrop pairs. */

cases.push({
  name: 'design: baseline token ladder — fixed spacing rungs and radii, region heights restored',
  fn: () => {
    const root = tokenBlock(':root');
    const expect = {
      '--s-1': '4px', '--s-1_5': '6px', '--s-2': '8px', '--s-2_5': '10px',
      '--s-3': '12px', '--s-3_5': '14px', '--s-4': '16px', '--s-6': '16px',
      '--s-7': '20px',
      '--radius-xs': '8px', '--radius-sm': '10px', '--radius-md': '16px',
      '--radius-lg': '32px',
      '--cue-region-height': '100px', '--typing-region-height': '64px',
    };
    Object.keys(expect).forEach((t) => {
      assert.strictEqual(root[t], expect[t],
        t + ' must be the fixed baseline value ' + expect[t] + ' — got ' + root[t]);
    });
    const rungs = ['--s-1', '--s-1_5', '--s-2', '--s-2_5', '--s-3', '--s-3_5', '--s-4', '--s-7'];
    const vals = rungs.map((t) => parseFloat(root[t]));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] > vals[i - 1],
        rungs[i] + ' must stay above ' + rungs[i - 1] + ': ' + vals.join(' > '));
    }
  }
});

cases.push({
  name: 'design: baseline card widths — 848px front/back shell, 1024px back cap, 900px desktop tier',
  fn: () => {
    assert.ok(/(?:\.aurora-card\.card-front|\.aurora-card\.card-back)\s*\{[^}]*width\s*:\s*min\(848px,\s*calc\(100vw\s*-\s*32px\)\)/.test(css),
      'both faces must cap at min(848px, calc(100vw - 32px))');
    assert.ok(/min\(848px,\s*95vw\)/.test(css),
      'base .aurora-card min-width must cap at min(848px, 95vw)');
    assert.ok(/min\(848px,\s*calc\(100vw\s*-\s*8px\)\)/.test(css),
      'the production .aurora-card width must cap at min(848px, calc(100vw - 8px))');
    assert.ok(/\.card-front,\s*\.card-back\s*\{[^}]*max-width\s*:\s*1024px\s*;/.test(css),
      '.card-front/.card-back must cap at 1024px');
    assert.ok(/@media\s*\(min-width:\s*1025px\)\s*\{[^}]*\.aurora-card\s*\{[^}]*max-width\s*:\s*900px\s*;/.test(css),
      'the >=1025px desktop tier must cap .aurora-card at 900px');
  }
});

/* ---------- typing-area geometry (long-word fix, 2026-08-14) ---------- */

cases.push({
  name: 'design: typing field grows for long answers and scrolls instead of clipping',
  fn: () => {
    const firstBlock = (sel) => {
      const m = css.match(new RegExp(sel + '\\s*\\{[^}]*\\}'));
      assert.ok(m, 'standalone block not found: ' + sel);
      return m[0];
    };
    const wrapper = firstBlock('\\.type-input-wrapper');
    const overlay = firstBlock('#typeans-overlay');

    // In v7 modern layout, .type-input-wrapper is auto-expanding or bounded by typing-region-height
    assert.ok(wrapper.indexOf('display: block') !== -1 || wrapper.indexOf('display: flex') !== -1,
      '.type-input-wrapper must be block or flex container');

    // The ≤480 typing tier carries the scroll cap
    const typing480 = /@media \(max-width: 480px\) \{[^]*?#typeans-overlay\s*\{([^}]*)\}/.exec(css);
    assert.ok(typing480 && /max-height:\s*calc\(var\(--typing-region-height\) \* 5\.5 - var\(--s-1_5\) \* 2\)/.test(typing480[1]),
      '≤480 must set #typeans-overlay max-height with the 5.5x budget');
  }
});

/* ---------- dead code contract ---------- */

cases.push({
  name: 'design: no orphaned .card-corner-accent rules remain',
  fn: () => {
    const re = /\.card-corner-accent/;
    assert.ok(!re.test(css), '.card-corner-accent must be gone (corner brackets removed 2026-08-14)');
    // base .aurora-card rule must still carry position:relative (aurora host
    // and fixed gear depend on the card being a containing block)
    const base = ruleBlockExact('.aurora-card');
    assert.ok(base.indexOf('position: relative') !== -1, '.aurora-card must keep position:relative');
  }
});

/* ---------- stripe lockstep & glass recipe ---------- */

cases.push({
  name: 'design: shared ribbon rule stripes use var(--aurora-card-base), not a literal',
  fn: () => {
    const shared = ruleBlock('\\.aurora-bg::before,\\s*\\.aurora-bg::after');
    assert.ok(shared.indexOf('repeating-linear-gradient') !== -1, 'stripe layer missing');
    assert.ok(shared.indexOf('var(--aurora-card-base)') !== -1,
      'stripe must reference var(--aurora-card-base) (the #97B0CD comment is stale documentation)');
  }
});

cases.push({
  name: 'design: night ribbon rule is the documented #000-stripe exception',
  fn: () => {
    const nightRule = ruleBlock('\\.night-mode \\.aurora-bg::before,\\s*\\.night-mode \\.aurora-bg::after');
    assert.ok(/#000/.test(nightRule), 'night stripes must be #000 per documented exception');
  }
});

cases.push({
  name: 'design: glass mesh recipe — night 0.20, light 0.42',
  fn: () => {
    assert.strictEqual(light['--glass-mesh-opacity'], '0.42');
    assert.strictEqual(night['--glass-mesh-opacity'], '0.20');
  }
});

cases.push({
  name: 'design: light glass lift is a pale cyan derived from the aurora accent',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--glass-lift-rgb', light), [202, 237, 246]);
    const lift = rgbToken('--glass-lift-rgb', light);
    assert.ok(lift[2] > lift[0], 'light lift must be blue-dominant (B > R), not pink');
  }
});

cases.push({
  name: 'design: night glass lift is the deep aurora green (2,53,37)',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--glass-lift-rgb', night), [2, 53, 37]);
  }
});

cases.push({
  name: 'design: light glass tint equals the aurora-1 accent (79,190,140) — accent-derived, green theme',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--glass-tint-rgb', light), [79, 190, 140]);
    assert.deepStrictEqual(rgbToken('--glass-tint-rgb', light), rgbToken('--aurora-1-rgb', light),
      'light --glass-tint-rgb must equal --aurora-1-rgb (accent-derived)');
  }
});

cases.push({
  name: 'design: night glass tint equals the night aurora-1 accent (5,150,105)',
  fn: () => {
    assert.deepStrictEqual(rgbToken('--glass-tint-rgb', night), [5, 150, 105]);
    assert.deepStrictEqual(rgbToken('--glass-tint-rgb', night), rgbToken('--aurora-1-rgb', night),
      'night --glass-tint-rgb must equal night --aurora-1-rgb (accent-derived)');
  }
});

cases.push({
  name: 'design: light aurora-card-base is plain hex (non-pink, B > R); night stays #101B16',
  fn: () => {
    const lightBase = light['--aurora-card-base'];
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(lightBase), 'light --aurora-card-base must be a plain hex token: ' + lightBase);
    const rgb = hexToRgb(lightBase);
    assert.ok(rgb[2] > rgb[0], 'light card base must be blue-dominant (B > R), not pink: ' + lightBase);
    assert.strictEqual(night['--aurora-card-base'], '#101B16');
  }
});

/* ---------- aurora always-on (perfMode / showAurora removed; auroraFlow is motion-only pause) ---------- */

cases.push({
  name: 'design: aurora kill-switch CSS is gone — no .pause-aurora or .pause-animation selectors remain',
  fn: () => {
    assert.ok(!/\.pause-aurora(?![-\w])/.test(css), 'pause-aurora selector must be removed');
    assert.ok(!/\.pause-animation(?![-\w])/.test(css), 'pause-animation selector must be removed');
  }
});

cases.push({
  name: 'design: .aurora-bg animations run unconditionally (not gated on a pause class)',
  fn: () => {
    const anim = css.match(/\.aurora-bg::before\s*\{[^}]*animation:/);
    assert.ok(anim, '.aurora-bg::before must declare animation');
    assert.ok(!/html:not\(\.pause-animation\)\s+\.aurora-bg/.test(css), 'no pause-animation gate may guard aurora');
  }
});

/* BUG-020 regression: the aurora motion tokens must be defined wherever the
   .aurora-bg animation declarations reference them. An undefined
   var(--aurora-drift) makes the ENTIRE `animation` declaration invalid at
   computed-value time (CSS custom-properties spec) -> animation: none ->
   the aurora never animates, on every platform and in both modes. The
   previous guard only checked that an `animation:` string exists in the
   first .aurora-bg::before block, which a broken declaration still passes. */
cases.push({
  name: 'design: aurora motion tokens (--aurora-drift/-sway/-veil-cycle) are defined in :root (BUG-020)',
  fn: () => {
    ['--aurora-drift', '--aurora-sway', '--aurora-veil-cycle'].forEach((tok) => {
      assert.ok(light[tok], tok + ' must be defined in :root — it is referenced by the .aurora-bg animation declarations');
    });
  }
});

cases.push({
  name: 'design: aurora veil tokens are defined in :root for light mode (BUG-020)',
  fn: () => {
    ['--aurora-veil-base', '--aurora-veil-overlay'].forEach((tok) => {
      assert.ok(light[tok], tok + ' must be defined in :root (light mode) — night-mode-only definitions leave light mode invalid');
    });
  }
});

cases.push({
  name: 'design: every var(--aurora-*) in the .aurora-bg animation/opacity declarations resolves to a defined token (BUG-020)',
  fn: () => {
    const blocks = [
      ruleBlock('\\.aurora-bg::before'),
      ruleBlock('\\.aurora-bg::after'),
      ruleBlock('html \\.aurora-bg::before'),
      ruleBlock('html \\.aurora-bg::after'),
      // Third ribbon (`.aurora-bg--mid` carries the base `.aurora-bg`
      // class too, but declares its own animation/opacity refs that the
      // four pseudo blocks above never see — a typo'd mid token would
      // invalidate the whole animation shorthand silently, same failure
      // mode as the original BUG-020). The negative lookahead skips the
      // section-comment mention (followed by `:`) and lands on the rule
      // (followed by `{`) — and, unlike a line anchor, still matches the
      // newline-free minified publish artifact.
      ruleBlock('\\.aurora-bg--mid(?![^{]*:)')
    ];
    const refs = new Set();
    blocks.forEach((b) => {
      const m = b.match(/var\((--aurora-[\w-]+)\)/g) || [];
      m.forEach((r) => refs.add(r.slice(4, -1)));
    });
    assert.ok(refs.size > 0, 'expected var(--aurora-*) references in .aurora-bg rules');
    refs.forEach((tok) => {
      assert.ok(light[tok] || night[tok],
        tok + ' is referenced by a .aurora-bg declaration but defined in neither :root nor .night-mode');
    });
  }
});

/* Tag-badge entry animation must use fill-mode `backwards`, not `both`.
   A `both` fill keeps writing the animation's `to` state (identity
   transform) after it finishes, which outranks the :hover/:active lifts
   on the badge — the same author-rule-killing failure documented for the
   section-17 layers. `backwards` still fills the stagger delay with the
   hidden `from` state, so the entry looks identical. */
cases.push({
  name: 'design: tag-badge entry animation uses fill-mode backwards so the hover/active lifts stay live',
  fn: () => {
    const badge = ruleBlock('html \\.card-tags \\.tag-badge');
    assert.ok(/animation\s*:\s*[^;]*\bbackwards\b[^;]*;/.test(badge),
      'html .card-tags .tag-badge must declare fill-mode `backwards` (a `both` fill would kill the hover/active transforms)');
    assert.ok(!/\bboth\b/.test(badge),
      'html .card-tags .tag-badge must not use fill-mode `both`');
  }
});

/* ---------- muted-text misuse guard ---------- */

cases.push({
  name: 'design: --text-muted is not used on key body-copy selectors (giaithich, ex-trans, row-info label, ipa, diff-row-typed)',
  fn: () => {
    const banned = ['.giaithich', '.ex-trans', '.row-info .label', '.ipa', '.diff-row-typed'];
    banned.forEach((sel) => {
      const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{[^}]*var\\(--text-muted\\)');
      assert.ok(!re.test(css), sel + ' must not use --text-muted (muted token is chrome-only)');
    });
  }
});

cases.push({
  name: 'design: #correct-answer is visually hidden by CSS',
  fn: () => {
    const rule = ruleBlock('#correct-answer');
    assert.ok(/display\s*:\s*none/.test(rule) || /visibility\s*:\s*hidden/.test(rule),
      '#correct-answer must be display:none or visibility:hidden');
  }
});

/* ---------- tag tray aurora show-through ---------- */

cases.push({
  name: 'design: .card-tags carries no direct background and keeps --surface-transparency-alpha at 0.55 base / 0.72 night (frosted tint)',
  fn: () => {
    const tray = ruleBlock('\\.card-tags');
    assert.ok(!/background(-color|-image)?\s*:/.test(tray),
      '.card-tags must not paint a direct background — its surface comes from the shared .glass-pseudo recipe knobs');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.55\s*;/.test(tray),
      '.card-tags must keep --surface-transparency-alpha at 0.55 (light, frosted-tint pass 2026-08-16) so the aurora shows through (~45% transparency) while chips retain contrast');
    // The base rule's 0.55 survives night mode via inheritance, but a
    // dedicated override must exist so a future night-mode lift (or a
    // returning shared lift rule) cannot re-block the drift — and so the
    // denser night plate (0.72, ~28% show-through) stays pinned.
    const nightTray = css.match(/\.night-mode \.card-tags\s*\{[^}]*\}/);
    assert.ok(nightTray, '.night-mode .card-tags dedicated override missing');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.72\s*;/.test(nightTray[0]),
      '.night-mode .card-tags must keep --surface-transparency-alpha at 0.72 so night mode keeps the denser frosted plate without re-blocking the aurora');
  }
});

/* ---------- cue card aurora show-through ---------- */

cases.push({
  name: 'design: .cue-card carries no direct background and keeps --surface-transparency-alpha at 0.55 base / 0.72 night (frosted tint)',
  fn: () => {
    const card = ruleBlock('\\.cue-card');
    assert.ok(!/background(-color|-image)?\s*:/.test(card),
      '.cue-card must not paint a direct background — the aurora animation behind the card is the surface');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.55\s*;/.test(card),
      '.cue-card must keep --surface-transparency-alpha at 0.55 (frosted-tint pass 2026-08-16) so the aurora shows through (~45% transparency) while text retains contrast');
    assert.ok(/--glass-mesh-opacity\s*:\s*0\.3\s*;/.test(card),
      '.cue-card must set --glass-mesh-opacity to 0.3 so the prism mesh does not wash out the aurora');
    assert.ok(/--glass-crown\s*:\s*0\.3\s*;/.test(card),
      '.cue-card must set --glass-crown to 0.3 so the white haze does not cap the aurora');
    // The base rule's 0.55 survives night mode via inheritance, but a
    // dedicated override must exist so a future night-mode lift cannot
    // re-block the drift behind the prompt — and so the denser night plate
    // (0.72, ~28% show-through) stays pinned.
    const nightCard = css.match(/\.night-mode \.cue-card\s*\{[^}]*\}/);
    assert.ok(nightCard, '.night-mode .cue-card dedicated override missing');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.72\s*;/.test(nightCard[0]),
      '.night-mode .cue-card must keep --surface-transparency-alpha at 0.72 so night mode keeps the denser frosted plate without re-blocking the aurora');
  }
});

/* ---------- recall card aurora show-through ---------- */

cases.push({
  name: 'design: .recall-card carries no direct background and keeps --surface-transparency-alpha at 0.55 base / 0.72 night (frosted tint)',
  fn: () => {
    const card = ruleBlock('\\.recall-card');
    assert.ok(!/background(-color|-image)?\s*:/.test(card),
      '.recall-card must not paint a direct background — the aurora animation behind the card is the surface');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.55\s*;/.test(card),
      '.recall-card must keep --surface-transparency-alpha at 0.55 (frosted-tint pass 2026-08-16) so the aurora shows through (~45% transparency) while text retains contrast');
    assert.ok(/--glass-mesh-opacity\s*:\s*0\.3\s*;/.test(card),
      '.recall-card must set --glass-mesh-opacity to 0.3 so the prism mesh does not wash out the aurora');
    assert.ok(/--glass-crown\s*:\s*0\.3\s*;/.test(card),
      '.recall-card must set --glass-crown to 0.3 so the white haze does not cap the aurora');
    // The base rule's 0.55 survives night mode via inheritance, but a
    // dedicated override must exist so a future night-mode lift cannot
    // re-block the drift behind the answer word — and so the denser night
    // plate (0.72, ~28% show-through) stays pinned.
    const nightCard = css.match(/\.night-mode \.recall-card\s*\{[^}]*\}/);
    assert.ok(nightCard, '.night-mode .recall-card dedicated override missing');
    assert.ok(/--surface-transparency-alpha\s*:\s*0\.72\s*;/.test(nightCard[0]),
      '.night-mode .recall-card must keep --surface-transparency-alpha at 0.72 so night mode keeps the denser frosted plate without re-blocking the aurora');
  }
});

/* ---------- ≤768 flush-left read + compact audio (2026-08-16) ----------
   Source-last tail tier: phones/tablets read the prompt, hero word, example
   and diff rows flush-left (desktop keeps the centred editorial read) and
   the back-face audio buttons shrink to 30px while a transparent 44px
   ::after keeps the touch target. Pinned inside the LAST ≤768 media block
   (lastMediaBlock) because only the source-last copy wins the cascade over
   the earlier ≤768 and ≤480 tiers. */

cases.push({
  name: 'design: ≤768 headline/diff text is flushed left, diff rows justified (prompt-content, swedish-word, example, diff rows)',
  fn: () => {
    const b = lastMediaBlock(768);
    assert.ok(/\.prompt-content\s*\{[^}]*text-align\s*:\s*left\s*;/.test(b),
      '≤768 .prompt-content must be text-align: left — the front meaning starts flush');
    assert.ok(/\.back-section--word\s*\{[^}]*align-items\s*:\s*flex-start\s*;/.test(b),
      '≤768 .back-section--word must be align-items: flex-start so the hero section hugs left');
    assert.ok(/\.back-section--word\s*\{[^}]*text-align\s*:\s*left\s*;/.test(b),
      '≤768 .back-section--word must be text-align: left');
    assert.ok(/\.swedish-word\s*\{[^}]*text-align\s*:\s*left\s*;/.test(b),
      '≤768 .swedish-word must be text-align: left — the inline-block word wraps flush');
    assert.ok(/\.word-meta\s*\{[^}]*justify-content\s*:\s*flex-start\s*;/.test(b),
      '≤768 .word-meta must be justify-content: flex-start — pos/IPA/audio row hugs left');
    assert.ok(/\.ex-text\s*\{[^}]*text-align\s*:\s*left\s*;/.test(b),
      '≤768 .ex-text must be text-align: left — the example sentence starts flush');
    assert.ok(/\.diff-section\s*\{[^}]*align-items\s*:\s*flex-start\s*;/.test(b),
      '≤768 .diff-section must be align-items: flex-start — the centred column flex is what centres the diff chip/rows');
    assert.ok(!/text-align\s*:\s*justify/.test(ruleBlock('\\.diff-row-typed') + ruleBlock('\\.diff-row-correct')),
      'diff rows must keep natural spacing — text-align: justify stretched the word gaps and read as unnatural');
    assert.ok(/\.diff-row-label\s*\{[^}]*margin-left\s*:\s*0\s*;/.test(b),
      '≤768 .diff-row-label must carry margin-left: 0 — the chip hugs left explicitly');
    // The "Exakt!" confirmation badge must stay centred — it is a short
    // badge, not diff content; its margin auto centring is load-bearing.
    assert.ok(/\.verdict-card\.verdict-pop-correct\s*\{[^}]*margin-left\s*:\s*auto\s*;/.test(css),
      '.verdict-card.verdict-pop-correct must keep margin-left: auto — the confirmation badge stays centred on phones');
  }
});

cases.push({
  name: 'design: ≤768 replay-button shrinks to 30px with a 44px ::after hitbox',
  fn: () => {
    const b = lastMediaBlock(768);
    assert.ok(/\.replay-button,\s*button\.replay-button\s*\{[^}]*width\s*:\s*30px !important\s*;/.test(b),
      '≤768 .replay-button must shrink to width: 30px !important — source-last beats the base 34px');
    assert.ok(/\.replay-button,\s*button\.replay-button\s*\{[^}]*height\s*:\s*30px !important\s*;/.test(b),
      '≤768 .replay-button must shrink to height: 30px !important');
    assert.ok(/\.replay-button,\s*button\.replay-button\s*\{[^}]*min-width\s*:\s*0 !important\s*;/.test(b),
      '≤768 .replay-button must drop min-width to 0 — defeats the ≤480 44px minimum');
    // overflow: visible is load-bearing — the base button's overflow: hidden
    // !important would clip the 44px ::after to the 30px bounds (hitbox dies).
    assert.ok(/\.replay-button,\s*button\.replay-button\s*\{[^}]*overflow\s*:\s*visible !important\s*;/.test(b),
      '≤768 .replay-button must carry overflow: visible !important so the 44px ::after hitbox is not clipped to the 30px button');
    assert.ok(/\.replay-button::after,\s*button\.replay-button::after\s*\{[^}]*width\s*:\s*44px\s*;/.test(b),
      '≤768 .replay-button::after must carry the 44px transparent hitbox');
    assert.ok(/\.replay-button::after,\s*button\.replay-button::after\s*\{[^}]*height\s*:\s*44px\s*;/.test(b),
      '≤768 .replay-button::after hitbox must be 44px tall');
  }
});

cases.push({
  name: 'design: the example is a disclosure and its audio lives in the "Exempel" title row (all widths)',
  fn: () => {
    // The example box is now a <details>/<summary> disclosure: the play
    // button moves out of the sentence and into the title row. The title
    // row is Extra information's twin — it carries NO summary overrides;
    // the base summary.expand-trigger rule (space-between) lays the two
    // children (title + chevron) out, and .example-title-row glues the
    // "Exempel" text to the play button on the left.
    assert.ok(!/\.example-dropdown > summary\.expand-trigger\s*\{/.test(css),
      'the example summary must carry no overrides — it renders exactly like the Extra information title row');
    assert.ok(!/\.example-dropdown > summary\.expand-trigger \.expand-chevron\s*\{/.test(css),
      'the example chevron must carry no margin-left: auto override — base space-between pushes it right');
    assert.ok(/summary\.expand-trigger\s*\{[^}]*justify-content\s*:\s*space-between/.test(css),
      'the base summary.expand-trigger must stay justify-content: space-between — shared by Extra information and Exempel');
    assert.ok(/\.example-title-row\s*\{[^}]*display\s*:\s*inline-flex/.test(css),
      '.example-title-row must be inline-flex — title text and play button stay glued on the left');
    assert.ok(/\.example-title-row\s*\{[^}]*gap\s*:\s*var\(--s-2\)/.test(css),
      '.example-title-row must keep the standard gap — title and play button breathe like the base title row');
    assert.ok(/\.example-trigger \.replay-button[^{}]*\{[^}]*width\s*:\s*22px !important/.test(css),
      '.example-trigger .replay-button must be title-height (22px) instead of the 34px standalone button');
    assert.ok(/\.example-trigger \.replay-button::after[^{}]*\{[^}]*width\s*:\s*44px[^}]*height\s*:\s*44px/.test(css),
      '.example-trigger .replay-button::after must keep the 44px tap hitbox');
    // The audio is no longer inline with the sentence text, so that flex
    // clamp must not come back (it glued the sentence and button together).
    assert.ok(!/\.ex-text \.sound\s*\{/.test(css),
      '.ex-text .sound must be gone — the play button now lives in the disclosure title row');
    // The copy must drop into its own bordered panel — exactly like Extra
    // information, so the title never fuses with the sentence below it.
    assert.ok(/\.example-dropdown > \.expand-content\s*\{[^}]*padding\s*:\s*var\(--s-2\)\s*var\(--s-2_5\)[^}]*border\s*:\s*1px solid var\(--border-subtle\)/.test(css),
      '.example-dropdown copy panel must keep padding + a visible border — the sentence/translation panel looks like the Extra information one');
    // The play triangle is drawn with mask-image longhands (not the
    // shorthand) over a percent-encoded data URI — the shorthand's
    // "center / contain" size syntax dropped the whole mask on some
    // engines, rendering a solid square instead of the triangle.
    assert.ok(/-webkit-mask-image\s*:\s*url\('data:image\/svg\+xml,%3Csvg/.test(css),
      '.replay-button::before must set -webkit-mask-image with an encoded data URI — the triangle survives strict parsers');
    assert.ok(/mask-image\s*:\s*url\('data:image\/svg\+xml,%3Csvg/.test(css),
      '.replay-button::before must set mask-image with an encoded data URI');
    assert.ok(!/mask:\s*url\('data:image\/svg\+xml,</.test(css),
      'no raw "<svg" data URI may remain in a mask shorthand — unencoded brackets broke the icon');
    // The wrapper itself is flat — no card rail, shadow, padding or hover
    // lift: the raised glass appears only on the copy panel below, exactly
    // like Extra information (flat title, bordered content).
    assert.ok(!/\.example-box:hover\s*\{/.test(css),
      'no .example-box:hover — the flat wrapper must not lift like a card');
    assert.ok(!/\.example-box\s*\{[^}]*border-left/.test(css),
      '.example-box must carry no border rail — the title row sits flat');
    assert.ok(!/\.example-box\s*\{[^}]*box-shadow/.test(css),
      '.example-box must carry no shadow — the title row sits flat');
    assert.ok(!/\.example-box\s*\{[^}]*padding/.test(css),
      '.example-box must carry no padding — the title aligns like Extra information');
    // The icon triangle must never collapse: it is a flex item inside the
    // narrow button, and sibling content once squeezed it to zero width.
    assert.ok(/\.replay-button::before[^{}]*\{[^}]*flex-shrink\s*:\s*0/.test(css),
      '.replay-button::before must carry flex-shrink: 0 — the triangle survives any sibling content');
  }
});

cases.push({
  name: 'design: visual diff shrinks to fit — no justify hack, compact hug, trailing spread gone',
  fn: () => {
    assert.ok(!/#typeans-overlay\s*\{[^}]*text-align\s*:\s*justify/.test(css),
      'typing overlay must not justify — wrapped lines keep natural word gaps');
    assert.ok(/\.diff-row-correct,\s*\.diff-row-typed\s*\{[^}]*text-align\s*:\s*left\s*[^}]*line-height\s*:\s*1\.25/.test(css),
      'diff rows must hug left with line-height 1.25 — the visual diff compresses to ~content height');
    assert.ok(/\.verdict-card\s*\{[^}]*padding-top\s*:\s*var\(--s-1_5\)[^}]*padding-bottom\s*:\s*var\(--s-1_5\)/.test(css),
      'verdict card must hug vertically (padding-top/bottom s-1_5) — only ~a sliver of air around the diff text');
    assert.ok(!/#diff-correct-row::after|#diff-input-row::after/.test(css),
      'no trailing full-width ::after must force the last diff line to spread edge-to-edge');
    assert.ok(!/#typeans-overlay::after/.test(css),
      'no trailing ::after on the typing overlay — the spread hack is gone');
  }
});

/* ---------- Front-face scroll model: the card is the scroll surface ----------
   The cue card no longer owns a comfort floor or an inner scrollbar: the base
   `min-height: var(--cue-region-height)` + `max-height: 180px` + `overflow-y:
   auto`, the >=769px +24px gate, the <=768 0.85x floor, and the <=480
   `min-height: 0` override are all removed, so the front face sits at content
   height (no downward bias) and never scrolls internally. The whole card grows
   with its content and the page scrolls instead: `html, body { overflow-y:
   auto }` (scrollbars hidden), `.aurora-card` drops `max-height: 98vh` /
   `overflow: hidden`, and the production block caps it at `max-height: none;
   overflow: visible`. These pins keep the scroll model from regressing to
   inner-component scrolling or a re-armed viewport cap. */

cases.push({
  name: 'design: cue-card has no min-height floor and no inner scrollbar — the whole card is the scroll surface',
  fn: () => {
    assert.ok(!/\.cue-card\s*\{[^}]*min-height\s*:/.test(css),
      'no .cue-card rule may set min-height — the comfort floor and every override are removed');
    assert.ok(!/\.cue-card\s*\{[^}]*padding-top\s*:/.test(css),
      'no .cue-card rule may set padding-top — the desktop +24px gate is removed');
    const base = ruleBlock('\\.cue-card');
    assert.ok(!/overflow(-y)?\s*:\s*(auto|scroll)/.test(base),
      'base .cue-card must not scroll internally (no overflow-y: auto/scroll)');
    assert.ok(!/max-height\s*:/.test(base),
      'base .cue-card must not cap its height (no max-height)');
    assert.ok(/\.aurora-card\s*\{[^}]*max-height\s*:\s*none\s*;/.test(css),
      'production .aurora-card must be max-height: none — the card grows with content');
    assert.ok(/\.aurora-card\s*\{[^}]*overflow\s*:\s*visible\s*;/.test(css),
      'production .aurora-card must be overflow: visible — no inner card scrolling');
    assert.ok(/html,\s*body\s*\{[^}]*overflow-y\s*:\s*auto\s*;/.test(css),
      'html, body must scroll vertically (overflow-y: auto) so the whole card is the scroll surface');
  }
});

cases.push({
  name: 'design: .recall-card internal gap stays on the base token (--s-2, 8px max) — no bare 16px tail override',
  fn: () => {
    const base = ruleBlockExact('.recall-card');
    assert.ok(/gap\s*:\s*var\(--s-2\)/.test(base),
      'base .recall-card must use gap: var(--s-2) (8px max)');
    assert.ok(!/\.recall-card\s*\{\s*gap\s*:\s*var\(--s-4\)/.test(css),
      'no bare .recall-card { gap: var(--s-4) } (16px rung) may exist — it beat both the base rule and the <=768 override');
  }
});

/* ---------- BUG-021: settings-menu surface consistency ----------
   The 2026-08-14 menu fix (neutral glass on .settings-menu) left the
   collapsed "Mer ▾" extras section painting `background: var(--tag-bg)`
   — a green plate from --aurora-accent-rgb that clashed with the neutral
   menu glass. jsdom cannot resolve var() in computed styles, so these are
   raw-rule text assertions: the extras surfaces must not paint --tag-bg. */

cases.push({
  name: 'design: extras (Mer ▾) menu surfaces paint no --tag-bg plate — settings menu stays neutral glass end-to-end',
  fn: () => {
    // Standalone (not group-list, not descendant) rule block for the exact
    // selector. Formatting-agnostic: matches ".extras-trigger {" in the
    // readable root and the minified publish artifact alike.
    const standaloneRule = (sel) => {
      const re = new RegExp('\\.' + sel + '\\s*\\{');
      const m = css.match(re);
      if (!m) throw new Error('standalone rule not found: .' + sel);
      let depth = 0;
      for (let i = m.index + m[0].length - 1; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
          depth--;
          if (depth === 0) return css.slice(m.index, i + 1);
        }
      }
      throw new Error('unbalanced standalone rule: .' + sel);
    };
    const trigger = standaloneRule('extras-trigger');
    assert.ok(!/background\s*:\s*var\(--tag-bg\)/.test(trigger),
      '.extras-trigger must not paint background: var(--tag-bg) — the extras section belongs to the neutral settings-menu glass');
    const content = standaloneRule('extras-content');
    assert.ok(!/background\s*:\s*var\(--tag-bg\)/.test(content),
      '.extras-content must not paint background: var(--tag-bg) — the extras rows sit on the neutral menu glass');
    assert.ok(!/var\(--tag-bg\)/.test(trigger + content),
      'no --tag-bg fill may remain in the extras section (trigger or content)');
  }
});

/* ---------- 2026-09-18: settings-menu theme tint ----------
   The menu surfaces now carry a whisper of the aurora accent — rgba
   var(--aurora-accent-rgb) at 0.07 -> 0.03 over --surface-elevated — so the
   chrome echoes the theme without breaking the neutral-glass contract. The
   tint must reference the token (never a literal colour) and must not
   reintroduce backdrop-filter. */

cases.push({
  name: 'design: settings-menu surfaces tint with var(--aurora-accent-rgb) over --surface-elevated — no literal colours, no backdrop-filter',
  fn: () => {
    const menus = css.match(/\.settings-menu\s*\{[^}]*\}/g);
    assert.ok(menus && menus.length >= 2, 'expected at least two .settings-menu rules (desktop + <=1024)');
    menus.forEach((rule) => {
      assert.ok(/background\s*:\s*linear-gradient\(180deg,\s*rgba\(var\(--aurora-accent-rgb\),\s*0\.07\)\s*0%,\s*rgba\(var\(--aurora-accent-rgb\),\s*0\.03\)\s*100%\),\s*var\(--surface-elevated\)/.test(rule),
        'each .settings-menu must paint the accent-tinted gradient over --surface-elevated: ' + rule.slice(0, 140));
      assert.ok(!/backdrop-filter/.test(rule), 'no backdrop-filter may return to the settings menu');
    });
    assert.ok(!/background\s*:\s*#[0-9a-fA-F]{3,6}/.test(menus.join('')),
      'menu backgrounds must not use literal hex colours — the tint is token-driven');
  }
});

/* ---------- ≤480 between-group rungs (baseline, pre-compact revert) ----------
   The ≤480 tier uses --s-4 (16px) as the between-group rung on .typing-area
   and .example-box — the baseline value, restored with the pre-compact
   revert. This pin locks the rung in the cascade-winning tail tier. */

cases.push({
  name: 'design: ≤480 between-group margins are tightened — typing-area --s-2, example-box --s-4',
  fn: () => {
    const b480 = lastMediaBlock(480);
    assert.ok(/\.typing-area\s*\{[^}]*margin\s*:\s*var\(--s-2\)\s+0\s+var\(--s-1\)\s*;/.test(b480),
      '≤480 .typing-area must use the tightened --s-2 top rung');
    assert.ok(/\.example-box\s*\{[^}]*margin-top\s*:\s*var\(--s-[34]\)\s*;/.test(b480),
      '≤480 .example-box must use the baseline --s-4 margin-top');
    assert.ok(!/\.card-back \.verdict-card\s*\{[^}]*padding-right\s*:\s*64px/.test(css),
      'no 64px right gutter may return to the verdict card — it left-shifted the diff and wrapped rows early on phones');
  }
});

/* ---------- Verdict gutters stay symmetric (mobile left-shift revert) ----------
   A one-sided padding on .verdict-card (the old 64px right gutter) pushed the
   diff left and wrapped rows early despite visible space. Gutters must stay
   symmetric at every width: no padding-right longhand on any verdict rule. */

cases.push({
  name: 'design: verdict-card gutters are symmetric at every width — no padding-right longhand',
  fn: () => {
    const rules = css.match(/\.verdict-card[^{]*\{[^}]*\}/g) || [];
    assert.ok(rules.length >= 3, 'expected several .verdict-card rules, got ' + rules.length);
    rules.forEach((rule) => {
      assert.ok(!/padding-right\s*:/.test(rule),
        'no padding-right longhand may sit on the verdict card — asymmetric gutters left-shifted the diff: ' + rule.slice(0, 120));
    });
  }
});

/* ---------- Phase 2 compaction: structural trims (BUG-022) ----------
   The expand/hint <summary> rows swap their 44px min-height for an absolute
   ::before hitbox (the .hint-reveal trigger pattern) so the visual row collapses to
   content height while the touch target keeps the 44px minimum.
   (BUG-025: the decorative .study-ribbon is now removed at EVERY width —
   coherence — so its ≤480 hide rule is gone with it.) */

cases.push({
  name: 'design: ≤480 expand/hint touch targets sit on a ::before hitbox — density without losing tap size',
  fn: () => {
    const b480 = lastMediaBlock(480);
    assert.ok(!/\.cue-card \.study-ribbon\s*\{[^}]*display\s*:\s*none\s*;/.test(b480),
      'no ≤480 .cue-card .study-ribbon display:none rule may remain — the ribbon is fully removed (BUG-025)');
    assert.ok(/\.hint-reveal-trigger\s*,\s*\.expand-trigger\s*\{[^}]*min-height\s*:\s*0\s*;/.test(css),
      '≤480 triggers must drop the 44px min-height so the visual row shrinks to content height');
    assert.ok(/\.hint-reveal-trigger::before\s*,\s*\.expand-trigger::before\s*\{[^}]*height\s*:\s*44px\s*;/.test(css),
      '≤480 triggers must carry a 44px ::before hitbox so the tap target survives the visual shrink');
  }
});

/* ---------- BUG-024: desktop back-face context row ----------
   The back face keeps its desktop profile: image + example share one
   horizontal chunk on desktop (spatial contiguity). The >=769px gate is
   source-last, so the <=768 tiers are untouched. */

cases.push({
  name: 'design: desktop (>=769px) back face — context is a side-by-side row with baseline rungs',
  fn: () => {
    const b = lastMediaMinWidth(769);
    assert.ok(/\.back-section--context\s*\{[^}]*display\s*:\s*flex\s*;/.test(b),
      '>=769px .back-section--context must be a flex row — image + example share one spatial chunk');
    assert.ok(/\.back-section--context\s*\{[^}]*flex-direction\s*:\s*row\s*;/.test(b),
      '>=769px .back-section--context must be row (side-by-side), not the stacked column');
    assert.ok(/\.back-section--context \.example-box\s*\{[^}]*margin-top\s*:\s*0\s*;/.test(b),
      '>=769px the example must drop its top rung inside the context row');
    assert.ok(/\.back-section--context \.recall-thumb img\s*\{[^}]*height\s*:\s*clamp\(64px, 12vh, 96px\)\s*;/.test(b),
      '>=769px the thumb clamp keeps the row beside the example');
    assert.ok(/\.recall-card\s*\{[^}]*padding\s*:\s*var\(--s-3\)\s+var\(--s-4\)\s*;/.test(b),
      '>=769px .recall-card padding uses the tightened --s-3/--s-4 rungs');
    assert.ok(/\.expand-container\s*\{[^}]*margin-top\s*:\s*var\(--s-2\)\s*;/.test(b),
      '>=769px the expand disclosure uses the --s-2 rung');
    assert.ok(/\.footer-toolbar\s*\{[^}]*margin-top\s*:\s*var\(--s-2\)\s*;/.test(b),
      '>=769px the footer toolbar uses the --s-2 rung');
    assert.ok(/\.diff-row-label\s*\{[^}]*margin-bottom\s*:\s*var\(--s-1_5\)\s*;/.test(b),
      '>=769px diff labels use the --s-1_5 rung');
  }
});

/* ---------- BUG-025: decorative ribbon removal + anchored headword ----------
   Coherence principle (Mayer 2009): the .study-ribbon labels on both faces
   are aria-hidden decoration, not learning content — removed at every
   width. The back headword is restructured so the grammatical pre-training
   cues (pos-badge / IPA / audio) live in their own flex row BELOW the hero
   word instead of wrapping around it: a long word or phrase can no longer
   displace the badge off its anchor. The .word-meta rung (margin-top
   var(--s-3)) also clears the .swedish-word::after underline, which now
   acts as a divider between the word and the meta row. */

cases.push({
  name: 'design: .study-ribbon is fully removed from the stylesheet and the back headword is anchored below the hero word',
  fn: () => {
    assert.ok(!/\.study-ribbon/.test(css),
      'no .study-ribbon rules may remain — the decorative ribbon is removed at every width (coherence, BUG-025)');
    assert.ok(!/\.study-ribbon/.test(backHtml),
      'Back.html must not contain the ribbon markup');
    assert.ok(!/\.study-ribbon/.test(frontHtml),
      'Front.html must not contain the ribbon markup');
    assert.ok(/\.word-meta\s*\{[^}]*display\s*:\s*flex\s*;/.test(css),
      '.word-meta must be a flex row — the pos/ipa/audio anchor below the word');
    assert.ok(/\.back-section--word\s*\{[^}]*display\s*:\s*flex\s*;/.test(css),
      '.back-section--word must be flex so the meta row stays anchored below the word');
    assert.ok(/\.back-section--word\s*\{[^}]*flex-direction\s*:\s*column\s*;/.test(css),
      '.back-section--word must be a column — word above, anchored meta below');
    assert.ok(/\.back-section--word\s*\{[^}]*align-items\s*:\s*center\s*;/.test(css),
      '.back-section--word must centre its flex children (long phrases wrap centred)');
    assert.ok(/\.swedish-word\s*\{[^}]*display\s*:\s*inline-block\s*;/.test(css),
      '.swedish-word must be inline-block so the underline hugs the word and wrapped phrases centre');
    assert.ok(/\.swedish-word\s*\{[^}]*max-width\s*:\s*100%\s*;/.test(css),
      '.swedish-word must cap at 100% so a long phrase wraps inside the card');
    assert.ok(/\.word-meta\s*\{[^}]*margin-top\s*:\s*var\(--s-2\)\s*;/.test(css),
      '.word-meta must have margin-top var(--s-2) so the row clears the ::after underline without extra air');
  }
});

/* ---------- baseline sanity budget (pre-compact revert, 2026-09-18) ----------
   The card is back to the pre-compact baseline: fixed tokens, 848px front
   shell, 1024px back cap, 900px desktop tier. The whole card scrolls via
   html/body overflow-y:auto (never an inner cue/answer scrollbar), so the
   vertical budget is a runaway-growth ceiling, not a fit-in-viewport demand.
   This budget is two-ended:
   (1) MINIMUM breathing — the base cue/recall cards keep their baseline
       padding, the region heights stay restored, and the body floor stays
       >= 13px;
   (2) MAXIMUM bound — the front shell stays <= 848px and the back cap
       <= 1024px (no 960/1060px shell may return).
   The device matrix (360x640 … 1440x900, plus short screens at max-height
   560/680) must stay structurally safe: no horizontal overflow (100vw guards
   + width:100% tiers at <=768/<=480), and vertical stacks may scroll as a
   whole without clipping. */

function pxOf(token) {
  const px = token.match(/^([\d.]+)px$/);
  if (px) return parseFloat(px[1]);
  const rem = token.match(/^([\d.]+)rem$/);
  if (rem) return parseFloat(rem[1]) * 16;
  throw new Error('unparseable token value: ' + token);
}

cases.push({
  name: 'design: baseline sanity budget — minimum breathing + maximum width bound + device matrix stays structurally safe',
  fn: () => {
    const root = tokenBlock(':root');
    const s = (t) => pxOf(root[t]);

    // (1) MINIMUM breathing — base card padding and region heights stay baseline
    const cue = ruleBlockExact('.cue-card');
    const recall = ruleBlockExact('.recall-card');
    assert.ok(/padding\s*:\s*var\(--s-2\)\s+var\(--s-3\)/.test(cue),
      'base .cue-card must keep the tightened padding: var(--s-2) var(--s-3)');
    assert.ok(/padding\s*:\s*var\(--s-3\)\s+var\(--s-4\)/.test(recall),
      'base .recall-card must keep the tightened padding: var(--s-3) var(--s-4)');
    assert.strictEqual(root['--cue-region-height'], '100px', '--cue-region-height must stay 100px');
    assert.strictEqual(root['--typing-region-height'], '64px', '--typing-region-height must stay 64px');
    assert.ok(s('--fs-base') >= 13, 'body floor must stay >= 13px');

    // (2) MAXIMUM bound — the shell must not creep toward 960/1060px
    assert.ok(!/960px/.test(css), 'no 960px card width may return');
    assert.ok(!/1060px/.test(css), 'no 1060px card width may return');
    assert.ok(/min\(848px,\s*calc\(100vw\s*-\s*32px\)\)/.test(css), 'front width budget <= 848px');
    assert.ok(/min\(848px,\s*calc\(100vw\s*-\s*8px\)\)/.test(css), 'production width budget <= 848px');
    assert.ok(/\.card-front,\s*\.card-back\s*\{[^}]*max-width\s*:\s*1024px\s*;/.test(css),
      'back cap must stay <= 1024px');

    // (3) horizontal safety — 100vw guards on the caps + width:100% tiers
    const b480 = firstMediaBlock(480);
    const b768 = lastMediaBlock(768);
    assert.ok(/\.aurora-card\s*\{[^}]*width\s*:\s*100%\s*;/.test(b480),
      '<=480 tier must set .aurora-card { width: 100% }');
    assert.ok(/\.aurora-card\s*\{[^}]*width\s*:\s*100%\s*;/.test(b768),
      '<=768 tier must set .aurora-card { width: 100% }');

    // (4) whole-card scroll model — no inner cue/answer scrollbar may return
    assert.ok(!/\.cue-card\s*\{[^}]*overflow-y\s*:\s*(?:auto|scroll)/.test(css),
      'no inner .cue-card scrollbar may return — the card scrolls as a whole');
    assert.ok(!/\.cue-card\s*\{[^}]*max-height/.test(css),
      'no .cue-card max-height may return — the card grows to content height');
    assert.ok(/html,\s*body\s*\{[^}]*overflow-y\s*:\s*auto/.test(css),
      'html/body must keep overflow-y: auto (whole-card scroll)');
  }
});

/* ---------- round-4 mobile/tablet UX (2026-09-18) ----------
   The ≤768 fullscreen aurora host override is gone so the host stays
   card-sized and the static body::before backdrop is visible around the
   card on phones too. The source-last ≤768 tier also carries the phone
   compaction: an even larger hero word (the top of the reading ladder),
   full-width justified copy (no 68ch left-hug), a stronger card outline,
   a viewport-bounded compact settings menu, and the two-line tap-to-expand
   visual diff. The explanation plate reads more opaque than the old 0.06 tint. */

cases.push({
  name: 'design: ≤768 aurora host is card-sized — the fullscreen !important override is gone',
  fn: () => {
    assert.ok(!/\.hna-aurora-host\s*\{[^}]*height\s*:\s*100%\s*!important/.test(css),
      'the ≤768 fullscreen .hna-aurora-host override must not return');
    assert.ok(/\.hna-aurora-host\s*\{[^}]*position\s*:\s*absolute/.test(css),
      'the base .hna-aurora-host must stay position: absolute (scrolls with the card)');
  }
});

cases.push({
  name: 'design: body is the aurora host containing block — relative body + mobile clip-path matches radius',
  fn: () => {
    assert.ok(/body\s*\{\s*min-height\s*:\s*100vh[^}]*position\s*:\s*relative/.test(css),
      'body must be position:relative so the absolute aurora host scrolls with the card on phones (body is the scroll container)');
    assert.ok(css.includes('.aurora-card { width: 100%; border-radius: var(--radius-md); clip-path: inset(0 round var(--radius-md));'),
      '≤768 card silhouette (clip-path) must equal its border-radius (both --radius-md)');
    assert.ok(css.includes('.aurora-card { width: 100%; min-width: 100%; border-radius: var(--radius-md); clip-path: inset(0 round var(--radius-md));'),
      '≤480 card silhouette (clip-path) must equal its border-radius (both --radius-md)');
  }
});

cases.push({
  name: 'design: ≤768 mobile compaction — larger hero, full-width copy, stronger outline, compact menu, unclamped diff',
  fn: () => {
    const b = lastMediaBlock(768);
    assert.ok(/\.swedish-word\s*\{\s*font-size\s*:\s*clamp\(1\.25rem,\s*6vw,\s*1\.875rem\)\s*!important\s*;/.test(b),
      '≤768 hero word must stay the largest tier (clamp 1.25rem→1.875rem), above the titles and the long-form copy');
    assert.ok(/\.prompt-content\s*\{[^}]*max-inline-size\s*:\s*100%/.test(b),
      '≤768 prompt copy must drop the 68ch cap (full-width, no left-hug)');
    assert.ok(/\.aurora-card\s*\{[^}]*border-color\s*:\s*var\(--border-accent\)/.test(b),
      '≤768 card outline must strengthen to --border-accent');
    assert.ok(!/\.diff-row\.diff-clamped/.test(css),
      'diff rows must never clamp — the Visa mer 2-line clamp was removed for small Android screens');
    assert.ok(!/\.diff-toggle\s*\{/.test(css),
      'no .diff-toggle expander may remain — answers always render in full');
  }
});

cases.push({
  name: 'design: mobile word-meta one row + --fs-content tier diff text with whole-word wrap',
  fn: () => {
    assert.ok(!/\.word-meta \.ipa\s*\{\s*flex-basis\s*:\s*100%/.test(css),
      '≤480 must not push the IPA onto its own full-width row — pos/IPA/replay share one row');
    assert.ok(/\.word-meta \.ipa\s*\{[^}]*flex\s*:\s*0 1 auto[^}]*white-space\s*:\s*nowrap/.test(css),
      '≤480 .word-meta .ipa must be shrinkable and wrap as a whole unit (white-space: nowrap)');
    assert.ok(/\.pos-badge\s*\{[^}]*flex-shrink\s*:\s*0[^}]*white-space\s*:\s*nowrap/.test(css),
      '.pos-badge must not shrink and must wrap as a whole unit');
    assert.ok(/\.diff-row-correct\s*\{[^}]*font-size\s*:\s*var\(--fs-content\)/.test(css),
      'diff correct row must read at the --fs-content tier (14px, same as the example and the extra-info prose)');
    assert.ok(/\.diff-row-typed\s*\{[^}]*font-size\s*:\s*var\(--fs-content\)/.test(css),
      'diff typed row must read at the --fs-content tier too — no more 11px small print');
    assert.ok(/\.swedish-word\s*\{[^}]*overflow-wrap\s*:\s*break-word/.test(css),
      'back hero must wrap at whole-word boundaries (overflow-wrap: break-word, not anywhere)');
    assert.ok(/\.swedish-word\s*\{[^}]*text-wrap\s*:\s*normal/.test(css),
      'back hero must fill the line before wrapping (text-wrap: normal, not balance)');
    assert.ok(/\.diff-row-correct\s*\{[^}]*overflow-wrap\s*:\s*break-word/.test(css),
      'diff correct row must wrap at whole-word boundaries');
    assert.ok(/\.diff-row-typed\s*\{[^}]*overflow-wrap\s*:\s*break-word/.test(css),
      'diff typed row must wrap at whole-word boundaries');
  }
});

cases.push({
  name: 'design: settings menu width never exceeds the viewport (base + ≤1024 + ≤768)',
  fn: () => {
    const bounded = css.match(/min\(240px,\s*calc\(100vw\s*-\s*[\d]+px\)\)/g) || [];
    assert.ok(bounded.length >= 2,
      'at least two .settings-menu width tiers must be viewport-bounded, got ' + bounded.length);
    const b = lastMediaBlock(768);
    assert.ok(/\.settings-menu\s*\{[^}]*width\s*:\s*min\(240px,\s*calc\(100vw\s*-\s*24px\)\)/.test(b),
      '≤768 settings menu must be viewport-bounded');
    assert.ok(/\.settings-menu\s*\{[^}]*background\s*:\s*linear-gradient\(180deg,\s*rgba\(var\(--aurora-accent-rgb\),\s*0\.07\)\s*0%,\s*rgba\(var\(--aurora-accent-rgb\),\s*0\.03\)\s*100%\),\s*var\(--surface-elevated\)/.test(b),
      '≤768 settings menu must keep the accent-tint gradient over --surface-elevated');
    assert.ok(/\.menu-item\s*\{[^}]*font-size\s*:\s*var\(--fs-sm\)/.test(b),
      '≤768 menu rows must compact to --fs-sm');
  }
});

cases.push({
  name: 'design: explanation plate is a glass surface matching the example-box (typing) / option buttons (mcq)',
  fn: () => {
    const m = css.match(/\.expand-content\s*\{[^}]*background\s*:\s*transparent/);
    assert.ok(m, '.expand-content must paint no solid background so the glass-lift layer shows');
    assert.ok(!/\.expand-content\s*\{[^}]*background\s*:\s*var\(--surface-elevated\)/.test(css),
      '.expand-content must not fall back to the solid --surface-elevated plate');
    assert.ok(/\.expand-content\s*\{[^}]*--glass-crown\s*:\s*0\.20/.test(css),
      '.expand-content must carry the example-box glass crown so the typing note type matches its example panel');
    assert.ok(/class="expand-content glass-pseudo"/.test(backHtml),
      'typing Back.html must tag the expand-content with glass-pseudo');
  }
});

cases.push({
  name: 'design: aurora layers are proportional to the card box (no fixed px overscan or travel)',
  fn: () => {
    // Base ribbon matches the host/card exactly (no overscan bleed).
    assert.ok(/\.aurora-bg\s*\{[^}]*inset\s*:\s*0\s*;/.test(css),
      '.aurora-bg inset must be 0 so the visible aurora matches the card box');
    // Pseudo overscan is %-based, not fixed px.
    const pseudoBlock = ruleBlock('\\.aurora-bg::before,\\s*\\.aurora-bg::after');
    assert.ok(!/inset\s*:\s*-120px/.test(pseudoBlock),
      '.aurora-bg::before/::after must not use a fixed -120px inset — use % so it scales with card size');
    // Mid ribbon also proportional.
    assert.ok(!/\.aurora-bg--mid\s*\{[^}]*inset\s*:\s*-120px/.test(css),
      '.aurora-bg--mid must not use a fixed -120px inset');
    // Keyframe travel is in %, not px, so it tracks card size.
    ['hnaAuroraBase', 'hnaAuroraOverlay', 'hnaAuroraMid'].forEach(function (name) {
      const re = new RegExp('@keyframes\\s+' + name + '\\s*\\{[\\s\\S]*\\}');
      const m = css.match(re);
      assert.ok(m, '@keyframes ' + name + ' must exist');
      assert.ok(!/translate3d\([^)]*px/.test(m[0]),
        '@keyframes ' + name + ' travel must use % not px so the animation scales with the card');
    });
  }
});

cases.push({
  name: 'design: visual-diff rows carry 1em arrow indicators — blue into the answer, red into the typed row',
  fn: () => {
    assert.ok(/\.diff-row-correct::before[^{}]*\{[^}]*width\s*:\s*1em/.test(css),
      'correct row ::before must be 1em wide — the arrow matches the font size');
    assert.ok(/\.diff-row-typed::before[^{}]*\{[^}]*height\s*:\s*1em/.test(css),
      'typed row ::before must be 1em tall');
    assert.ok(/\.diff-row-correct::before[^{}]*\{[^}]*background-color\s*:\s*var\(--sweden-blue\)/.test(css),
      'correct row arrow must be sweden-blue — the corrected-answer indicator');
    assert.ok(/\.diff-row-typed::before\s*\{[^}]*background-color\s*:\s*var\(--diff-wrong-text\)/.test(css),
      'typed row arrow must be diff-wrong-text red — the typed-answer indicator');
    assert.ok(/\.diff-row-(correct|typed)::before[^{}]*\{[^}]*mask-image\s*:\s*url\('data:image\/svg\+xml,%3Csvg/.test(css),
      'row arrows must use encoded mask-image URIs — raw brackets broke icons before');
    assert.ok(!/\.diff-row-(correct|typed)::before[^{}]*\{[^}]*mask\s*:\s*url/.test(css),
      'row arrows must not use the mask shorthand — its size syntax dropped a whole icon before');
  }
});

cases.push({
  name: 'design: card never outgrows the wrapper content box — centred at every width',
  fn: () => {
    assert.ok(/\.card-wrapper\s*>\s*\.aurora-card\.card-front\s*,\s*\.card-wrapper\s*>\s*\.aurora-card\.card-back\s*\{[^}]*max-width\s*:\s*100%\s*;/.test(css),
      'face cards must cap max-width: 100% of the wrapper — viewport budgets overflowed right on tablet');
  }
});

cases.push({
  name: 'design: front cue hierarchy — meaning is hero, pos-badge is subordinate metadata',
  fn: () => {
    assert.ok(/\.pos-badge\s*\{[^}]*font-size\s*:\s*var\(--fs-xs\)/.test(css),
      '.pos-badge must sit at --fs-xs (0.75rem) — metadata, never competing with the meaning cue');
    assert.ok(!/\.pos-badge\s*\{[^}]*font-size\s*:\s*var\(--fs-base\)/.test(css),
      '.pos-badge must not return to --fs-base — it tied the meaning on small screens and read as asymmetric');
    assert.ok(/\.prompt-content\s*\{[^}]*font-size\s*:\s*clamp\(1\.0625rem/.test(css),
      '.prompt-content must stay hero-sized (clamp from 1.0625rem) — clearly above the pos-badge tier');
  }
});

module.exports = cases;
