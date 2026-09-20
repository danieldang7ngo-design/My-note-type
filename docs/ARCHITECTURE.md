# HNA Architecture — Module-by-Module

## 1. The host environment: Anki's webview

Every architectural decision flows from one fact:

> **Anki swaps card faces by replacing the innerHTML of the element `#qa`.
> The webview process never reloads between cards.**

Consequences:

1. All scripts run **once at page load** and then survive across the whole
   review session — but all **DOM nodes inside `#qa` are destroyed and
   rebuilt on every flip**.
2. Any event listener, timer, `requestAnimationFrame`, or observer that
   references a detached `#qa` node keeps that node's entire subtree alive
   → **the per-flip RAM growth** (see `RAM_LEAK_ANALYSIS.md`).
3. Anything that must persist across cards (config, typed-answer buffer,
   aurora layer, audio context) must live on `window` or `document.body`
   **outside** `#qa`.
4. The host may be an older QtWebEngine: **ES5-compatible JavaScript**,
   no `Array.prototype.fill`, no logical CSS properties in critical paths,
   no `:has()`, no modern `<details>` smoothness, etc. The code deliberately
   avoids them or polyfills by hand.

## 2. File inventory and load order

Both templates load scripts in this exact order (documented in comments in
both HTML files):

```
<link _hna_styles_v7.css>
   │
   ▼
_hna_storage.js   defines STORAGE_KEYS, safeGet, safeSet   (no deps)
_hna_engine.js    defines AnkiEngine, AnkiAudio            (deps: storage)
_hna_diff.js      Back-face diff renderer                  (deps: engine)
_hna_typing.js    Front-face typing overlay                (deps: engine)
_hna_aurora.js    background singleton                     (deps: none)
```

**Load-order contract**: `_hna_engine.js` must precede `_hna_diff.js` and
`_hna_typing.js`, because both call `AnkiEngine.decodeHTML` at module load.
When diff loaded first, the very first card of a session threw
`AnkiEngine is not defined` and the correct-answer row rendered empty.
`_hna_aurora.js` is order-independent.

## 3. `_hna_storage.js` — storage layer

```js
STORAGE_KEYS = {
  CONFIG:       'anki-card-config',
  TYPED_ANSWER: 'hna-typed-answer'
}
```

- `safeGet(key)`: `localStorage` first, then a hand-parsed cookie fallback
  (webviews where storage is disabled). Each failure mode is `try/catch`ed.
- `safeSet(key, value)`: writes `localStorage` AND a 10-year cookie
  (`SameSite=Lax`). Returns `true` if either succeeded.
- **Early night-mode injection**: at module load it reads the config and, if
  `"nightMode":true` is present, adds `.night-mode` to `<html>` *before*
  `<body>` renders — preventing a light-mode flash on first paint.
- **Per-flip hygiene** (top of file): nulls `window.__hnaActiveTypeansInput`
  and `window.__hnaScheduleTypeansUpdate`, the two cross-card globals the
  typing module registers. This runs on **every** card flip because the
  script is re-executed each time `#qa` is rewritten.
- History note: `AnkiAudio.close()` used to be called here per flip. That
  churned a device thread per card and was removed; one AudioContext is now
  kept for the whole session (see `RESOURCE_MANAGEMENT.md` §6).

## 4. `_hna_engine.js` — config, settings, shortcuts, audio

### 4.1 Answer-field parser (`decodeAnswerField`)
The shared ".swedish-word logic" decoder:
```js
AnkiEngine.decodeAnswerField = function (html) {
    var s = String(html == null ? '' : html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '');
    s = AnkiEngine.decodeHTML(s);
    return s.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ');
};
```
Answers reach the Back face as raw HTML inside `span.swedish-word`. A `<br>` in
the note field renders there as a real line break. `decodeAnswerField` turns `<br>`
into `\n` BEFORE tag stripping, decodes entities via the shared detached decoder,
and normalizes CRLF/NBSP without deleting line breaks.

### 4.2 `defaultConfig`
```js
{ nightMode:false, realtimeCheck:true, showSmoothCaret:true,
  showTrans:true, showExample:true, showExplain:true, showExpand:true,
  showImage:true, showTags:true, showStats:false, playSound:true,
  auroraFlow:true }
```

### 4.3 Config layering (priority, lowest → highest)
1. `defaultConfig` — merged into `AnkiEngine.config` at module load.
2. `window.ANKI_PERSISTENT_CONFIG` — base layer injected by the host page
   (e.g. a study-deck script). Applied in `loadConfig()`.
3. `localStorage`/cookie `anki-card-config` — the user's own toggles, written
   by `saveConfig()`. Applied last, **wins on key overlap**.

The order is load-bearing: moving storage below the persistent config would
make every settings change silently ineffective on the next flip.

### 4.4 `MENU_SPEC` — single source of truth for the settings menu
A 12-entry array of `{ key, label, shortcut?, d, extra? }` (SVG path) objects. Both
card faces used to carry a duplicated ~99-line `<template id="settings-template">`;
menu changes had to be made twice by hand and the two faces drifted. Now the
menu is built **lazily** from this one spec on the first gear click.

- `updateSwitches()` iterates MENU_SPEC to sync toggle UI state.
- `_buildMenuItem(spec)` builds one row with `createElement` (not innerHTML)
  so the toggle listener binds directly to the node. SVG must be built with
  `createElementNS` — plain `createElement('svg')` yields an unknown HTML
  element that renders nothing.
- Rows with `extra:true` (7 items) go inside a collapsed `Mer ▾` `<details>`.
- **Lazy build** (`buildSettingsMenu` is called from `toggleSettings`):
  building eagerly cloned ~125 template nodes + 13 toggle listeners on every
  card flip for UI that is invisible until opened — this was the single
  largest retained-node source.

### 4.5 Class contract — `_buildToggleMap` / `_applyToggleMap`
Config maps onto `<html>` classes:

| Class | When set |
|---|---|
| `night-mode` | `nightMode` |
| `disable-realtime` | `!realtimeCheck` |
| `stealth-mode` | `!realtimeCheck && showSmoothCaret` |
| `hide-smooth-caret` | `!showSmoothCaret` |
| `hide-trans` / `hide-example` / `hide-explain` / `hide-expand` / `hide-image` / `hide-tags-card` / `hide-stats` | respective `show*` = false |
| `pause-aurora-flow` | `!auroraFlow` (motion pause only; layer remains rendered) |

Plus `body.classList.toggle('night-mode', ...)`.

### 4.5 Keyboard shortcuts (`setupEvents`)
| Shortcut | Action |
|---|---|
| `Alt+S` | toggle settings menu |
| `Alt+D` | toggle night mode |
| `Ctrl+J` | focus the type input |
| `Escape` | close settings menu |

The keydown handler is **replaceable**: `setupEvents` removes the previous
`AnkiEngine._keydownListener` before adding a new one, and the same for the
document click-outside handler — idempotent re-execution per flip.

### 4.6 `AnkiAudio` — Web Audio feedback
One module-level object, one `AudioContext` reused for the whole session:

- `playTone('correct'|'wrong')` — correct: 600→1000Hz sine sweep; wrong:
  180Hz square. Both have a release envelope and `osc.onended` disconnects
  the graph nodes.
- **Deliberately no `close()`**: closing/reopening per flip churned a device
  thread. Blink suspends an idle context on its own and `playTone` resumes it.
- Guarded by `AnkiEngine.config.playSound`.

### 4.7 Teardown block (bottom of file)
```js
// MutationObserver on #qa used to live here, re-capturing .aurora-card and
// cancelling animations on the detached root. Measured over 80 flips it
// cancelled nothing while holding a permanent observer + detached card root.
// Removed.
if (window.__hnaTeardownObserver) { ...disconnect()... }
if (window.__hnaScheduleTeardownCapture) { ...clearTimeout()... }
window.__hnaPrevCardRoot = null;
```
Defensive disconnect + null-out of any legacy per-flip observers.

## 5. `_hna_typing.js` — real-time typing overlay (Front)

One IIFE that re-runs on every card flip. First thing it does is kill the
previous card's pending work:

```js
cancelAnimationFrame(__hnaTypingRAF); clearTimeout(__hnaTypingTimer);
clearTimeout(__hnaIsTypingTimer); __hnaActiveTypeansInput = null;
__hnaScheduleTypeansUpdate = null;
if (__hnaPersistTimer) { clearTimeout(__hnaPersistTimer); __hnaPersistTimer = null;
  if (typeof __hnaTypedAnswerBuffer === 'string')
    try { safeSet(STORAGE_KEYS.TYPED_ANSWER, __hnaTypedAnswerBuffer); } catch (e) {} }
document.removeEventListener('selectionchange', __hnaSelectionListener);
```

The **persist flush** is load-bearing: the storage write is trailing-debounced
(see below), so cancelling the timer alone would silently drop the last card's
answer; the flush forces the pending write through right before the flip.
`__hnaScheduleTypeansUpdate` is nulled so a late rAF cannot resurrect a
detached overlay's update chain.

This is what actually prevented the accumulation: a retry chain / init timer
from the last card used to keep running against a detached overlay and pin its
whole subtree alive.

`initTypeAnswer()`:
1. Finds `input#typeans`, `#typeans-overlay`, `#smooth-caret`,
   `#correct-answer`.
2. **Back cards return immediately** (no overlay) — previously every Back card
   burned a 100-frame retry chain looking for an input that never comes.
3. If the input hasn't been injected by Anki yet (it arrives with
   `{{type:word}}`), retries up to 100 frames via `requestAnimationFrame`,
   tracked on `window.__hnaTypingRAF` so the next flip cancels it.
4. Unwraps the `<center>` Anki wraps the input in, making the input absolute
   + invisible over the overlay (`opacity:0`, `pointer-events:auto`).
5. Builds the overlay DOM once per card: parses `correctAnswer` with
   `decodeAnswerField`, preserving line breaks (`\n`). Characters are mapped
   into `typeableSlots` — line breaks are layout-only (consuming no keystroke,
   rendered as `.char-linebreak` blocks). Per-character spans wrap in
   `.word-group` inline-flex containers, plus the smooth caret. The
   placeholder style per char: letters/numbers → `_` slot, spaces → empty
   `char-space-placeholder`, punctuation → visible muted glyph.
6. Clears **both** stale-answer channels: `window.__hnaTypedAnswerBuffer`
   and storage — the diff on Back reads the buffer before storage, so
   clearing storage alone let the last card's answer leak into this one.
7. Input events (`input`, `keyup`, `change`, `compositionend`) → persist
   typed answer + schedule a rAF-batched `updateDisplay()`.
   **Persist is debounced**: `persistTypedAnswer` dedupes against
   `_lastPersisted`, then trailing-debounces the storage write 200ms via
   `window.__hnaPersistTimer` (one timer per session, reused). The in-memory
   `__hnaTypedAnswerBuffer` stays **synchronous** — only the localStorage/
   cookie write is deferred, so Back-face diff reads are always current while
   keystrokes never hammer storage.
8. `updateDisplay()` diffs typed vs. correct per character across `typeableSlots`,
   class-swaps spans (correct/wrong/extra + cursor), manages overflow spans
   beyond the answer length, auto-scrolls the overlay, and positions the
   smooth caret via `translate3d`.
9. Placeholder styling per char: letters → `_` slot, spaces empty (see item 5);
   punctuation renders a visible muted glyph (`char-punctuation-hint`). No
   separate hint button exists in the current build — the front face's only
   "hint" is the `details.hint-reveal` expander for the optional explanation.
10. **Card-type selector removed** — the Betydelse → Ord / Exempel → Ord
    mode switcher was deleted (2026-08-14 refactor); the meaning cue card is
    the only card and stays visible.

## 6. `_hna_diff.js` — visual diff (Back)

One IIFE, re-run per flip. No per-flip observer or timeout handles exist —
diff rendering is fully synchronous against the static Back rows.

`renderDiff()`:
1. No-ops if the rows are missing or already rendered (`rowC.dataset.hnaRendered`).
2. Correct answer pipeline: parsed through `AnkiEngine.decodeAnswerField` (preserving `\n`),
   with whitespace collapsed per-line.
   Typed answer pipeline: `input#typeans` value → else
   `window.__hnaTypedAnswerBuffer` → else storage — parsed through `decodeAnswerField`
   with identical normalization.
3. Aligned comparison runs on `\n`-stripped strings (line breaks are layout),
   and `renderRows` uses a precomputed `breakMap` to re-insert `\n` at the
   correct text node positions.
4. Verdict decision tree:
    - no typed answer → hide typed row, "Det korrekta svaret", wrong tint
    - exact match → "Exakt!", correct tint, typed row hidden
    - wrong / near-miss → typed + correct rows compared, both row titles hidden
   - else → Levenshtein distance ≤ 2 ⇒ near-miss, full diff rows
5. **O(n·m) guard**: if `typed.length * correct.length > 40000` the diff
   falls back to `renderSimple` — two plain rows (typed tinted `diff-row-typed`,
   correct `diff-row-correct`), no per-character backtrace.
6. `computeDiff`/`levenshteinDiff(t,c,tLo,cLo)` — DP alignment backtraced
   from (m,n) to (0,0) with match-prioritized lookahead (`extraLeadsMatch`,
   `subLeadsMatch`, `missedLeadsMatch`) to produce intuitive word alignments
   (e.g. extra spaces or single-letter near misses). Returns both diff rows
   and computed distance.
7. `renderRows` / `renderSimple` build text nodes + `<span>` marks.

## 7. `_hna_aurora.js` — session-persistent aurora singleton

Maintains a single `#hna-aurora-host` element as `body.firstElementChild`
across the entire Anki review session.

- **Card-sized at every breakpoint**: `syncAurora()` measures `.aurora-card`
  and mirrors its box exactly (`left/top/width/height`). All aurora layer
  geometry is proportional — `.aurora-bg` sits at `inset: 0`, the pattern
  overscan uses `-20%`, and the `hnaAuroraBase/Overlay/Mid` keyframe travel is
  expressed as percentages of each layer box — so the animation scales with
  whatever size the card is. The old ≤768 fullscreen `!important` override was
  removed so the static `body::before` backdrop stays visible around the card
  on phones too.
- **Scrolls with the page (BUG-049)**: the host is `position: absolute` (no
  longer `fixed`). Because the host is `body.firstChild` and `body` is static,
  its containing block is the initial containing block, so it scrolls with the
  document. `syncAurora()` writes **document coordinates**
  (`rect.left + window.pageXOffset` / `rect.top + window.pageYOffset`), which
  keeps the halo glued to the card even after the taller back face scrolls —
  the glass-pseudo surfaces and the aurora layer stay aligned on mobile and
  tablet.
- Attaches double-rAF synced listeners to `animationend`, viewport resize
  (`visualViewport.resize` if available, fallback to `window.resize`), and a
  `ResizeObserver` on the card, so the halo tracks the card through flips,
  VKB open/close, details expansion and image decode.
- Single global handle `window.__hnaAuroraSync` prevents frame buildup during
  flip storms.`, `dt-extra`).
8. `triggerVerdictPop` re-triggers the verdict animation by
   classList-remove → forced reflow (`void offsetWidth`) → classList-add.
9. Plays `AnkiAudio.playTone(...)`.

## 7. `_hna_aurora.js` — the session-persistent background

**Problem it solves**: the animated aurora layer used to live inside
`.aurora-card` (i.e. inside `#qa`). Every flip destroyed it and rebuilt it,
and each rebuild rasterized a new `filter: blur()` compositing texture that
QtWebEngine did not reliably release — the core of the RAM leak.

**Solution**:
1. `ensureHost()` creates `#hna-aurora-host > .aurora-bg` as `<body>`'s
   **first child, once per session** — outside the region Anki swaps.
   Inserted first on purpose: plain DOM order paints it behind `#qa`
   without z-index fights.
2. `syncAurora()` measures the current `.aurora-card` rect and copies
   `left/top/width/height/borderRadius` onto the absolutely-positioned host,
   using document coordinates (`+ pageXOffset/pageYOffset`) so the fixed-ink
   separator is correct after scrolling.
3. Sync triggers: a double-rAF on load, `animationend` on
   `.aurora-card` (`hna-card-appear`/`uq-card-appear` — the double-rAF lands
   mid-appear and measures a transformed rect), a **persistent**
   `ResizeObserver` (created once, re-targeted per flip), a one-time
   window resize listener, and a **persistent `MutationObserver` on `#qa`
   whose callback only acts on the card swap itself** (P1): it scans the
   records and syncs only when `record.target === qaEl` or an added node is
   `.aurora-card`. Anki's flip replaces `#qa`'s children directly, so this
   catches swaps without re-measuring on unrelated mutations — earlier the
   observer re-synced on every keystroke (each `input` mutates `#qa`),
   costing ~2 rAFs + 2 `getBoundingClientRect` + 1 `getComputedStyle` per
   typed character.
4. The `filter: blur(14px)` layer is therefore rasterized **once** and only
   *moved* (transform-only animation), never recreated.

**Why toggles alone couldn't fix the leak**: Aurora Flow off / Perf mode only
hid or paused the layer; the blur element still existed inside `#qa`, so it
was still promoted to a compositing layer and re-rasterized per flip.
(Both tiers were removed 2026-08-14 — the aurora now runs unconditionally,
which is why the motion-contract tests assert there is no kill-switch class.)

## 8. `_hna_styles_v7.css` — design system

~4067 lines (dead rules and the shipped light constellation token removed
2026-08-14; the usable knob for aurora show-through is
`--surface-transparency-alpha` — the old `--glass-lift-alpha` is gone).
Key structural blocks:

| Section | Lines (approx) | Contents |
|---|---|---|
| Header comments | 1–22 | Pass history, motion contract, leak rules |
| Fonts | 23–40 | Inter (300–800), JetBrains Mono (400–500), `font-display: swap` |
| `:root` tokens | 52–312 | 60+ custom properties: type scale, prism colors, glass knobs, shadows, z-scale |
| `.night-mode` overrides | 448–571 | Full token remap for dark mode |
| Verdict & feedback | 572–655 | `uq-verdict-*` shake/settle, `uq-char-*` pop/shake (single tier since 2026-08-14) |
| Fullscreen background | 668–931 | `body::before` sky + stars + curtain, `body::after` film grain |
| Aurora card + host | 932–1314 | card slab, `.hna-aurora-host`, ribbon pseudos, drift/breathe keyframes |
| Pseudo-glass | 1315–1386 | `.glass-pseudo::before/::after` — mesh, crown/foot, prism edges |
| Settings menu | 1387–1756 | gear button, menu, toggle switches, FB link |
| Typing area | 1757–2287 | well, char states, smooth caret, stealth/realtime overrides |
| Visual diff | 2288–2655 | verdict plate, rails, bloom, answer-land, marks |
| Recall & cue cards | 2656–3038 | badges, IPA, prompt hierarchy, example box, disclosure triggers |
| Tags & metadata | 3346–3593 | tag tray, ID badge, staggered pop |
| Breakpoints | 3625–3941 | 1025 / 1024 / 768 / 480 |
| Motion + a11y | 3942–4066 | `hna-card-appear`, layered reveal, `prefers-reduced-motion` |

**The three non-negotiable rules** (see `RESOURCE_MANAGEMENT.md` §5):

1. No `infinite` animations (bounded counts only — `999` is "practically
   infinite but stops").
2. No animated `filter` or `will-change` — blur is baked at raster time;
   only `transform`/`opacity` animate.
3. No per-flip DOM nodes — decoration lives on pseudos or the session-
   persistent host.
