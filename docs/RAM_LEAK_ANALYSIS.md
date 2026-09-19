# HNA RAM Leak — Full Analysis

## TL;DR

The note type used to grow ~7 MB per card flip inside Anki's QtWebEngine.
The leak had **three compounding causes**, each discovered and fixed at a
different time:

1. **`filter: blur()` layer churn** — the animated aurora background lived
   inside `#qa`. Every flip destroyed and recreated it, and each recreation
   re-rasterized a GPU compositing texture that QtWebEngine did not reliably
   release. **Fix: the aurora singleton (`_hna_aurora.js`) moves the layer to
   `<body>`, created once per session, only repositioned per flip.**
2. **Per-flip event listeners / timers / observers pinning detached subtrees**
   — retry chains, selection listeners, MutationObservers, and settings-menu
   builds kept running against (or holding) the previous card's detached DOM,
   keeping whole subtrees alive. **Fix: idempotent teardown guards at the top
   of every per-flip module + lazy menu build + shared decoder element.**
3. **Per-flip AudioContext churn** — closing and reopening a Web Audio
   context on every card flip churned a device thread. **Fix: one context for
   the whole session.**

Per-flip growth is now ~0 (measured over 80 simulated flips; see
`tests/ram/leak.test.js`).

---

## 1. How the leak appeared

Anki renders a note type inside a persistent webview. On each card flip it
does roughly:

```js
document.getElementById('qa').innerHTML = nextCardHtml;
```

The scripts referenced by the templates re-run (script tags are re-created
with the innerHTML), but the **webview process and its heap are not reset**.
So anything from the previous card that is still reachable — through a
listener, timer, rAF chain, observer, or window global — survives forever,
and every flip adds another generation of it.

The card in question is a **dense glass/aurora design** with real-time typing,
which made it one of the worst possible shapes for this environment:

- an animated blurred background layer (the expensive one),
- per-character DOM spans updated by rAF,
- a settings menu built from ~125 template nodes,
- Web Audio tones,
- a `selectionchange` listener,
- a keyboard listener,
- a click-outside listener,
- a MutationObserver on `#qa`.

---

## 2. Root cause 1 — the aurora `filter: blur()` layer churn

### The mechanism

```css
.aurora-bg::before, .aurora-bg::after {
    filter: blur(10px);            /* forces a rasterized compositing layer */
    animation: hnaAuroraBase ...;  /* transform-only, good */
}
```

`filter: blur()` promotes the element to its own compositing layer and
**rasterizes** it into a GPU texture. That is fine for a static element. It
becomes a problem when the element lives inside `#qa`:

1. Card flip → Anki replaces `#qa` innerHTML → the `.aurora-bg` div is
   destroyed → the compositing layer should be released.
2. **QtWebEngine does not reliably release that texture on detach.** The GPU
   texture cache holds it, and the next card allocates a new one.

Two compounding details:

- **Toggling Aurora Flow off did not help.** `opacity: 0` on a blurred element
  still promotes it to a layer and still rasterizes it. Only `display: none`
  removes the layer — and at the time, the toggle only set opacity/paused the
  animation.
- **Perf mode did not help either**, for the same reason: killing animations
  left the static `filter: blur()` in place.

So even a user who turned both performance toggles on still leaked, because
the *layer* was recreated per flip regardless. That was the "it leaks even
with everything off" symptom.

### The fix

`_hna_aurora.js` (see `ARCHITECTURE.md` §7):

- The `.aurora-bg` div is created **once** as the first child of `<body>`,
  outside `#qa`, and never recreated.
- An absolutely-positioned host (`#hna-aurora-host`) is re-measured and repositioned
  to match the current `.aurora-card` rect on every flip.
- The blur texture is rasterized once; the animation is transform/opacity
  only, so the compositor just moves the existing texture.
- `.pause-aurora` (Aurora Flow off) now uses `display: none !important` on
  the ribbon pseudos so no layer is even created.
- `html.pause-animation .aurora-bg::before/::after { display: none }` for
  Perf mode, same reasoning.

### Measurements and dead ends

- RAM climbed ~7 MB per flip during review (layer churn).
- A `getAnimations().cancel()` teardown was tried and **measured to cancel
  nothing** (staleAnims === 0 at every checkpoint over 80 flips) — the
  previous root is always already detached, and Blink drops its animations
  without help. It was removed because it additionally kept the detached card
  root alive via `__hnaPrevCardRoot` between flips.
- A preview build shipped 1.5s/1.2s drift with `infinite alternate`, which
  re-armed the layer churn. All drift/sway animations are now bounded to
  `999` iterations (~2.5 hours) — a literal `infinite` re-arms the leak.

---

## 3. Root cause 2 — listeners, timers, and observers pinning detached DOM

### The mechanism

Every card flip re-executes the IIFEs. Before the fix, these were the live
retention sources:

| Source | Why it retained | Fix |
|---|---|---|
| Typing retry chain | `requestAnimationFrame(initTypeAnswer)` kept firing against a detached overlay, and the closure held `input`, `overlay`, `flatCharSpans`, `correctAnswerSpan` | Cancelled at the top of the next flip via `window.__hnaTypingRAF`; also bounded to 100 frames |
| `selectionchange` listener | Added per flip on `document`, each closure pinning the old overlay subtree | Removed before re-adding (`document.removeEventListener` with the stored handler) |
| Back-card retry waste | Every Back card burned a 100-frame retry chain looking for an input that never exists | Early return when `#typeans-overlay` is absent |
| Settings menu | Built eagerly on every flip: ~125 template clones + 13 toggle listeners, invisible until opened | Built lazily on first gear click, from one `MENU_SPEC` |
| Keyboard / click listeners | Added per flip on `document`, closures holding AnkiEngine (minor) but accumulated per flip | Stored as `AnkiEngine._keydownListener` / `_docClickListener` and removed before re-adding |
| MutationObserver on `#qa` | Permanent observer + detached card root held across every flip | Removed entirely; measured to cancel nothing |
| Typed-answer staleness | Only storage was cleared, so the previous card's answer leaked into the next card's diff via `__hnaTypedAnswerBuffer` | Both channels cleared |
| Decoder textarea | A fresh `<textarea>` created per `decodeHTML` call (2+ per card) | One shared `AnkiEngine.__decoder` element reused forever |

### The general rule that emerged

Every per-flip IIFE must **disarm the previous generation first**:

```js
if (window.__hnaXRAF)    { cancelAnimationFrame(window.__hnaXRAF); ... }
if (window.__hnaXTimer)  { clearTimeout(window.__hnaXTimer); ... }
if (window.__hnaXListener) { document.removeEventListener(evt, window.__hnaXListener); }
window.__hnaXListener = <new handler>;
```

This is idempotent: the first execution on a fresh session finds nothing to
disarm; every later flip finds exactly one previous generation. Nothing
accumulates.

---

## 4. Root cause 3 — AudioContext churn

### The mechanism

AnkiAudio used to `close()` its context in `_hna_storage.js` on every flip
and create a fresh one on the next `playTone`. Each create/destroy cycle
churned a device (audio) thread in QtWebEngine — a process-level cost that
accumulated.

### The fix

- One `AudioContext` is created lazily on first tone and **kept for the whole
  session** on `window.AnkiAudio`.
- Blink suspends an idle context on its own; `playTone` resumes it.
- Oscillator/gain nodes are disconnected on `onended` so the small graph per
  tone is released.
- A `close()` method is deliberately absent — no callers, and it would only
  invite reintroducing the churn.

---

## 5. Current leak posture and how it is verified

### Retained-node sources today: none per flip

- Aurora layer: 1 node in `<body>`, created once, never inside `#qa`.
- Settings menu: built inside `#qa`, dies with the card, guarded by a
  children-length check (idempotent within a card).
- Typing overlay: built inside `#qa`, dies with the card.
- Diff rows: static markup inside `#qa`, text nodes replaced in place.
- All document-level listeners: exactly one of each, always the latest
  generation.
- All timers/rAF: cancelled at the top of the next flip.

### What the RAM test suite verifies (`tests/ram/leak.test.js`)

1. **Listener count stability**: counting `document`/`window` listeners
   registered on `window.__hna*` handles stays constant across N simulated
   flips.
2. **Global handle stability**: `__hnaTypingRAF`, `__hnaTypingTimer`,
   `__hnaIsTypingTimer`, `__hnaPersistTimer`, `__hnaScheduleTypeansUpdate`
   do not accumulate generations (they are single values, replaced or
   nulled). The old `__hnaDiffObserver` / `__hnaDiffTimeout` handles were
   removed entirely — diff rendering is synchronous.
3. **Aurora singleton integrity**: exactly one `#hna-aurora-host` exists and
   it is a direct child of `<body>`; re-running `_hna_aurora.js` does not
   create a second host.
4. **Decoder reuse**: `AnkiEngine.decodeHTML` returns the same textarea node
   on every call (`AnkiEngine.__decoder` identity).
5. **Simulated flip churn**: run the full module stack (storage → engine →
   diff → typing → aurora) against a fresh `#qa` subtree for N iterations;
   assert the number of detached-but-retained nodes reachable from
   `window.__hna*` handles stays at 0, and that listener registrations are
   exactly 1 per global.
6. **Settings menu laziness**: `buildSettingsMenu` is not invoked at module
   load; menu nodes only exist after `toggleSettings()`.

---

## 6. How to measure in a real Anki session

The jsdom suite measures *structure* (retained handles, listener counts),
which is a proxy for heap retention. To confirm on real hardware:

1. Open Anki's reviewer on a large deck, open the OS process monitor
   (Task Manager / `top`), and filter by the `QtWebEngineProcess` child.
2. Note RSS before review. Review 50 cards (type in answers; open the
   settings menu at least once; hit both correct and wrong verdicts).
3. Return to the deck browser. The reviewer process RSS should return to
   near baseline after GC settles (~30–60 s of idle). Pre-fix behavior: RSS
   kept climbing ~7 MB/card and never returned.
4. Repeat with Aurora Flow off and with Perf mode on: both should now show
   no *additional* growth (layers are never created).

---

## 7. Regression tripwires

Any of the following changes re-arms the leak; the design tests in
`tests/design/design.test.js` fail when they regress:

- Adding `infinite` to any animation whose element carries `filter: blur()`.
- Nesting any blurred element inside the `#qa`-swapped markup (i.e. inside
  `Front.html`/`Back.html` `.aurora-card`).
- An eager settings-menu build on card load.
- Adding a per-flip listener/timer/observer without a stored-handle teardown.
- Closing the AudioContext per flip.
- Recreating the decoder per `decodeHTML` call.
