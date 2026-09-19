# HNA Release Report — v7-2026-08-14-1

**Date**: 2026-08-14
**Version**: v7-2026-08-14-1
**Status**: PUBLISH READY (all gates green)

## What this release covers

Refactor release on top of v7-2026-08-13-1. The theme colour system is
**unchanged** — this note type is intentionally re-colorable via
`hna-theme-pack/apply_theme.py`, and the shipped default stays the
light-tone **green** theme (no blue, no pink).

1. **Settings menu fix** — the gear menu panel was green-tinted glass; it is
   now transparent glass with a painted tint (`background: rgba(240,248,255,
   0.12)` over the `.glass-pseudo` recipe). A `backdrop-filter: blur(12px)`
   was initially part of this change, then removed in the fix cycle (BUG-031):
   blur on a scrollable fixed container re-arms the compositor layer for as
   long as the menu is open (RAM leak), and the painted tint does the
   legibility work alone. Zero `backdrop-filter` declarations remain — pinned
   by `design: shipped CSS contains zero backdrop-filter declarations`. The
   `.btn-settings` button keeps its white-only highlight.
2. **`perfMode` / `showAurora` removed** — the config keys, their menu
   entries, `_buildToggleMap` wiring, and the `pause-animation` /
   `pause-aurora` / `reduced-tier` / `ultra-tier-reduced` kill-switch CSS are
   gone. The aurora runs unconditionally. RAM rules (no animated `filter`,
   layer drop via `display:none`) still hold.
3. **Card-type selector removed** — the Betydelse → Ord / Exempel → Ord
   switcher (markup, JS, `.cue-card--example` styles) is deleted; the meaning
   cue card is the only card and stays visible. `showTrans` / `showExample` /
   `showExplain` content toggles are intentionally kept.
4. **Design tests corrected to the shipped green palette** — a stale set of
   assertions hardcoded a blue-cyan light theme (`--glass-tint-rgb`
   78,194,224, `--aurora-card-base` #95CEEA) that never matched the shipped
   default. They now pin the real values: `--glass-tint-rgb` =
   `--aurora-1-rgb` = `79,190,140`, `--aurora-card-base` `#A8D5B8`. All other
   design-contract pins (lift `202,237,246`, mesh `0.42`, accent `#0A5F41`,
   WCAG contrast pairs) already matched the green theme.
5. **Glass show-through token restored** — `.cue-card`, `.recall-card`,
   `.card-tags` and their dedicated `.night-mode` overrides carry
   `--glass-lift-alpha: 0.3` alongside `--surface-transparency-alpha`, per
   the design test's pin.

## Fix cycle — BUG-026 .. BUG-041 (2026-08-14)

A post-release audit verified 16 claimed fixes against the codebase and
recorded them in `docs/BUG_LOG.md`. Verification status as of this report:

**Verified fixed in the current tree** (regression guards pass):

- BUG-026 — empty tag fields hide the tag tray (tag-aware `{{#tag_1..4}}`
  sections in both templates)
- BUG-027 — diff matching is case-insensitive (`_hna_diff.js`)
- BUG-028 — string config values validate through `coerceConfigValue`
  (`_hna_engine.js`)
- BUG-029 — `{{custom_tag}}` replaces the old `{{Tags}}` field reference
  (removed again 2026-08-14 — the tray renders `tag_1..tag_4` only)
- BUG-030 — diff overlay highlights via a per-character runtime regex with an
  ASCII fallback, instead of a fixed word-boundary pattern (`_hna_typing.js`)
- BUG-031 — settings-menu `backdrop-filter` removed (see item 1); pinned by a
  new design test asserting zero declarations
- BUG-032 — light-mode diff text/border tokens now clear contrast on the
  painted plate (≥4.5:1 text / ≥3:1 borders); `fix_diff_vars.py` emits the
  exact `:root` light/dark values (`#0B3D2E` / `#39764A` / `#833125` /
  `#A5513C` / `#35517B` / `#4C6B96` / `#66470F` / `#A45208`), asserted by the
  `design contrast painted (STRICT): light char-*` cases and the
  flagged-theme lockstep test
- BUG-033 — the sweden-blue/sweden-yellow swap in the 4 flagged themes was
  corrected (midnight-navy is now blue/yellow and agrees with the palette)
- BUG-034 — CSS section banners renumbered to be monotonically increasing
  (0,1,2,2.5,3,4,4.1,7,8,8.5,8.6,9,10,11,12,13,14,15,16,17,18,19,20 — a
  deliberate gap after 4.1 where 5/6 were retired)
- BUG-035 — Escape closes the settings menu / hides the hint via
  `stopImmediatePropagation` (`_hna_engine.js`)
- BUG-036 — Ctrl+J / Ctrl+H `preventDefault` is scoped to the typing field
  (a `handled` flag, `_hna_engine.js`)
- BUG-037 — IME-composition keystrokes ignored (`!e.isComposing` guards in
  typing and engine shortcuts)
- BUG-038 — Anki's initial `readyState` branch removed from the typing init
  (`setTimeout(initTypeAnswer, 50)` is the only path)
- BUG-039 — typed-answer paste capped at 2000 chars (`_hna_typing.js`; the
  Back-face diff plate caps at 40000)
- BUG-040 — rAF callbacks cancel-before-reschedule and null after fire
  (`_hna_engine.js`, `_hna_aurora.js`)

- BUG-041 — test-harness hardening, all four holes closed and pinned by
  regression cases: unknown `run-all.js` flags exit non-zero naming the flag
  and the known list (`tests/run-all.js:44-56`); harness `ROOT` resolves at
  access time so a staged run can never silently read the source tree
  (`tests/harness.js:14-23`); minify-css throws on unterminated block
  comments instead of truncating the rest of the CSS
  (`tests/minify-css.js:20-28`); timer/rAF flushes run every callback,
  aggregate the errors, and rethrow (`tests/harness.js:25-35`).

## Gate results (all green)

| Gate | Bucket | Passed | Failed |
|---|---|---|---|
| 1 | Pre-flight (static contracts, fonts, unknown-flag, TODO/`\p{` scans, preview freshness) | 15 | 0 |
| 2 | Unit (diff, storage, config, typing) | 74 | 0 |
| 3 | RAM / leak (20-flip churn, singletons, listeners) | 16 | 0 |
| 4 | Design (contrast, tokens, motion, breakpoints, backdrop-filter scan, theme matrix, sweden-swap regression) | 64 | 0 |
| 5 | UI / DOM (structure, menu, shortcuts, overlay, verdicts, stylesheet parity, inline-script predicates) | 18 | 0 |
| — | **Total** | **187** | **0** |
| 6 | Preview — `preview/preview.html` (regenerated from staged bundle) | — | — |
| 7 | Publish — `node tests/run-all.js --publish` | staged 8 files, SHA256SUMS.txt written, full suite re-run against staged bundle | 0 |

## Files changed

- `_hna_styles_v7.css` — settings menu transparent glass; removed
  pause/reduced-tier blocks; restored `--glass-lift-alpha: 0.3` on
  cue/recall/tags + night overrides. Theme palette untouched (still green).
- `_hna_engine.js` — removed `perfMode`/`showAurora` (defaultConfig,
  MENU_SPEC, `_buildToggleMap`, `toggleConfig` mutual-exclusion)
- `_hna_typing.js` — removed card-type selector block (379 lines)
- `Front.html` — removed card-type selector markup + `.cue-card--example`
- `preview/build-preview.js` — removed perf/aurora preview toggles
- `preview/preview.html` — regenerated
- `tests/unit/config.test.js` — MENU_SPEC 11, defaults, no mutual-exclusion
- `tests/unit/typing.test.js`, `tests/ui/dom.test.js` — meaning-only assertions
- `tests/design/design.test.js` — kill-switch tests → always-on tests; glass-
  tint / card-base pins corrected to the green palette
- `tests/pre-flight.js` — aurora always-on contract
- `docs/ARCHITECTURE.md`, `RESOURCE_MANAGEMENT.md`, `PUBLISH_WORKFLOW.md` —
  removed-feature references cleaned
- `docs/BUG_LOG.md` — 16 fix-cycle entries (BUG-026..BUG-041); stale claims
  in BUG-003/009/015/016/018/019 and ISSUE-002 corrected to match the current
  tree (test names, removed-feature supersession notes)
- `docs/README.md` — `Tags` field reference renamed to `custom_tag`; file
  sizes refreshed to current bytes
- `docs/PUBLISH_WORKFLOW.md` — contrast counts updated to 30 (all strict),
  pre-flight checklist corrected (comment-stripping motion contract,
  no TODO/FIXME scan), corner-mark bullet replaced with the removal assertion,
  backdrop-filter + flagged-theme lockstep checks added
- `docs/RELEASE_REPORT-v7-2026-08-14-1.md` — this report
- `_hna_engine.js` — `loadConfig` coerces known boolean string values and
  ignores unknown keys (BUG-028); Escape closes via `stopImmediatePropagation`
  (BUG-035); Ctrl+J/H `preventDefault` scoped to the action branch (BUG-036);
  IME guard (BUG-037); rAF cancel-before-schedule (BUG-040)
- `_hna_diff.js` — case-insensitive exact match, `typed.toLowerCase() ===
  correct.toLowerCase()` (BUG-027)
- `_hna_typing.js` — runtime `\p{L}\p{N}` regex with ASCII fallback (BUG-030);
  Enter IME guard (BUG-037); dead `readyState === 'loading'` init branch
  removed (BUG-038); paste capped at 2000 chars (BUG-039)
- `_hna_aurora.js` — rAF registration cancels before rescheduling (BUG-040)
- `Front.html` / `Back.html` — tag-aware hide-empty predicates (hidden only
  when no img/audio/video AND no text); tag tray uses `tag_1..tag_4` + `ID`
  (BUG-026/BUG-029)
- `_hna_styles_v7.css` — `backdrop-filter` removed (BUG-031); light diff
  tokens darkened to the `:root`-exact set (BUG-032); section banners
  renumbered ascending (BUG-034); stale corner-mark comments rewritten;
  motion-contract carve-out for the `hna-typing-bloom` box-shadow exception
- `hna-theme-pack/fix_diff_vars.py` + `midnight-navy.json`, `teal-harbor.json`,
  `violet-storm.json`, `denim-worn.json` — diff-token lockstep with `:root`
  (BUG-032); sweden-blue/sweden-yellow swap corrected (BUG-033)
- `tests/run-all.js`, `tests/harness.js`, `tests/minify-css.js` — harness
  hardening (BUG-041)
- `tests/pre-flight.js` — unknown-flag exit, fonts exist, TODO/FIXME scan,
  no `\p{` literal scan, preview freshness
- `tests/unit/diff.test.js`, `tests/unit/config.test.js`,
  `tests/unit/typing.test.js`, `tests/ui/dom.test.js` — regression cases for
  the fix cycle (case-insensitive e2e, coercion, Ctrl+J focus, template
  parity, inline-script predicates)
- `tests/design/design.test.js` — backdrop-filter scan, flagged-theme
  diff-token matrix, painted-pair thresholds tightened to AA
- `preview/build-preview.js` — freshness gate; `preview/preview.html`
  regenerated from the refreshed staged bundle

## What is still required from a human (cannot be automated)

1. **Preview visual pass** — open `preview/preview.html` and confirm the
   green theme, the transparent settings panel, and night mode at
   375/768/1200 px.
2. **Anki import** — paste `Front.html`/`Back.html` into the template
   editor, drop the 5 JS + CSS + fonts into `collection.media`, sync, and
   review a few cards (type answers, open settings once).
3. **Memory sanity** — watch the QtWebEngineProcess child RSS after
   review; it must return to baseline.
