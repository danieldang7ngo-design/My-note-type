# HNA Resource Management

Every resource the note type owns, and the rules for handling it. This is the
operating manual the subagents and tests are expected to enforce.

## 1. The resource inventory

| Resource | Owner | Lifetime | Location |
|---|---|---|---|
| Config object | `AnkiEngine.config` | Session (module load) | `window.AnkiEngine` |
| Settings menu DOM | `#settingsMenu` | Per card (inside `#qa`) | lazily built |
| Typing overlay spans | `#typeans-overlay` | Per card | inside `#qa` |
| Smooth caret | `#smooth-caret` | Per card | inside `#qa` |
| Diff rows | `#diff-*` | Per card | inside `#qa`; filled synchronously (no observer) |
| HTML decoder | `AnkiEngine.__decoder` | Session | 1 node, reused |
| Aurora host + `.aurora-bg` | `#hna-aurora-host` | **Session** | `<body>` first child |
| Aurora ResizeObserver | `window.__hnaAuroraRO` | Session | 1, re-targeted |
| Aurora card-swap observer | `window.__hnaAuroraMO` | **Session** | observes `#qa`, filtered to card-swap mutations (only per-flip observer left) |
| AudioContext | `AnkiAudio.ctx` | **Session** | on `window` |
| Keydown listener | `AnkiEngine._keydownListener` | Session | 1, replaced not stacked |
| Click-outside listener | `AnkiEngine._docClickListener` | Session | 1, replaced not stacked |
| `selectionchange` listener | `window.__hnaSelectionListener` | Session | 1, replaced not stacked |
| Typing rAF/timers | `window.__hnaTypingRAF/Timer/isTypingTimer` | Session | cancelled per flip |
| Diff observer/timeout | — | — | removed: no diff observer exists (`renderDiff` is synchronous) |
| Typed answer buffer | `window.__hnaTypedAnswerBuffer` + storage | Cross-card | cleared per card |
| Typed-answer persist timer | `window.__hnaPersistTimer` | Session | debounced save; flushed in typing per-flip teardown |
| ~~Card-type selector~~ | removed 2026-08-14 | — | — |
| Tones | oscillator+gain graph | ~200 ms each | disconnected on `onended` |

## 2. The invariant

> **Per-card resources may only live inside `#qa` (they die with the card).
> Session resources must live on `window` or in `<body>` and must never
> reference detached `#qa` nodes.**

When a session resource references a card node, the card node becomes a
session resource (retained forever) → leak. Every fix in this codebase is
either (a) moving a resource out of `#qa`, or (b) adding a teardown so the
reference dies with the card.

## 3. DOM node budget

Per-card node budget (front): ~2 static cue cards + overlay spans (1 per
answer character) + caret + settings gear + settings menu
(only after first gear click). Per-card (back): recall card + diff rows +
tags. None of these are retained across flips.

## 4. Event listener rules

1. A listener on `document`/`window` that is re-registered per flip **must**
   store its handler on `window`/`AnkiEngine` and remove the previous one
   first. Pattern:

   ```js
   if (AnkiEngine._keydownListener) document.removeEventListener('keydown', AnkiEngine._keydownListener, true);
   AnkiEngine._keydownListener = function (e) { ... };
   document.addEventListener('keydown', AnkiEngine._keydownListener, true);
   ```

2. Listeners on nodes inside `#qa` (buttons, inputs, toggles) need no guard —
   the nodes die with the card.
3. `stopPropagation` on menu clicks: the settings menu must not bubble to the
   document click-outside handler that closes it.

## 5. CSS compositing / motion contract (leak rules)

These three rules are the CSS counterpart of the RAM analysis. The design
test suite enforces them by static inspection.

1. **No `infinite` animations.** All keyframe loops use a bounded count
   (`999` ≈ 2.5 h at 9 s/cycle, outlasting any session). A literal
   `infinite` on any blurred/transform animation re-arms the layer churn.
2. **No animated `filter`, no `will-change`.** `filter: blur()` is baked at
   raster time; only `transform` and `opacity` may animate on or under a
   blurred element. `will-change` is banned outright.
3. **No per-flip decorative DOM.** Decoration (mesh, crown/foot, rails,
   blooms, sheen, marks, glyphs) must live on pseudo-elements or on the
   session-persistent host — never as new child nodes in the templates.
4. ~~Perf mode (`html.pause-animation`) and Aurora-off (`html.pause-aurora`)
   must **drop layers** (`display:none`), not merely hide them (`opacity:0`),
   because a blurred element is layer-promoted even when invisible.~~
   Removed 2026-08-14: `perfMode` / `showAurora` no longer exist; the aurora
   animation runs unconditionally.

## 6. Audio resource rules

- One `AudioContext` for the whole session; never `close()` + recreate per
  flip (device-thread churn).
- Tone graph nodes (oscillator + gain) must be `disconnect()`ed on
  `onended`.
- `playTone` returns immediately when `playSound` is off — no context is
  created at all.

## 7. Storage resource rules

- `safeSet`/`safeGet` swallow errors (webviews can disable both storage
  types); never throw into the card flow.
- Writes: `localStorage.setItem` + cookie (10 years, `SameSite=Lax`).
  `document.cookie` parse is hand-rolled — no external libs.
- The typed answer is persisted to allow the Back face to show the diff
  even if the buffer global was lost; both channels must be cleared together
  on a new card to avoid stale-answer leakage.

## 8. Timer / rAF rules

- Any `setTimeout`/`requestAnimationFrame` created by a per-flip module must
  register its handle on `window.__hna*` so the next flip cancels it.
- Retry chains must be bounded (typing: 100 frames) and must bail early on
  faces where the target can never exist (Back face: no overlay).

## 9. Config layering

Priority (lowest → highest): `defaultConfig` <
`window.ANKI_PERSISTENT_CONFIG` < `localStorage`/cookie. `loadConfig()` must
apply persistent first, then storage, and `toggleConfig` must re-run
`loadConfig` before flipping (so a card that loaded before a config change
still respects the user's latest state).

## 10. Budget and performance tiers

Single tier since 2026-08-14 — the Ultra/default/reduced split was removed:

| Tier | Classes | Live animations | Compositor layers |
|---|---|---|---|
| The one tier | — | card appear + aurora drift/breathe + verdicts + tag pop + per-char pop/shake + verdict shake/settle | aurora (session) + transient verdict bloom |

(`reduced-tier` / `ultra-quality` / `ultra-tier-full` / `pause-animation` /
`pause-aurora` classes and their kill-switch CSS were removed with
`perfMode` / `ultraMode` / `showAurora` on 2026-08-14.)

## 11. Budget rules for editors

- Do not add nodes to `Front.html`/`Back.html` that exist only for
  decoration (use pseudos).
- Do not add CSS `filter` to any element inside `#qa` markup that changes
  per flip.
- Do not add settings rows anywhere except `AnkiEngine.MENU_SPEC` — the
  HTML files must stay free of settings markup (they contain exactly two
  nodes: `#btnSettings` and `#settingsMenu`).
- Every new `setTimeout`/`rAF`/listener needs a `window.__hna*` handle and a
  teardown at the top of the IIFE that creates it.
