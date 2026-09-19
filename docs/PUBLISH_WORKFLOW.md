# HNA Publish Workflow

The release gate. **Nothing ships to Anki until every gate below is green.**
Each gate is a single command; gates 2–5 share one runner
(`node tests/run-all.js`) and print a unified report.

```
┌──────────────────────────────────────────────────────────────┐
│  1. PRE-FLIGHT   node tests/run-all.js --preflight           │
│     static contracts: script order, ES5, no-infinite,        │
│     no will-change, no settings markup in HTML, fonts refs   │
├──────────────────────────────────────────────────────────────┤
│  2. UNIT         node tests/run-all.js --unit                │
│     diff algorithm, storage, config layering, typing logic   │
├──────────────────────────────────────────────────────────────┤
│  3. RAM/LEAK     node tests/run-all.js --ram                 │
│     listener counts, global handles, aurora singleton,       │
│     decoder reuse, menu laziness, flip churn                 │
├──────────────────────────────────────────────────────────────┤
│  4. DESIGN       node tests/run-all.js --design              │
│     contrast pairs (30: all strict), token stepping, │
│     contract, corner-mark removal, theme lockstep            │
├──────────────────────────────────────────────────────────────┤
│  5. UI/DOM       node tests/run-all.js --ui                  │
│     template structure + parity, menu build, shortcuts,      │
│     typing overlay, diff rendering, verdicts, a11y roles     │
├──────────────────────────────────────────────────────────────┤
│  6. PREVIEW      open preview/preview.html AND                  │
│     mcq/preview/preview_mcq.html                                │
├──────────────────────────────────────────────────────────────┤
│  7. PUBLISH      node tests/run-all.js --publish             │
│     stages the main 8 files + the mcq bundle into publish/,  │
│     checksums, verifies the staged bundle with the full      │
│     suite, prints checklist                                  │
└──────────────────────────────────────────────────────────────┘
```

The MCQ note type (`mcq/`) sits in the same pipeline: it is pre-flighted,
integration-tested, staged into `publish/mcq/`, and re-tested against the
staged bundle — nothing MCQ ships until every gate (including the safety
backdoor contract below) is green.

## Gate details

### 1. Pre-flight (static analysis, no DOM)

Checks that can be done with pure file reads:

- [ ] The 5 `_hna_*.js` files contain no ES6+ syntax that breaks older
      QtWebEngine (`const`/`let`/arrow/`Array.fill`/template literals)
- [ ] `_hna_engine.js` appears before `_hna_diff.js` and `_hna_typing.js`
      in both HTML files' script lists
- [ ] CSS has no `infinite` animation-iteration counts (bounded only),
      no `will-change`, no animated `filter`
- [ ] No settings markup (`sw_`, `menu-item`, `toggle-switch`) in the HTML
      files — settings must live in `MENU_SPEC` only
- [ ] Both HTML files reference the same CSS + script set (no drift)
- [ ] `@font-face` src files exist in the media bundle (or are declared)
- [ ] The `mcq/` font copies are byte-identical to the root fonts (one media
      source of truth for both note types)
- [ ] `package-lock.json` is present, lockfileVersion >= 2, tracks every
      `package.json` dependency, and pins the jsdom tree (fresh clones stay
      installable with `npm ci`; `npm test` / `npm run test:publish` work)
- [ ] `.aurora-bg` is not present in either HTML template (singleton-only)
- [ ] No `close()` call on the AudioContext anywhere
- [ ] The motion contract strips CSS block comments first, then rejects any
      `\binfinite\b`, `will-change`, or animated `filter` token — so comment
      mentions never false-positive (the old `grep -c infinite` counting
      check is obsolete); a TODO/FIXME/HACK marker scan runs over the
      shipped files

The same static audits cover the MCQ note type (`mcq/`): the 4 `_mcq_*.js`
modules must be ES5-clean, `_mcq_styles.css` must pass the motion contract,
the script order `_mcq_storage → _mcq_engine → _mcq_logic → _mcq_aurora`
must hold in both `mcq/Front.html` and `mcq/Back.html`, its fonts must
exist, and `mcq/preview/preview_mcq.html` must never be older than the mcq
sources.

#### MCQ safety backdoor (progressive enhancement)

The raw answer divs (`#mcq-raw-data .mcq-raw-ans`) are the source for the
interactive grid AND the built-in static fallback. One rule makes a card
impossible to strand with zero options:

- The stylesheet hides the raw list by default (`.mcq-raw-ans{display:none}`)
  and shows it only while `html:not(.mcq-ready)`;
- `_mcq_logic.js` adds `mcq-ready` to `<html>` only after the interactive
  grid has rendered (on both faces) — if JS dies or throws before that, the
  marker is never set and the plain list stays readable;
- the back face marks the correct slot with `data-correct` + the verified
  `--diff-correct-*` tokens; the front face stays neutral;
- the hidden `#mcq-question-raw` signature node never shows in any mode;
- the raw divs must carry NO inline `style` hiding (the stylesheet owns it),
  verified by the pre-flight backdoor contract test;
- note fields are untrusted: option text is bound with `textContent` on both
  faces (the old `+ item.text +` innerHTML sink is gone — BUG-044), verified
  by the mcq integration XSS case.

This contract is enforced by `tests/pre-flight.js` (static) and
`tests/unit/mcq.integration.test.js` (a hermetic jsdom run of the real
storage/engine/logic modules: grid build, shuffle config, state round-trip,
verdict tones, neutral no-state, empty-choices marker absence, keydown
lifecycle).

### 2. Unit tests

- [ ] Levenshtein distance matches known values (incl. 0 for equal, cost
      bounds)
- [ ] Alignment backtrace is optimal (kitten→sitting; near-miss ≤ 2)
- [ ] `computeDiff` gap/extra/missing branches
- [ ] Config layering: default < persistent < storage, and storage wins
- [ ] `toggleConfig` flips the value and persists (ultraMode removed
      2026-08-14 — no tier toggles remain)
- [ ] MENU_SPEC keys == defaultConfig keys (no drift)
- [ ] Storage: safeGet/safeSet with cookie fallback; silent failure
- [ ] Typing: placeholder slots, correct/wrong/extra classes, trim logic,
      buffer+storage cleared together, hint appends one char

### 3. RAM / leak tests (jsdom)

- [ ] Listener counts on `window.__hna*` handles stay at exactly 1 after
      N simulated flips
- [ ] Timer/rAF handles are single values (replaced, not stacked)
- [ ] Aurora: exactly one `#hna-aurora-host`, direct child of `<body>`,
      not recreated across flips
- [ ] `AnkiEngine.__decoder` is one reused node
- [ ] Settings menu built lazily (absent at load, present after
      `toggleSettings`)
- [ ] AudioContext identity stable across `playTone`
- [ ] Flip churn: no detached-subtree retention reachable from globals
- [ ] Typed-answer buffer cleared on new card

### 4. Design tests

- [ ] All 30 contrast pairs pass STRICT: 18 non-painted plus 12 painted-glass.
      Every case holds WCAG AA (≥ 4.5:1 text, ≥ 3.0:1 large text) — including
      the former WARN chrome tokens (light muted #5A5244 on lift/card
      base/painted glass; light accent #0A5F41 on card base; night accent on
      lift), all raised to ≥ 4.5:1 (see `tests/design/design.test.js`)
- [ ] `--fs-3xl`/`--fs-2xl` step down at 1024/768/480
- [ ] Corner marks fully removed — no orphaned `.card-corner-accent` rules
      remain (the old padding>inset check is obsolete)
- [ ] `.glass-pseudo` shared recipe present; `--glass-mesh-opacity` night =
      0.20 (AA fix) and light = 0.42
- [ ] Stripe color lockstep: shared ribbon rule references
      `var(--aurora-card-base)` (light `#A0D5B4`, night `#101B16`)
- [ ] Text tokens: no `--text-muted` on text surfaces (only chrome)
- [ ] Motion contract: no `infinite`, no `will-change`, no animated filter
- [ ] Aurora runs unconditionally — no `pause-animation` / `pause-aurora`
      selectors remain; `pause-aurora-flow` is allowed for user motion pause
- [ ] Zero `backdrop-filter` declarations in shipped CSS (settings-menu blur
      removed for the compositor-leak fix — see BUG-031)
- [ ] Flagged themes' light/dark `--diff-*` tokens clear 4.5:1 (text) /
      3:1 (border) on the painted plate and agree with `:root`

### 5. UI / DOM tests (jsdom)

- [ ] Front face: all required ids/classes present
- [ ] Back face: all required ids/classes present
- [ ] Template parity: same script/CSS set, same settings stubs
- [ ] Menu build: 10 MENU_SPEC rows + 6 extras inside `Mer ▾` + FB link;
      toggles have `role="switch"` + `aria-checked`
- [ ] Shortcuts: Alt+S opens, Alt+D night, Ctrl+H clicks hint,
      Ctrl+J focuses the answer field, Escape closes
- [ ] Typing: entering "katt" against "katt" produces 4 `.char-correct`;
      wrong char → `.char-wrong`; extra char → `.char-extra`
- [ ] Diff: exact match → `verdict-pop-correct` + "Exakt!"; wrong → diff
      rows + verdict class; empty → typed row hidden
- [ ] `#correct-answer` hidden from the user (display:none contract)
- [ ] Empty-field cleanup: `.hint-reveal`/`.expand-content`/`.recall-thumb`
      hidden when empty

### 6. Preview (human review)

`preview/preview.html` is generated from the shipped files by
`preview/build-preview.js` (run with `HNA_ROOT=<dir>` to build from a
specific bundle; `node tests/run-all.js --publish` regenerates it from the
staged bundle automatically). Open it in a real browser and verify:

- [ ] Front card renders: cue card, typing field with slot dashes, hint
      button, settings gear
- [ ] Typing works: correct/wrong coloring, smooth caret, hint fills a char;
      a very long answer scrolls inside the typing field instead of clipping
- [ ] Flip to Back: recall card, diff rows for a wrong answer, verdict pop,
      tone plays
- [ ] Settings menu: 10 toggles + 6 extras + FB link; Alt+S/Alt+D work
- [ ] Night mode looks correct
- [ ] 375 px / 768 px / 1200 px widths look right (toolbar presets or
      DevTools responsive mode)
- [ ] No console errors in DevTools

### 7. Publish

`node tests/run-all.js --publish`:

- [ ] Copies the 8 main shipped files into `publish/` and the mcq bundle into
      `publish/mcq/` (the mcq CSS also ships minified)
- [ ] Records SHA-256 checksums (main + mcq) into `publish/SHA256SUMS.txt`
- [ ] Regenerates `preview/preview.html` from the staged main bundle and
      `mcq/preview/preview_mcq.html` from the staged mcq bundle
- [ ] Re-runs the full suite (unit, mcq, ram, design, ui) against the staged
      bundle (catches "works in src, broken in publish" drift)
- [ ] Prints the final human checklist (below)

### Final human checklist (before pushing to Anki)

1. Paste `Front.html` and `Back.html` into the template editor.
2. Drop the 5 `_hna_*.js` + `_hna_styles_v7.css` into `collection.media`.
3. Drop `_Inter.ttf`, `_JetBrainsMono.ttf` into media if not present.
4. Sync Anki; do a 10-card real review; watch the OS process for the
   QtWebEngine child — RSS must return to baseline after review.
5. If the deck has an `ANKI_PERSISTENT_CONFIG` injector, verify toggle
   priority still respects user settings (config layering test covers it).
6. MCQ note type: paste `mcq/Front.html` and `mcq/Back.html` into its template
   editor; drop `mcq/_mcq_styles.css` + the 4 `mcq/_mcq_*.js` into media.
7. MCQ backdoor spot check: open `mcq/preview/preview_mcq.html`, answer a
   card both ways, then DISABLE JavaScript once — the static raw list must
   render (marker never set) so no card is ever left with zero options.

## When to re-run which gates

| Change | Gates to re-run |
|---|---|
| `_hna_diff.js` | 1, 2, 3, 5 |
| `_hna_typing.js` | 1, 2, 3, 5 |
| `_hna_engine.js` | 1, 2, 3, 4, 5 |
| `_hna_storage.js` | 1, 2, 3 |
| `_hna_aurora.js` | 1, 3 |
| `mcq/*` templates/modules/CSS | 1, mcq (+ preview always) |
| CSS tokens / rules | 1, 4 (+ preview always) |
| HTML templates | 1, 3, 5 (+ preview always) |
| Anything | full suite: `node tests/run-all.js` |

## Adding a new test

1. Put it in the right bucket: `tests/unit`, `tests/ram`, `tests/design`,
   `tests/ui`.
2. Export it as `module.exports = [{ name, fn }]`; the runner does the rest.
3. Name it `area: what it verifies` so failures are self-explanatory.
4. If it asserts a *policy* (leak rules, token rules, contrast), also add a
   one-line note to the matching docs section so the policy stays discoverable.
