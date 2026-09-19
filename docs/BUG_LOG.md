# HNA Bug Log

Complete ledger of known bugs — fixed, open, and latent. Each entry records
the symptom, root cause, and fix. New bugs found by the subagents or tests
should be appended here with a date.

## Fixed bugs

### BUG-001 — Diff DP table overwritten by plain numbers (v6 fix)
- **File**: `_hna_diff.js` → `levenshteinDiff`
- **Symptom**: wrong-answer diff rendered as garbage alignment.
- **Root cause**: the per-row init did `dp[i] = i` / `dp[j] = j`, overwriting
  a fresh array with a plain number. Every later `dp[i][j] = ...` write then
  silently no-ops (JS discards property writes on primitives), so the table
  stayed empty.
- **Fix**: `dp[i][0] = i` / `dp[0][j] = j`.
- **Regression guard**: `tests/unit/diff.test.js` — alignment tests with
  substitutions.

### BUG-002 — Diff backtrace walked forward (v6 fix)
- **File**: `_hna_diff.js` → `levenshteinDiff`
- **Symptom**: diff showed the right characters but blamed the wrong ones
  (more errors than the true edit distance).
- **Root cause**: backtrace walked forward from `(0,0)` reading
  `dp[i+1][j+1]` as remaining-cost values. `dp` is a *prefix*-cost table, so
  a forward walk is a heuristic, not an optimal-path walk. It also took every
  equal pair for free before checking whether matching there was on an
  optimal path.
- **Fix**: backtrace runs backward from `(m,n)`; each step asks which
  predecessor actually produced `dp[i][j]`. Match-before-substitute ordering
  prevents marking an equal diagonal pair as a self-substitution.
- **Regression guard**: `tests/unit/diff.test.js` — the classic
  "kitten"/"sitting" alignment and near-miss case.

### BUG-003 — First card threw `AnkiEngine is not defined`
- **File**: both templates (script order)
- **Symptom**: on the very first card, `AnkiAudio` was undefined and the
  correct-answer row rendered empty.
- **Root cause**: `_hna_diff.js` loaded before `_hna_engine.js`; diff
  evaluates `AnkiEngine.decodeHTML` at module load (top-level `renderDiff()`),
  and typing needs the engine present when its delayed init runs
  (`setTimeout(initTypeAnswer, 50)` — see BUG-038).
- **Fix**: hard load-order contract — engine before diff and typing — plus a
  comment in both HTML files. When it regressed, the failure mode was:
  `AnkiEngine.MENU_SPEC` was undefined at the first `updateSwitches()`
  (declared after the top-level `init()` call), which threw and aborted the
  rest of `_hna_engine.js`, so `AnkiAudio` was never assigned.
- **Regression guard**: `tests/pre-flight.js` — `preflight: script load order
  is storage -> engine -> diff -> typing -> aurora` pins the contract;
  engine/audio availability is exercised by `tests/ram/leak.test.js` (decoder
  reuse, single AudioContext) and pre-flight's AudioContext-creation check.

### BUG-004 — Extra typed characters deleted in the same pass
- **File**: `_hna_typing.js` → `updateDisplay`
- **Symptom**: any character typed past the answer's length was inserted then
  immediately removed in the same update pass.
- **Root cause**: the cleanup loop trimmed `flatCharSpans` down to
  `correctAnswer.length` unconditionally, deleting the extra-char spans the
  block above had just created.
- **Fix**: `keepLen = Math.max(correctAnswer.length, typed.length)`.
- **Regression guard**: `tests/unit/typing.test.js` — typing beyond answer
  length keeps extra spans; deleting back re-trims.

### BUG-005 — Stale answer leaked into the next card's diff
- **File**: `_hna_typing.js` / `_hna_diff.js`
- **Symptom**: the Back face showed the *previous* card's answer in the diff.
- **Root cause**: the diff reads `window.__hnaTypedAnswerBuffer` before it
  looks at storage, so clearing storage alone left the buffer holding the
  previous answer.
- **Fix**: both channels cleared together on overlay init and on card-type
  switch.
- **Regression guard**: `tests/unit/typing.test.js` — buffer + storage both
  empty after init.

### BUG-006 — `Array.prototype.fill` broke old QtWebEngine
- **File**: `_hna_diff.js` → `computeDiff`
- **Symptom**: `fill` is ES2015; older Anki webviews threw and the diff rows
  never rendered for gap cases.
- **Fix**: hand-built gap arrays in ES5.
- **Regression guard**: `tests/design/design.test.js` — ES5 scan of shipped JS.

### BUG-007 — Settings menu duplicated in two templates
- **File**: `Front.html` + `Back.html` (both carried a ~99-line
  `<template id="settings-template">`)
- **Symptom**: every menu change had to be made twice by hand; the two faces
  silently drifted.
- **Fix**: single `AnkiEngine.MENU_SPEC` in `_hna_engine.js`, menu built
  lazily per card.
- **Regression guard**: `tests/ui/dom.test.js` — both templates contain no
  `settings-template`, and menu items count matches `MENU_SPEC`.

### BUG-008 — Light-mode aurora stripes rendered as a dark oil-slick band
- **File**: `_hna_styles_v7.css` → `.aurora-bg::before`
- **Symptom**: a dark petrol band ran through the middle of the card in
  light mode.
- **Root cause**: light mode used `invert(1)` on a `#fff` stripe layer,
  producing black stripes on near-white paper.
- **Fix**: stripe colour matches the card behind it in each mode
  (`#97B0CD` light / `#000` night); both modes share one rule.
- **Regression guard**: visual (preview) + `tests/design/design.test.js`
  token lockstep check (stripe hex vs `--aurora-card-base`).

### BUG-009 — `verdict-pop-correct` printed the word three times
- **File**: `Back.html` + CSS
- **Symptom**: on an exact answer, the word appeared in the verdict plate,
  the recall card, and the (unhidden) typed row.
- **Fix**: `.verdict-pop-correct` collapses the plate to a hug-width
  confirmation chip; `_hna_diff.js` hides the typed row on exact match.
- **Regression guard**: `tests/unit/diff.test.js` — e2e verdict cases
  (exact → `verdict-pop-correct` + hidden typed row, wrong, near-miss, empty)
  and `tests/ui/dom.test.js` — `ui: back face renders the diff verdict` /
  `ui: wrong typed answer renders verdict-wrong`. The chip rules themselves
  live in `_hna_styles_v7.css` (`.verdict-card.verdict-pop-correct`, the
  `Exakt!` label) with no dedicated CSS-contract assertion.

### BUG-010 — Aurora singleton drift: host sized against a transformed rect
- **File**: `_hna_aurora.js`
- **Symptom**: the halo sat at a stale size/position (measured offset
  dL 3.64, dT 7.25, dW −7.31, dH −4.19) on every card.
- **Root cause**: the double-rAF lands ~2 frames in — mid `hna-card-appear`
  (220 ms) — so the host was sized against a translated/scaled rect. The
  ResizeObserver never fires because a transform doesn't change the layout
  box.
- **Fix**: an `animationend` listener on the per-flip `.aurora-card` re-syncs
  after the appear animation (keyed on `hna-card-appear`/`uq-card-appear`).
  Note: the ultra-quality keyframe name is `uq-card-appear` and is handled.
- **Regression guard**: `tests/ram/leak.test.js` — aurora host sync function
  exists and re-measures.

### BUG-011 — AudioContext churn (see RAM_LEAK_ANALYSIS.md §4)
- **Fix**: one session context, no `close()`.
- **Regression guard**: `tests/ram/leak.test.js` — `AnkiAudio.ctx` identity
  stable across `playTone` calls; no `close()` call site in shipped JS.

### BUG-012 — Per-flip listeners/observers retained (see RAM_LEAK_ANALYSIS.md §3)
- **Fix**: stored-handle teardown pattern everywhere.
- **Regression guard**: `tests/ram/leak.test.js` listener-count churn test.

### BUG-013 — Night-mode glass mesh made body copy fail WCAG AA
- **File**: `_hna_styles_v7.css` `.night-mode` tokens
- **Symptom**: measured backdrops came back mid-luminance green
  (rgb(49,78,76)) and body copy fell under 4.5:1.
- **Root cause**: `--glass-mesh-opacity: 0.72` laid too much prism chroma
  over the dark lift.
- **Fix**: 0.20; plus text tokens moved from `--text-muted` (reserved for
  non-text chrome) to `--text-secondary` across `.giaithich`, `.ex-trans`,
  `.row-info .label`.
- **Regression guard**: `tests/design/design.test.js` — computed contrast
  for every text/backdrop pair used by the card (52 pairs, 0 AA failures).

### BUG-014 — Typed input was not ES5-safe in `computeDiff` gap arrays (dup of 006)
- Recorded for completeness; same fix as BUG-006.

### BUG-015 — `hna-card-appear` vs `uq-card-appear` sync gap (ultra mode)
- **File**: `_hna_aurora.js` / CSS
- **Symptom**: with Ultra Quality on, the post-appear re-sync keyed on
  `hna-card-appear` did not fire because ultra uses `uq-card-appear`.
- **Status**: acknowledged in comments as pre-existing behavior. The
  animationend handler originally listened for **both** names; that state was
  superseded by the tier removal below. The current handler keys on
  `hna-card-appear` only (`_hna_aurora.js:114-119`), verified by
  `tests/ram/leak.test.js` — `ram: aurora host syncs to the card rect
  (animationend re-measure)` (fires `hna-card-appear`).
- **Resolved by removal (2026-08-14)**: the Ultra tier was consolidated away;
  `uq-card-appear` no longer exists, `hna-card-appear` carries its values,
  and the handler keys on `hna-card-appear` only.

### BUG-016 — Settings menu text had raw "▾" next to a drawn chevron
- **File**: `Front.html` (`.hint-reveal-trigger`)
- **Symptom**: two arrows side by side, one never moving.
- **Fix**: removed the literal "▾"; the `::after` chevron remains.
- **Regression guard**: `tests/ui/dom.test.js` — `ui: front template
  structure` asserts the `.hint-reveal` details (and its trigger) exists; no
  literal-`▾` scan exists in the tests. The only remaining "▾" in the
  codebase is the settings menu's "Mer ▾" extras trigger, built from
  `AnkiEngine.MENU_SPEC` in `_hna_engine.js` — a different surface.

### BUG-017 — Light-mode aurora hexes drifted from their `-rgb` companions (found by tests)
- **Date**: 2026-08-13
- **File**: `_hna_styles_v7.css` `:root` tokens
- **Symptom**: the CSS design tests (hex ↔ rgb companion consistency) failed
  for light mode: `--aurora-1: #FF6B6B` / `--aurora-1-rgb: 78,194,224`,
  `--aurora-2: #FF8787` / `--aurora-2-rgb: 47,168,200`, and
  `--aurora-accent: #FF9999` / `--aurora-accent-rgb: 14,106,75` did not
  match. The `-rgb` triples matched the intended cooler teal/cyan/dark-green
  ribbons (the SVG art uses `#12805B` greens), so the hexes had drifted to
  pinks during an earlier retheme pass and only the rgb companions were kept
  up to date. Night mode was consistent, proving the drift was light-mode-only.
- **Root cause**: a retheme pass updated the `-rgb` tokens (consumed by
  `background-image` gradients via `rgb(var(--aurora-*-rgb))`) but left the
  three light-mode hexes stale. The hexes are not directly consumed by any
  rule, which is why the visual never regressed — the drift was invisible to
  users and only surfaced through the token-consistency tests.
- **Fix**: light `--aurora-1: #4EC2E0`, `--aurora-2: #2FA8C8`,
  `--aurora-accent: #0E6A4B`, matching the `-rgb` companions exactly.
- **Contrast note**: post-fix `--aurora-accent` (#0E6A4B) on the pale pink
  lift (255,195,203) measures ~4.35:1 — passes AA large-text (3.0) but not
  strict AA 4.5 for small text. The accent is used at small sizes in a few
  places; tracked as a WARN-level pair in `tests/design/design.test.js`.
- **Regression guard**: `tests/design/design.test.js` — light and night
  hexes must equal their `-rgb` companions; accent must be green-dominant
  and dark; `design: shared ribbon rule stripes use var(--aurora-card-base)`
  ensures the stripe colour and `--aurora-card-base` stay in lockstep.

### BUG-018 — Card-type switching hid every cue card (mode id vs class suffix) (found by preview)
- **Date**: 2026-08-13
- **File**: `_hna_typing.js` → `applyCardType`
- **Symptom**: clicking any of the 3 card-type buttons hid ALL cue cards
  (`meaning-word`, `word-meaning`, `example-word` all `display:none`), so the
  prompt area went blank and only the typing bar remained.
- **Root cause**: the mode ids (`meaning-word`, `word-meaning`,
  `example-word`) do not match the cue-card class suffixes (`--meaning`,
  `--word`, `--example`). `document.querySelector('.cue-card--' + mode)`
  resolved to `.cue-card--meaning-word` etc., which do not exist, so the
  "show active" line was a silent no-op while the hide-all loop always ran.
- **Fix**: explicit mode → cue-suffix map inside `applyCardType`.
- **Regression guard**: `tests/ui/dom.test.js` — `ui: card-type buttons
  switch cue-card visibility in all 3 modes` clicks each button and asserts
  exactly one cue card visible and the rest hidden.
- **Resolved by removal (2026-08-14)**: the card-type selector — and with it
  `applyCardType` and all three cue-card modes — was removed; the meaning cue
  card is the only card and stays visible. The old 3-button regression guard
  is gone; the current tests assert the opposite direction:
  `typing: card-type selector removed — meaning cue card is the only one and
  stays visible` and `ui: meaning-word mode answers the word with the meaning
  cue card visible` (both assert `.card-type-btn` count is 0 and exactly one
  `.cue-card--meaning` is visible).

### BUG-019 — example-word mode never gap-filled the example (found by preview)
- **Date**: 2026-08-13
- **File**: `_hna_typing.js` → `applyCardType`
- **Symptom**: in Exempel → Ord mode the example text stayed ungapped (no
  `___` blank) on the Front card, so the mode looked identical to a plain
  reading exercise.
- **Root cause**: two faults. (1) The gap logic read the target word from
  `.swedish-word`, a class that exists only on the Back face, so
  `targetWord` was empty on the Front. (2) Even with the word found, the
  mode never re-targeted the answer: `#correct-answer` still carried the
  meaning from the init-time `meaning-word` pass, so the typing target and
  the hidden answer span disagreed.
- **Fix**: fall back to `.cue-card--word .prompt-content` on the Front, and
  re-target `correctAnswer`/`correctAnswerSpan` to the word (same rebuild
  path as `word-meaning`) so the gapped example answers the word.
- **Regression guard**: `tests/ui/dom.test.js` — `ui: example-word card type
  gaps the word inside the example text on the FRONT` asserts `.gap-blank`
  renders, the example cue is visible, and `#correct-answer` is the word.
- **Resolved by removal (2026-08-14)**: the `example-word` mode was removed
  with the card-type selector (see BUG-018), so both the fault and this fix
  no longer apply. The current contract is meaning-only: `typing: card-type
  selector removed` and `ui: meaning-word mode answers the word with the
  meaning cue card visible`.

### BUG-020 — Aurora animation dead: motion/veil tokens deleted from `:root`
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` `:root` (between `--aurora-2-rgb` and
  `--blob-a-rgb`)
- **Symptom**: the aurora background never animates — a static wash on every
  platform and in both modes.
- **Root cause**: a refactor deleted the five aurora motion/veil custom
  properties (`--aurora-drift`, `--aurora-sway`, `--aurora-veil-cycle`,
  `--aurora-veil-base`, `--aurora-veil-overlay`) from `:root`. The
  `.aurora-bg::before/::after` animation declarations reference them via
  `var()`; an undefined `var()` makes the whole `animation` declaration
  invalid at computed-value time → `animation: none`. Night-mode veil
  overrides survived, so only light mode also lost the veil tokens.
- **Fix**: restored the five tokens in `:root` (values from the backup:
  9s / 7s / 6s / 0.85 / 0.95).
- **Regression guard**: `tests/design/design.test.js` — BUG-020 cases assert
  the motion/veil tokens are defined in `:root` and that every
  `var(--aurora-*)` in the `.aurora-bg` animation/opacity declarations
  resolves.

### BUG-021 — Tail overrides beat every breakpoint: cue-card 128px floor + recall-card 16px gap
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` tail (post-keyframes override block)
- **Symptom**: the front cue card kept a 128px minimum height at every
  viewport width and the back recall card kept 16px internal section gaps, so
  mobile cards sat ~44px taller (front) and ~24px taller (back) than the
  breakpoint design intended.
- **Root cause**: two UNQUALIFIED tail rules shipped AFTER the breakpoint
  section, so same-specificity later-in-source wins beat both breakpoint
  intents at every width. `.cue-card { min-height: calc(var(--cue-region-height) + 24px) }`
  (=128px) made the ≤768 compact floor (`token × 0.85` ≈ 88px) dead code.
  `.recall-card { gap: var(--s-4) }` (=16px) beat both the base
  `gap: var(--s-2)` (8px) and the ≤768 8px override.
- **Fix**: gated the comfort height inside `@media (min-width: 769px)` (desktop
  keeps 128px; ≤768 gets 88px); added `min-height: 0` to the ≤480 `.cue-card`
  block so a short prompt sizes the card; removed the bare `.recall-card`
  gap rule so the base 8px and ≤768 8px apply at every width.
- **Regression guard**: `tests/design/design.test.js` — `design: cue-card
  comfort min-height (+24px) is desktop-gated at >=769px — compact floors win
  on mobile` and `design: .recall-card internal gap stays on the base token
  (--s-2, 8px) — no bare 16px tail override`.

### BUG-022 — "Mer ▾" extras section kept a green plate after the settings-menu glass fix
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` — `.extras-trigger`, `.extras-content`,
  `.extras-dropdown[open] .extras-trigger`
- **Symptom**: the collapsed "Mer ▾" (extra toggles) section of the gear
  settings menu had a green background while the main menu rows sat on neutral
  frosted glass — two different surfaces in one panel.
- **Root cause**: the settings-menu glass fix (neutral
  `rgba(240,248,255,0.12)` on `.settings-menu`) was applied to the panel
  container only; the extras rules still painted
  `background: var(--tag-bg)` = `rgba(var(--aurora-accent-rgb), 0.12/0.14)` —
  a green plate derived from the aurora accent. No design test pinned the
  menu/extras surfaces, and jsdom returns the unresolved `var()` string in
  computed styles, so the mismatch shipped unseen.
- **Fix**: deleted the four `background: var(--tag-bg)` declarations in the
  extras block; the existing `border-top` hairline keeps section separation.
- **Regression guard**: `tests/design/design.test.js` — raw-rule assertion
  that `.extras-trigger` / `.extras-content` declare no `--tag-bg` fill
  (formatting-agnostic so it also runs on the minified publish artifact).

### BUG-023 — Mobile card too tall: ≤480 compaction pass (density, not hierarchy)
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` tail `@media (max-width: 480px)` +
  `Front.html`
- **Symptom**: on a ~360px phone the full card could not be seen without
  scrolling even though the card holds little information (front ~334px,
  back ~535px before optional content).
- **Root cause**: desktop-sized paddings, margins and decorative layers
  (front ribbon, answer invitation, prompt underline, aurora divider, 44px
  summary rows, oversized card paddings, a second between-group rung
  `--s-7` = 22px) that earn their space on desktop but just consume vertical
  budget on phones.
- **Fix**:
  - Phase 1 (CSS-only): `--s-7` demoted to `--s-4` on `.typing-area` and
    `.example-box`; `.cue-card` / `.recall-card` paddings tightened; footer,
    tag tray, diff-label and word-row spacing reduced; `.aurora-divider` and
    `.prompt-content::after` hidden; recall thumb clamp shrunk.
  - Phase 2 (structural): removed the aria-hidden `.answer-invitation` node
    from `Front.html`; front `.cue-card .study-ribbon` hidden at ≤480; the
    44px expand/hint tap targets moved from `min-height` onto an absolute
    `::before` hitbox (the `.btn-hint` pattern) so the visual row shrinks to
    ~24px while the touch target keeps the minimum.
- **Regression guard**: `tests/design/design.test.js` — `design: ≤480
  between-group margins demote --s-7 (22px) to --s-4 (16px)…` and `design:
  ≤480 hides the front ribbon and moves expand/hint touch targets onto a
  ::before hitbox — density without losing tap size`.

### BUG-024 — Desktop back card still chunky: ≥769px compaction (spatial contiguity + rung trims)
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` — new source-last `@media (min-width: 769px)`
  block
- **Symptom**: after BUG-023 compacted phones, the back face on desktop still
  stacked a full-width ~140px illustration above the example and kept generous
  between-group rungs (`--s-7` = 20px), plate padding (16px vertical) and
  feedback chrome margins — roughly ~640px tall before optional content.
- **Root cause**: the ≤480 tier was compacted but the desktop base rules kept
  their tall profile: `--s-7` rung on `.example-box`, 16px `.recall-card`
  padding, a full-width 18vh thumb between the meaning and the example, and
  wide spacing around the verdict/diff/footer blocks.
- **Fix** (evidence-based, Mayer & Moreno 2003 spatial contiguity; Sweller
  1988 CLT; Cowan 2001 working-memory chunks):
  - Context is one chunk: `.back-section--context` becomes a centered flex
    row at ≥769px — illustration and usage example sit side-by-side (saves up
    to ~150px of vertical stack when both are present); the thumb clamp
    shrinks to `clamp(64px, 12vh, 96px)` and the example's `--s-7` top rung
    drops to 0 inside the row.
  - Between-group rungs tighten: `.recall-card` padding 16→12px vertical,
    `.expand-container` and `.footer-toolbar` `--s-3`→`--s-2`, `.word-info-row`
    `--s-1_5`→`--s-1`, `.entry-caption` top margin zeroed.
  - Feedback chrome: `.verdict-card` vertical padding 10→8px and bottom margin
    `--s-2_5`→`--s-2`, `.diff-row-label` margin `--s-2`→`--s-1_5`, diff
    separator `--s-2`→`--s-1_5`, `.study-ribbon-back` bottom margin 10→6px.
  - All trims live in one source-last ≥769px gate: every ≤768 tier and the
    ≤480 tail block keep their own values untouched.
- **Regression guard**: `tests/design/design.test.js` — `design: desktop
  (>=769px) back face compacts — context is a side-by-side row and
  between-group rungs tighten` (uses new `lastMediaMinWidth` helper).

### BUG-025 — Long words/phrases orphan the pos-badge; decorative ribbons are learning noise
- **Date**: 2026-08-14
- **File**: `Front.html`, `Back.html`, `_hna_styles_v7.css`
- **Symptom**: the back headword sat in one centered flex row
  (`.word-info-row`) with the pos-badge, the 56px hero word, the IPA and the
  audio icon. With a short word it read fine; with a long word or phrase the
  hero wrapped to several lines and the badge — wedged on the same row —
  wrapped below it as a visually orphaned chip, or disappeared off the
  reader's attention entirely. Both faces also carried an aria-hidden
  decorative `.study-ribbon` label strip that is not learning content.
- **Root cause**: the badge's anchor was *inside* the flex-wrap row that
  contained the word, so the word's wrapping behavior directly governed
  where the badge landed. The ribbons were decoration that added extraneous
  load with no retrieval value.
- **Fix** (evidence-based, Mayer 2009 coherence d≈0.86; spatial contiguity;
  signaling — grammatical pre-training cues must stay visible):
  - Removed the `.study-ribbon` markup from both faces and all of its CSS at
    every width (the ≤480 front-ribbon hide rule went with it).
  - Restructured the back headword into two rows: a `.word-meta` flex row
    (pos-badge + IPA + audio, centered, wrap-safe) *above* a
    `display: inline-block; max-width: 100%` `.swedish-word`, inside a
    block/centered `.back-section--word`. The badge can no longer be
    displaced by word length, and the inline-block keeps the prism underline
    hugging the word while long phrases wrap centered (`text-wrap: balance`).
  - Renamed all `.word-info-row` rules to `.word-meta` (base, the
    `html .word-meta` staggered reveal, ≤480 `.word-meta .ipa` flex-basis
    rule, the ≤480 and ≥769 margin trims).
- **Regression guard**: `tests/ui/dom.test.js` — back-structure test asserts
  no `.study-ribbon` remains and `.word-meta` precedes `.swedish-word`
  (`compareDocumentPosition`); a dedicated case asserts both faces carry no
  ribbon markup. `tests/design/design.test.js` — new pin asserts no
  `.study-ribbon` rules remain in the CSS nor markup in either template, and
  that `.word-meta` is a flex row with `.back-section--word` block/centered
  and `.swedish-word` inline-block; the old ≤480 ribbon-hide test was
  rewritten to the hitbox-only contract.

### BUG-026 — image/example/explain hide-empty predicate was tag/text-naive (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `Front.html` (explain hint-reveal) + `Back.html` (recall-thumb,
  example-box)
- **Symptom**: an element whose field carried an `<img>` but no text (or vice
  versa) was hidden incorrectly. `{{explain}}` / `{{image}}` / `{{example}}`
  can render media-only nodes whose `textContent` is whitespace, so a pure
  `textContent.trim()` emptiness check treated a real image card as empty and
  dropped the section.
- **Root cause**: the hide predicate was tag/text-naive — it only inspected
  text content and never asked whether the element held media.
- **Fix**: tag-aware predicate — the section is hidden only when it has no
  `img`/`audio`/`video` child **and** no non-whitespace text
  (`!el.querySelector('img,audio,video') && !el.textContent.trim()`).
  `Front.html:84-90`, `Back.html:105-118`.
- **Regression guard**: `tests/ui/dom.test.js` — empty explain/example/tags
  sections are dropped (empty-case coverage); the media-only branch has no
  dedicated automated case and is verified in preview.

### BUG-027 — Diff matching was case-sensitive ("katt" vs "Katt" marked wrong) (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_diff.js` → `renderDiff`
- **Symptom**: typing `Katt` against `katt` scored a non-zero Levenshtein
  distance, so the verdict/tone said wrong while the overlay painted the
  characters correct — the two channels disagreed.
- **Root cause**: the typed-vs-correct equality check compared raw strings
  (the DP table already lowercased both sides).
- **Fix**: case-insensitive exact match
  (`typed.toLowerCase() === correct.toLowerCase()`) drives both the tone
  (`_hna_diff.js:41`) and the exact-match verdict (`_hna_diff.js:57`).
- **Regression guard**: `tests/unit/diff.test.js` — `diff: computeDiff
  case-insensitive matching (Katt vs katt is exact)`; the e2e verdict cases
  type lowercase against the harness sample.

### BUG-028 — loadConfig boolean coercion: string "false" stayed truthy (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_engine.js` → `coerceConfigValue` / `loadConfig`
- **Symptom**: a stored `{"nightMode":"false"}` was a truthy string, so night
  mode turned ON instead of off; unknown keys could also drift into the saved
  config and the toggle UI.
- **Root cause**: config values loaded from storage / the host injector were
  copied verbatim instead of coerced to the boolean every known key must hold.
- **Fix**: `coerceConfigValue` (string → `'true'`/`'1'` only,
  case-insensitive, trimmed; number → `=== 1`; else `Boolean(v)`) is applied
  to every known key in `loadConfig`, and unknown keys are never copied into
  `this.config` (`_hna_engine.js:96-138`).
- **Regression guard**: `tests/unit/config.test.js` — defaults typing +
  layering tests; no dedicated `"false"`-string case exists.

### BUG-029 — `{{Tags}}` field reference renamed to `{{custom_tag}}` (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `Front.html` (tag tray) + `Back.html` (tag tray)
- **Symptom**: the tag field referenced `{{Tags}}`, which is Anki's built-in
  card-level Tags field, not a note field — the reference never rendered the
  note's real tag field.
- **Root cause**: the tray used the Anki keyword instead of the note type's
  own field name.
- **Fix**: renamed the reference to `{{custom_tag}}` so the tag renders through
  the note's real field (`Front.html:63`, `Back.html:131`).
- **Regression guard**: `tests/ui/dom.test.js` — tag-badge counts on the back
  face; no `custom_tag`-specific case exists.
- **Superseded (2026-08-14)**: the user does not use a `custom_tag` field — the
  note type reserves `tag_1..tag_4` for the tag tray. The `{{custom_tag}}`
  reference was removed from both faces; the tray now renders only
  `tag_1..tag_4` plus the `ID` badge (see `Front.html:59-63`,
  `Back.html:127-131`).

### BUG-030 — Literal `\p{L}` regex crashed older engines at PARSE time (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_typing.js` → `getPlaceholderState`
- **Symptom**: on QtWebEngine predating Unicode property escapes the whole
  typing module died — the literal `/[\p{L}\p{N}]/u` threw a `SyntaxError`
  before any try/catch could run, so the ASCII fallback was dead code.
- **Root cause**: a literal property-escape regex; property escapes are a
  Chromium 64+ feature.
- **Fix**: the regex is built at runtime inside try/catch
  (`new RegExp('[\\p{L}\\p{N}]', 'u')`, fallback `null` → ASCII `/[a-zA-Z0-9À-ɏ]/i`
  → punctuation-hint), defined once at module scope (`_hna_typing.js:19-20`).
- **Regression guard**: every overlay test exercises `getPlaceholderState`
  through `buildInitialDOM` (placeholder/space/punctuation spans); and since
  Phase 5 a dedicated test forces the ASCII fallback by stubbing the window
  `RegExp` constructor to throw on the `'u'`+`\p{` pattern before the module
  is (re)evaluated — it asserts ASCII + `À-ɏ` chars still letter and a
  Cyrillic char degrades to the punctuation hint (`tests/unit/typing.test.js`).

### BUG-031 — Settings-menu backdrop-filter painted a compositor layer (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` → `.settings-menu`
- **Symptom**: `backdrop-filter: blur(12px)` on the settings panel painted a
  persistent compositor layer, violating the transform+opacity-only rule for
  blurred surfaces (see `RESOURCE_MANAGEMENT.md`).
- **Root cause**: the panel carried `backdrop-filter` + `-webkit-backdrop-filter`
  (was CSS:1445-1446) alongside its real `rgba(240,248,255,0.12)` background.
- **Fix**: the `backdrop-filter` pair was removed; the panel keeps the neutral
  translucent background without an extra compositor layer.
- **Regression guard**: `tests/design/design.test.js` motion-contract cases
  (no `will-change`, no animated `filter`) + the settings-menu neutrality case
  (`design: extras (Mer ▾) menu surfaces paint no --tag-bg plate`); no direct
  `backdrop-filter` assertion exists.

### BUG-032 — Light-mode diff text/border tokens failed contrast on the painted plate (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `hna-theme-pack/fix_diff_vars.py` + `_hna_styles_v7.css` `:root`
- **Symptom**: light-mode diff text/border tokens sat below AA on the painted
  glass plate (borders measured ~2.3:1).
- **Root cause**: the theme-pack generator's light `--diff-*` values were
  picked against the optimistic opaque lift, not the real painted backdrop.
- **Fix**: light-mode values aligned to ≥4.5:1 text / ≥3:1 borders and synced
  with the CSS `:root` block.
- **Regression guard**: `tests/design/design.test.js` — `design contrast
  painted (STRICT): light char-*` cases (painted-glass model, AA_LARGE
  ≥3.0:1).

### BUG-033 — sweden-blue/sweden-yellow values were swapped against their names (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `hna-theme-pack/themes/midnight-navy.json`,
  `teal-harbor.json`, `violet-storm.json`, `denim-worn.json`
- **Symptom**: the `--sweden-blue` token carried a gold/yellow hue and
  `--sweden-yellow` a blue/purple hue — name and value disagreed.
- **Root cause**: a retheme pass wrote the hues into the wrong keys (both
  modes).
- **Fix**: values swapped so `--sweden-blue` is the blue hue and
  `--sweden-yellow` the yellow hue in all four themes, both modes.
- **Regression guard**: no automated theme-JSON test; verified visually via
  `hna-theme-pack/apply_theme.py` output.

### BUG-034 — Section-number headers in `_hna_styles_v7.css` were duplicated/misordered (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` (numbered banner comments)
- **Symptom**: the stylesheet's numbered section banners were out of order —
  two `11`/`12` sections, a `13` appearing after `15`, and a trailing `6` near
  the end of the file — so navigation by header number was misleading.
- **Root cause**: sections were renumbered in place without a full sweep, and
  a late-added fix block kept its original number.
- **Fix**: all section banners renumbered ascending (0 → 20) in source order.
- **Regression guard**: none — header comments only, not asserted by tests.

### BUG-035 — Escape in the settings menu did not stopImmediatePropagation (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_engine.js` → `setupEvents` keydown handler
- **Symptom**: pressing Escape to close the menu let the event fall through to
  Anki's own handlers, risking a double action when the menu closed.
- **Root cause**: the Escape branch only closed the menu.
- **Fix**: the branch calls `e.preventDefault(); e.stopImmediatePropagation();`
  before closing (`_hna_engine.js:246-254`).
- **Regression guard**: `tests/ui/dom.test.js` and `tests/unit/typing.test.js`
  — Escape closes the menu; no stopImmediatePropagation assertion exists.

### BUG-036 — Ctrl+J/H preventDefault fired even when no target element existed (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_engine.js` → `setupEvents` keydown handler
- **Symptom**: on the Back face (no `#typeans`) Ctrl+J still preventDefaulted,
  swallowing the key from Anki even though nothing was focused.
- **Root cause**: the action ran `preventDefault`/`stopImmediatePropagation`
  unconditionally after the shortcut check.
- **Fix**: the actions return a `handled` flag — `preventDefault` +
  `stopImmediatePropagation` fire only when the action actually did something
  (element found, toggle invoked) (`_hna_engine.js:258-268`).
- **Regression guard**: `tests/unit/typing.test.js` (Ctrl+H clicks the hint),
  `tests/ui/dom.test.js` (shortcut set); no absent-element case exists.

### BUG-037 — IME composition: Enter during composition submitted an answer (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_typing.js` (input keydown) + `_hna_engine.js` (global keydown)
- **Symptom**: pressing Enter to commit an IME composition fired the submit /
  blur path, dropping the composed string from the overlay.
- **Root cause**: no `isComposing` guard on either handler.
- **Fix**: typing's Enter blur is guarded by `!e.isComposing`
  (`_hna_typing.js:436`) and the engine's shortcut handler returns early when
  `e.isComposing` (`_hna_engine.js:245`); `compositionend` already runs the
  input pipeline on its own.
- **Regression guard**: none — jsdom cannot synthesize composition events;
  verified in a real browser with an IME.

### BUG-038 — Dead `readyState === 'loading'` DOMContentLoaded branch removed from typing init (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_typing.js` (init)
- **Symptom**: a dead branch registered an anonymous DOMContentLoaded listener
  the next flip's teardown could not cancel — the one documented
  "listener without a stored handle".
- **Root cause**: the branch can never run inside Anki (the webview is long
  complete when a card renders).
- **Fix**: removed; only `setTimeout(initTypeAnswer, 50)` remains
  (`_hna_typing.js:450-456`).
- **Regression guard**: every front-card overlay test (init path is fully
  covered by the typing bucket).

### BUG-039 — Typing overlay paste cap 2000 chars (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_typing.js` → `updateDisplay`
- **Symptom**: pasting a multi-thousand-char string built one span per char on
  the main thread, stalling the Front face.
- **Root cause**: the per-char span build had no upper bound (the Back-face DP
  already capped itself at 40000 cells).
- **Fix**: past `typed.length > 2000` the overlay is dropped entirely — the
  real input still holds the text, so the answer is never lost
  (`_hna_typing.js:288-291`). Back DP cap stays 40000.
- **Regression guard**: `tests/ram/leak.test.js` — `ram: front card DOM node
  count stays under budget after 250 typed chars` guards the span path below
  the cap; the cap itself has no dedicated case.

### BUG-040 — rAF registration: cancel-before-schedule + null after callback (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_engine.js` → `applyConfig` / `updateSwitches`,
  `_hna_aurora.js` → `scheduleSync`
- **Symptom**: repeated `applyConfig` calls (resize storms) and aurora syncs
  could pile up chained animation frames; completed frames left their handle
  pointing at a dead frame id.
- **Root cause**: the one-shot rAFs neither cancelled a pending frame before
  re-scheduling nor nulled the handle on completion.
- **Fix**: both paths cancel a pending frame first and null the handle once the
  callback has run (`window.__hnaEngineRAF` `_hna_engine.js:156-160`;
  `window.__hnaAuroraSync` `_hna_aurora.js:60-71`).
- **Regression guard**: `tests/ram/leak.test.js` — `ram: engine resize
  debounce collapses N resize events into one applyConfig`, `ram: resize
  guards use single handles (no multiply-bound observers)`, `ram: aurora host
  syncs to the card rect`.

### BUG-041 — Test-harness/runner holes (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `tests/run-all.js`, `tests/harness.js`, `tests/minify-css.js`
- **Symptom**: four quiet-failure holes — (1) an unknown CLI flag ran no bucket
  and still exited 0; (2) the harness captured `HNA_ROOT` at require time, so a
  later `HNA_ROOT` change (the `--publish` staged-bundle run) still read the
  source files; (3) `minifyCss` silently truncated the output when a `/*`
  comment was unterminated; (4) harness `__flushTimers`/`__flushRAF` swallowed
  callback errors.
- **Root cause**: silent-failure defaults in the runner/harness plumbing.
- **Fix**: unknown CLI flags now exit non-zero; harness reads `HNA_ROOT` lazily;
  `minifyCss` rejects an unterminated `/*` instead of truncating; harness
  flushes rethrow callback errors so a crashed setup surfaces as a test
  failure.
- **Regression guard**: unknown-flag exit (`tests/pre-flight.js:234-248`),
  harness `ROOT` accessor, `minifyCss` unterminated-comment throw, and flush
  rethrow — all exercised by every `node tests/run-all.js` invocation (all
  buckets), and the `--publish` staged-bundle re-run would now fail loudly if
  the harness read the source tree.
- **Verification status (2026-08-14)**: VERIFIED FIXED. `node
  tests/run-all.js --bogus-flag` exits non-zero naming the flag,
  `tests/harness.js:14-23` resolves `ROOT` at access time,
  `tests/minify-css.js:20-28` throws on an unterminated `/*`, and
  `tests/harness.js:25-35` rethrows aggregated flush errors.

### BUG-042 — Backward diff backtrace matched the phrase tail, not the prefix (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_diff.js` → `levenshteinDiff`
- **Symptom**: typing `ett` against `ett kontakt två kontakt` flagged only the
  leading `e` plus the trailing `t`s of the two `kontakt`s as correct — the
  typed prefix looked aligned to the phrase END, not the phrase START.
- **Root cause**: the backtrace walked the DP table BACKWARD from `(m, n)`,
  which greedily matches the LAST equal characters first. When several optimal
  alignments exist (typing a prefix of a longer phrase), backward picks the
  one that pairs the typed tail with the correct tail.
- **Fix**: the backtrace now walks FORWARD from `(0, 0)`, testing
  `dp[i+1][j+1] === dp[i][j]` / `dp[i][j] + 1` against the prefix-cost table,
  so every step stays on an optimal path but the FIRST equal characters win —
  the prefix alignment a typed answer actually means (`_hna_diff.js:134-171`).
- **Regression guard**: `tests/unit/diff.test.js` — `diff: prefix alignment —
  "ett" typed against a phrase matches the leading word, not the tail`
  (3 leading correct, exactly 20 missed, 0 extra/sub).

### BUG-043 — Chrome-only contrast tokens sat below WCAG AA for text (fix cycle 2026-08-14)
- **Date**: 2026-08-14
- **File**: `_hna_styles_v7.css` (`:root` tokens), `tests/design/design.test.js`
- **Symptom**: 5 contrast pairs were WARN-level (≥ 3.0:1 but < 4.5:1): light
  `--text-muted` on lift/card base/painted glass, light `--aurora-accent` on
  card base, and night accent on lift. The tokens read as text in places
  (menu shortcuts, accent links), so a sub-4.5 floor was a real legibility
  gap, not just a test label.
- **Root cause**: `--text-muted` (`#5E5749`) sat at 4.39:1 against
  `--aurora-card-base` (`#A8D5B8`) and 4.46:1 on the painted plate; light
  `--aurora-accent` (`#0E6A4B`) was 4.05:1 on the card base. Both were tuned
  to pass the opaque-lift surface only.
- **Fix**: darkened light `--text-muted` to `#5A5244` (card base 4.72:1,
  painted plate 4.80:1, lift 6.22:1) and light `--aurora-accent` to
  `#0A5F41` (card base 4.72:1, lift 6.22:1), keeping the `-rgb` companion
  tokens in lockstep (BUG-017). Night accent already cleared AA on the night
  lift (7.10:1). All 30 contrast pairs are now strict.
- **Regression guard**: `tests/design/design.test.js` — all 30 contrast pairs
  assert ≥ 4.5:1 (text) / ≥ 3.0:1 (large text); the WARN branch was removed
  so a token tweak can no longer land a WARN pass silently.

### BUG-036 — Multi-line answers collapsed by `.textContent` reads in diff & typing (2026-09-12)
- **Date**: 2026-09-12
- **Files**: `_hna_engine.js` (`decodeAnswerField`), `_hna_diff.js`, `_hna_typing.js`
- **Symptom**: when a note's word field contained a line break (`<br>`), the Back-face
  headword rendered it across multiple lines, but both the Front typing overlay and
  the Back Levenshtein visual diff read `.textContent`, dropping `<br>` and fusing
  the words into a single run (e.g. `"katt<br>hund"` → `"katthund"`).
- **Root cause**: `.textContent` ignores HTML line break elements entirely.
- **Fix**: introduced `AnkiEngine.decodeAnswerField(html)` which transforms `<br>` into
  `\n` before HTML entity decoding and tag stripping. The typing overlay maps characters
  into `typeableSlots` with `.char-linebreak` markers, and the diff uses a `breakMap`
  to render matching line breaks in the correct-answer row.
- **Regression guard**: `tests/unit/diff.test.js`, `tests/unit/typing.test.js`.

### BUG-037 — Mobile Virtual Keyboard (VKB) flicker on Aurora repositioning (2026-09-12)
- **Date**: 2026-09-12
- **File**: `_hna_aurora.js`
- **Symptom**: when the on-screen keyboard appeared or dismissed on mobile devices (≤768px),
  the aurora background flickered noticeably.
- **Root cause**: `syncAurora()` triggered `getBoundingClientRect()` and wrote inline styles
  on every `visualViewport.resize` event, forcing layout during keyboard animation transitions.
- **Fix**: on mobile (≤768px), CSS `!important` rules already ensure full-viewport backdrop
  coverage; `syncAurora()` now bails early, skipping inline style mutations and double-rAF churn.
  `visualViewport.resize` is used when available without causing redraw storms.
- **Regression guard**: `tests/ram/leak.test.js`.

### BUG-038 — Excessive `applyConfig()` calls on window resize (2026-09-12)
- **Date**: 2026-09-12
- **File**: `_hna_engine.js`
- **Symptom**: `window.addEventListener('resize')` re-applied the entire toggle map on every
  window change, causing redundant style recalculations.
- **Root cause**: legacy resize handler in the engine duplicated work already handled
  by CSS media queries and Aurora's dedicated scheduleSync.
- **Fix**: removed the separate resize handler from `_hna_engine.js`. `applyConfig()` now
  debounces DOM updates using `requestAnimationFrame` (`__hnaEngineRAF`).
- **Regression guard**: `tests/ram/leak.test.js` (applyConfig collapses multiple rapid calls).

### BUG-039 — Stats footer & accessibility improvements (2026-09-12)
- **Date**: 2026-09-12
- **Files**: `Front.html`, `Back.html`, `_hna_engine.js`, `_hna_styles_v7.css`
- **Symptom**: stats footer with card ID and tag info was missing from templates; diff verdict
  lacked ARIA live region announcements for screen readers.
- **Fix**: added `.stats-footer` (`HNA • ID {{ID}} • {{Tags}}`), `showStats` config toggle
  (and `.hide-stats` CSS rule), `title` attributes on tag badges, and `role="status"` +
  `aria-live="polite"` + `aria-atomic="true"` on `#visual-diff-container`.

### BUG-044 — MCQ back-face option labels re-injected via `innerHTML` (XSS sink) (2026-09-17)
- **Date**: 2026-09-17
- **Files**: `mcq/_mcq_logic.js` (initBack)
- **Phase**: 4 (MCQ security hardening)
- **Symptom**: the back face built each result button by string-concatenating
  the user-supplied option text into `btn.innerHTML`. An option whose *rendered
  text content* contained markup at the text level (e.g. a field typed as
  `&lt;b&gt;…&lt;/b&gt;` or `&lt;img src=x onerror=…&gt;`) would be re-parsed by
  the browser into a real DOM element — a stored/marker-XSS injection channel.
- **Root cause**: option text arrives as *text* (read via `textContent` from the
  raw answer divs) but was re-inserted as *HTML*. The front face already used
  `textContent`; only the back face had the `+ item.text +` innerHTML sink.
- **Fix**: `initBack` now builds the badge, option content, and status caption
  with `createElement`/`textContent` — every label is bound as text, never
  parsed as markup. DOM shape (`.option-badge`, `.option-content`,
  `.status-badge.correct|.wrong`) is unchanged.
- **Regression guard**: `tests/unit/mcq.integration.test.js` —
  "mcq security: option text that contains markup stays literal text" drives a
  `&lt;b&gt;…&lt;/b&gt;` / `&lt;img onerror=…&gt;` field through front AND back
  and asserts no element is created and the string surfaces verbatim.

### BUG-045 — MCQ preview left hyphenated fields unsubstituted, exposing the safety backdoor (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `mcq/preview/build-preview.js` (`render`)
- **Phase**: 4 (MCQ preview fidelity)
- **Symptom**: in `mcq/preview/preview_mcq.html`, the four raw answer divs
  (`.mcq-raw-ans`) rendered *below* the footer instead of an interactive option
  grid — i.e. the `html:not(.mcq-ready)` safety backdoor was showing.
- **Root cause**: the preview's `render()` used the field-name class
  `[A-Za-z0-9_ ]`, which excludes the hyphen. Every MCQ field is hyphenated
  (`{{Correct-answer}}`, `{{Distraction-1..3}}`), so those placeholders were
  never substituted. The brace-bearing text then failed
  `AnkiMCQ.getRawChoicesFromDOM()`'s `indexOf('{{') === -1` filter, leaving
  `rawChoices = []`; `initFront` returned early without building the grid or
  adding `html.mcq-ready`, so the CSS fallback (raw answers) stayed visible
  under the footer. The Anki note type itself was correct — Anki substitutes
  hyphenated fields natively; only the preview builder was wrong.
- **Fix**: the field-name pattern is now generic — `{{#([^}]+)}}…{{/\1}}` and
  `{{([^}]+)}}` — so ANY field name is substituted; there is no hand-maintained
  character class left to omit a character. Both builders (`preview/` and
  `mcq/preview/`) also DISCOVER their embedded assets by reading the templates'
  own `<link href>` / `<script src>` tags instead of hardcoded file lists, so a
  newly referenced module is picked up automatically and a missing one fails
  the build loudly. Preview force-rebuilt.
- **Regression guard**: `tests/unit/mcq.integration.test.js` —
  "mcq integration: preview builder resolves every template field (hyphenated
  fields included)" extracts the generated preview's own `render()` + embedded
  `TPL_FRONT`/`TPL_BACK`, runs a full sample, and asserts no `{{…}}` survives;
  "mcq integration: preview render() accepts any field name (no character
  whitelist)" drives `{{Custom-Field.1}}`, `{{Field With Space}}`,
  `{{weird_Char$}}` and a section through `render()` to pin the generic pattern.
  A third guard, "mcq integration: preview embeds the shipped
  CSS/templates/modules byte-for-byte", extracts the embedded `HNA_CSS`/
  `TPL_FRONT`/`TPL_BACK`/`HNA_MODS` and compares them to the shipped files
  (templates/modules exactly; CSS accepts the readable sheet or its minified
  build, since publish stages `minifyCss(source)`) so the preview can never
  silently drift from the release bundle.

### BUG-046 — Publish preview regeneration passed the wrong root to the MCQ builder (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `tests/run-all.js` (`runPublish` builds loop)
- **Phase**: 4 (MCQ preview fidelity)
- **Symptom**: whenever the publish gate actually re-ran preview generation
  (staged inputs newer than the artifact), it aborted with
  `ENOENT: … publish/_mcq_styles.css` and `FATAL: preview regeneration failed`.
  It only appeared to work while the staged bundle was already in sync (the
  freshness gate short-circuited before reading), so the "regenerated from
  staged bundle" line was misleading.
- **Root cause**: `runPublish` passed `HNA_ROOT=PUBLISH_DIR` to both builders,
  but `mcq/preview/build-preview.js` resolves its inputs relative to the MCQ
  directory (`_mcq_styles.css`, `Front.html`, …), so it needs
  `PUBLISH_DIR/mcq`. The typing builder correctly uses the publish root.
- **Fix**: the builds list now carries a per-script staged root
  (`PUBLISH_DIR` for `preview/`, `path.join(PUBLISH_DIR, 'mcq')` for
  `mcq/preview/`).
- **Regression guard**: exercised by the publish gate itself — the staged
  suite runs the two preview-fidelity guards above after regeneration; deleting
  a staged file forces the refresh path that previously threw.

### BUG-047 — CSS size-budget pre-flight wedged `--publish` after a source shrink (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `tests/pre-flight.js` (`preflight: CSS size budget (source + staged minified)`)
- **Phase**: 4 (front-face scroll model / card compact pass)
- **Symptom**: after a CSS edit that made `_hna_styles_v7.css` smaller,
  `node tests/run-all.js --publish` aborted with `PUBLISH ABORTED: pre-flight
  failed.` (`[FAIL] preflight: CSS size budget (source + staged minified)`),
  even though the source was valid and the only problem was a stale
  `publish/_hna_styles_v7.css`.
- **Root cause**: the check asserted `stagedBytes < srcBytes` (staged minified
  vs the readable source size). That comparison is a staleness proxy, not a
  budget: the staged artifact is minified from the *previous* source, so when
  the new source shrinks below the old minified size the assertion fails.
  `runPublish` runs the pre-flight bucket BEFORE `stageBatch`, so the gate
  could never refresh the stale bundle — a permanent deadlock that only
  deleting `publish/` unblocked.
- **Fix**: drop the `stagedBytes < srcBytes` assertion. Keep the 100000
  anti-bloat budget and assert the staged file is a minified build by requiring
  zero block comments (`tests/minify-css.js` strips them). Artifact drift is
  still enforced by `verifyStaged()` inside `runPublish`.
- **Regression guard**: the publish gate itself — a shrink/restage cycle
  (smaller source, pre-flight passes, `--publish` refreshes the bundle).

### BUG-048 — ≤768 aurora override hid the static backdrop and the card-sized halo (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `_hna_aurora.js`, `mcq/_mcq_aurora.js`, `tests/ram/leak.test.js`, `tests/design/design.test.js`
- **Phase**: Round 4 (mobile/tablet UX)
- **Symptom**: on phones/tablets the card read as a flat full-bleed panel: the
  animated aurora filled the whole viewport (no card-shaped halo) and the
  static `body::before` starfield/backdrop was never visible around the card,
  unlike desktop. This was the deliberate BUG-037 fullscreen strategy being
  reversed by a UX decision.
- **Root cause**: the ≤768 `!important` rule forced `.hna-aurora-host` to
  `left:0; top:0; width:100%; height:100%` with an opaque
  `--aurora-card-base`, covering the static backdrop; `syncAurora()` bailed on
  mobile so the host was never measured against the card.
- **Fix**: deleted the CSS override; removed the JS `innerWidth <= 768` bail and
  the `innerWidth > 768` wiring wrapper so all four re-sync paths run at every
  breakpoint; the host now mirrors the card box exactly. All aurora layer
  geometry became proportional to the card (`inset: 0` ribbon, `-20%` pattern
  overscan, keyframe travel in % of the layer box) so the animation scales with
  card size — no fixed-px overhang or travel. RAM geometry assertions updated
  to the exact card rect (top 34/height 500; top 60/height 480). Other round-4
  mobile pieces: hero word `--fs-xl`, full-width copy (68ch cap dropped),
  stronger card outline, viewport-bounded compact settings menu, 2-line
  tap-to-expand diff (`applyDiffClamp`), collapsed Extra information, capped
  images, and a more opaque `.expand-content` (0.06 → 0.14).
- **Regression guard**: `tests/design/design.test.js` (aurora host,
  proportional aurora layers, mobile compaction, settings-menu bounds,
  explanation opacity), `tests/unit/diff.test.js` (`applyDiffClamp`),
  `tests/ram/leak.test.js` (host geometry). Note: BUG-037's VKB-flicker concern
  is mitigated by the retained double-rAF coalescing and the single
  `visualViewport.resize` handle, not by skipping the re-sync.

### BUG-049 — fixed aurora host disconnected from the card once the page scrolled (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `_hna_aurora.js`, `mcq/_mcq_aurora.js`, `tests/ram/leak.test.js`, `tests/design/design.test.js`
- **Phase**: Round 5 (aurora/back-face/explanation refinements)
- **Symptom**: the `glass-pseudo` surfaces and the animated aurora layer no
  longer matched in position/size on mobile and tablet once the (taller) back
  face scrolled — the aurora host sat at fixed viewport coordinates while the
  card box moved with the page.
- **Root cause**: `.hna-aurora-host` was `position: fixed` — it ignores
  document scroll, so a scrolled-down card moved away from its host.
- **Fix**: switched the host to `position: absolute` (it is `body.firstChild`;
  `body` itself is static, so the host's containing block is the initial block
  and it scrolls with the page). Both `_hna_aurora.js` and `mcq/_mcq_aurora.js`
  now write document coordinates `rect.left + window.pageXOffset` /
  `rect.top + window.pageYOffset`; the two files remain byte-identical. No
  scroll listener was needed, so the RAM listener-count invariants are
  untouched.
- **Regression guard**: design pin `.hna-aurora-host { ... position: absolute }`
  (replaces the earlier `position: fixed` assertion); RAM host-geometry
  assertions unchanged (jsdom `pageXOffset` defaults to 0, so the exact
  `'12px'/'34px'/'700px'/'500px'` and `'60px'/'480px'` strings still hold).

### BUG-050 — back card face used a different width recipe than the front (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `tests/design/design.test.js`
- **Phase**: Round 5 (aurora/back-face/explanation refinements)
- **Symptom**: on mobile + tablet the back face of both card types sat off
  center (shifted right) with the right edge clipped, losing information.
- **Root cause**: only the front face carried an explicit viewport-pinned
  width rule (`.aurora-card.card-front { width: min(848px, calc(100vw - 32px));
  min-width: 0; ... }`, specificity 0,2,0 — survives all media-tier
  overrides). The back face had no rule of its own, so it fell back to the
  generic base `min-width: min(848px, 95vw)` plus the media-tier
  `width: 100%`/`min-width` resets — a different, weaker recipe that did not
  pin the box to the same centered viewport geometry as the front.
- **Fix**: widened the front rule's selector to
  `.aurora-card.card-front, .aurora-card.card-back` so both faces share the
  identical `width: min(848px, calc(100vw - 32px)); min-width: 0;
  max-width: min(848px, calc(100vw - 32px)); box-sizing: border-box;
  margin: auto;` — back geometry is now, by construction, the same as the
  known-good centered front at every breakpoint.
- **Regression guard**: design pin `baseline card widths` updated to assert
  either face caps at `min(848px, calc(100vw - 32px))` (regex matches the
  `.card-back` branch of the grouped rule).

### BUG-051 — explanation plate was translucent instead of matching the option-answer surface (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `Back.html`, `mcq/Back.html`, `mcq/_mcq_styles.css`, `tests/design/design.test.js`
- **Phase**: Round 5 (aurora/back-face/explanation refinements), corrected in Round 6
- **Symptom**: the "phần giải thích thêm" (`<details class="expand-container">`
  → `.expand-content`) used a translucent `rgba(var(--aurora-accent-rgb),
  0.14)` wash that did not match the option-answer surface beneath it.
- **Root cause**: `.expand-content` did not resolve to the same surface as the
  surrounding panels.
- **Fix (final, Round 6)**: `.expand-content` is now itself a `glass-pseudo`
  surface — no solid background at all.
  - Typing note type: inherits the `.example-box` recipe (`--glass-mesh-opacity:
    0.20; --glass-sheen-alpha: 0.26; --glass-edge-alpha: 0.32; --glass-crown:
    0.20; --glass-foot: 0.02;`) so the "extra information" panel reads exactly
    like the `.example-box` panel beside it.
  - MCQ note type: the `.mcq-area .expand-content` override borrows the
    `.mcq-option-btn` glass knobs (`--surface-transparency-alpha: 0.55`,
    night `0.75`) so the GIẢI THÍCH CHI TIẾT plate matches the answer /
    distraction buttons; `.mcq-area .expand-content .giaithich` also switches
    to `color: var(--text-primary)` (dropping the shared left accent rail +
    padding) so the explanation text reads like the option labels.
  - Both templates now write `<div class="expand-content glass-pseudo">`.
    `backdrop-filter` remains forbidden.
- **Regression guard**: the old design pin asserting the translucent accent
  wash was replaced by `'design: explanation plate is a glass surface matching
  the example-box (typing) / option buttons (mcq)'`, which asserts
  `background: transparent` (no `--surface-elevated`), the example-box glass
  crown knob, and the `glass-pseudo` class in `Back.html`.

### BUG-052 — mobile: aurora halo split from the glass-pseudo card on scroll + doubled top corners (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `_hna_aurora.js`, `mcq/_mcq_aurora.js`,
  `mcq/_mcq_styles.css`, `tests/ram/leak.test.js`, `tests/design/design.test.js`
- **Phase**: Round 7 (mobile aurora ↔ glass-pseudo alignment)
- **Symptom**: on the real phone, scrolling the back card moved the
  glass-pseudo layers (card + in-card elements) while the aurora layer stayed
  put; at rest, the top two corners of the two layers showed a doubled,
  mismatched rounded silhouette (visible because on phones the card is taller
  than the viewport, so only the top corners are on screen).
- **Root cause**: two independent bugs.
  1. *Scroll disunion.* `html, body { height: 100%; overflow-y: auto }` makes
     `body` (not the window) the real scroll container on phones. The host was
     `position: absolute` but `body` was un-positioned, so the host's
     containing block was the ICB — it stayed fixed in the viewport while the
     in-flow card scrolled inside `body`. `rect + window.pageXOffset/pageYOffset`
     is only correct when the **window** is the scroller.
  2. *Corner mismatch.* Base `.aurora-card` keeps `clip-path: inset(0 round
     var(--radius-lg))` (32 px) at every breakpoint, but the ≤768 / ≤480 tiers
     switch `border-radius` to `var(--radius-md)` (16 px) without touching
     `clip-path`. `clip-path` wins for the painted silhouette (32-px arcs), while
     the host mirrors the card's computed `border-radius` (16 px) → two corner
     arcs that disagree.
- **Fix**:
  - CSS: base `body` rule gains `position: relative`, making `body` the host's
    containing block — the absolute host now travels with `body`'s content
    automatically on phones (both layers grouped in the same scroll context).
    `position: fixed` UI (`.btn-settings`, `.settings-menu`) and the hidden
    `#correct-answer` are unaffected.
  - JS (`_hna_aurora.js` + `mcq/_mcq_aurora.js`, byte-identical): host
    coordinates are now content coords relative to `body`:
    `left = rect.left - bodyRect.left + body.scrollLeft`,
    `top = rect.top - bodyRect.top + body.scrollTop`.
    This is exact whether the window scrolls (bodyRect shifts, `body.scroll*`
    stays 0) or `body` alone scrolls (bodyRect fixed, `body.scroll*` grows).
    No scroll listener is added — the RAM audit's listener budget is untouched.
  - CSS: mobile `.aurora-card` rules gain
    `clip-path: inset(0 round var(--radius-md)); -webkit-clip-path:  
    inset(0 round var(--radius-md));` in both the ≤768 and ≤480 tiers, so the
    card silhouette equals its `border-radius`. Desktop stays `--radius-lg`.
- **Regression guard**:
  - `'ram: aurora host translates the rect into body content coords (body is
    the scroll container)'` — stubs card/body rects + `body.scrollTop = 100`
    and asserts `top` becomes `130 - 0 + 100 = '230px'`.
  - `'design: body is the aurora host containing block — relative body + mobile
    clip-path matches radius'` — pins `body { position: relative }` and the
    ≤768 / ≤480 clip-path == border-radius rules.
  - Existing pins unchanged: `.hna-aurora-host` stays `position: absolute`,
    no ≤768 fullscreen `!important` override, document listeners still 4 and
    window resize still 1, host remains exactly one node as `body`'s first child.
  - jsdom's `body.getBoundingClientRect()` returns all-zeros and `body.scroll*`
    is 0, so the pre-existing `'12px'` / `'34px'` geometry assertions still pass.
- **Status**: real-device acceptance still pending (with the pending MCQ
  device check from Round 6); `--publish` deferred.

### BUG-053 — mobile back face: oversized hero, stacked metadata, oversized diff (2026-09-18)
- **Date**: 2026-09-18
- **Files**: `_hna_styles_v7.css`, `mcq/_mcq_styles.css`,
  `tests/design/design.test.js`
- **Phase**: Round 8 (mobile back-face typography refinement)
- **Symptom** (all on the typing back face):
  1. The hero word on mobile was much larger than the cue-card question on
     the front face.
  2. POS badge / IPA / replay button each landed on their own row instead of
     one shared row that wraps only when out of room.
  3. The visual-diff copy was still too large, and the back hero and the diff
     rows wrapped mid-word instead of as whole words.
- **Root cause**:
  1. ≤768 `.swedish-word` used `font-size: var(--fs-xl)` (1.625rem) while the
     front `.prompt-content` uses `clamp(0.9375rem, 3.8vw, 1.25rem)`.
  2. ≤480 `.word-meta .ipa { flex-basis: 100% }` forced the IPA onto its own
     full-width line; in the DOM order pos → ipa → sound, the replay button
     then wrapped below it → all three on separate rows.
  3. `.diff-row-correct` used `--fs-md` and `.diff-row-typed` used `--fs-sm`;
     both diff rows and `.swedish-word` used `overflow-wrap: anywhere`
     (eager mid-word breaks), and the hero used `text-wrap: balance` (which
     equalizes lines instead of filling the first line).
- **Fix**:
  - ≤768 `.swedish-word` font-size → `clamp(0.9375rem, 3.8vw, 1.25rem)` — the
    exact same clamp as `.prompt-content`, so the hero matches the cue
    question on mobile.
  - `.word-meta .ipa` (≤480) → `flex: 0 1 auto; min-width: 0;
    white-space: nowrap` (no more `flex-basis: 100%`); `.pos-badge` gains
    `white-space: nowrap`. All three sit on one flex row and wrap only as
    whole units when combined width overflows.
  - `.diff-row-correct` → `--fs-sm`, `.diff-row-typed` → `--fs-2xs`
    (base + the ≤768 reasserts updated to match). `overflow-wrap: anywhere`
    → `break-word` on both diff rows and the hero; hero `text-wrap: balance`
    → `normal` so every line fills before wrapping, and a word only breaks
    when it cannot fit on a line by itself.
- **Regression guard**: new design pin `'design: mobile word-meta one row +
  smaller diff/hero text with whole-word wrap'` (asserts no `flex-basis:
  100%` on `.word-meta .ipa`, `nowrap` on `.ipa`/`.pos-badge`, the smaller
  diff sizes, and `break-word` + `text-wrap: normal` on the affected rules);
  the ≤768 hero pin now asserts the `clamp(0.9375rem, 3.8vw, 1.25rem)` value
  instead of `--fs-xl`. Semantic diff colors (`--diff-*`) stay token-driven.

## Open / latent issues

### ISSUE-001 — `window.__hnaIsTypingTimer` cleared only in typing module
If a card type without the typing module ever appears in the same session
(not currently possible — both faces load `_hna_typing.js`), the
`is-typing` body class could linger for up to 500 ms. Low risk; noted for
audit.

### ISSUE-002 — `example-word` gap-fill uses a regex over the whole example
**Superseded by removal (2026-08-14)**: the `example-word` mode was removed
with the card-type selector (see BUG-018), so `applyCardType`'s gap-fill no
longer exists. For completeness, the removed behavior was: replace the first
case-insensitive occurrence of the target word in the example text — if the
example contained the word twice only the first was gapped, and a form of the
word (e.g. "går" vs "gå") left the gap unrendered.

### ISSUE-003 — `decodeHTML` on non-string input
`AnkiEngine.decodeHTML(html)` assigns `txt.innerHTML = html`; a non-string
(e.g. `null`) coerces silently to `"null"` text. No current caller passes
non-strings, but the function has no type guard. Noted for hardening.

### ISSUE-004 — `resize` handler re-applies full config
`window.addEventListener('resize', ...)` calls `AnkiEngine.applyConfig()`
(debounced 200 ms). This re-runs toggle-map application on every window
resize. Harmless (idempotent), but it does force a style recalculation;
kept because the aurora host also listens for resize.

## Bug-finding procedure (for subagents)

1. Reproduce with `preview/preview.html` and the test suite.
2. Write a failing test in the appropriate `tests/` bucket first.
3. Fix, then confirm the test passes and no other test regresses
   (`node tests/run-all.js`).
4. Append an entry to this log with date, symptom, root cause, fix,
   regression guard.
5. If the change touches the leak rules (infinite animations, blurred
   layers, per-flip nodes), run the RAM suite twice — before and after.
