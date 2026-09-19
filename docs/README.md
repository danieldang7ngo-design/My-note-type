# HNA Swedish Vocabulary Note Type — Master Documentation

An Anki note type for **Swedish → vocabulary recall** with real-time typing
feedback, a Levenshtein visual diff, a full settings system, and a
session-persistent aurora background. Designed to run inside Anki's built-in
QtWebEngine webview, which imposes the constraints that drive most of the
architecture decisions in this codebase.

## What this package is

A **note type = 2 HTML templates + 5 JavaScript modules + 1 CSS file**, pasted
by hand into Anki's Card Template editor:

| File | Role | Size (Working / Publish) |
|---|---|---|
| `Front.html` | Question face: cue card, typing input, settings gear | 4.8 KB |
| `Back.html` | Answer face: recall card, visual diff, verdict, expandables | 8.2 KB |
| `_hna_styles_v7.css` | Entire design system: tokens, glass, aurora, breakpoints, motion | 94.7 KB / 92.1 KB (min) |
| `_hna_engine.js` | Config, settings menu builder, keyboard shortcuts, audio | 22.1 KB |
| `_hna_storage.js` | Cross-platform storage: `localStorage` + cookie fallback | 2.5 KB |
| `_hna_diff.js` | Levenshtein visual diff + verdict rendering (Back face) | 13.8 KB |
| `_hna_typing.js` | Real-time per-character typing overlay (Front face) | 24.3 KB |
| `_hna_aurora.js` | Session-persistent aurora background singleton | 8.4 KB |

There are also two font files referenced by the CSS (`_Inter.ttf`,
`_JetBrainsMono.ttf`) that must be added as Anki media.

## Feature summary

- **Meaning-cue card**: the Front face shows the meaning/translation as the
  prompt and the target word is typed.
- **Multi-line answer support**: answers with `<br>` line breaks in note fields
  parse via `decodeAnswerField()`, correctly rendering multi-line inputs in the
  typing overlay and the Back-face Levenshtein visual diff without collapsing.
- **Real-time typing overlay**: every keystroke is compared against the hidden
  answer; correct/wrong/extra characters are colored inline with a smooth
  animated caret.
- **Visual diff on Back**: an optimal Levenshtein alignment with match-prioritized
  backtrace marks exactly which characters were substituted, omitted, or extra,
  with an accessible verdict plate (Exakt! / near-miss / wrong) and a sound cue.
- **Settings menu** (12 toggles + Facebook link), built lazily once per card
  from a single `MENU_SPEC` in the engine, with keyboard shortcuts
  (Alt+S menu, Alt+D night mode, Ctrl+J focus, Escape close).
  Includes `Aurora-flöde` motion toggle and `Visa statistik` footer toggle.
- **Mobile/tablet tuning (≤768px)**: the aurora host mirrors the card box
  exactly at every breakpoint and all its layers scale proportionally to card
  size; the hero word steps down, copy goes full-width, the settings menu
  becomes a viewport-bounded compact popover, long visual diffs collapse to two
  lines with a tap-to-expand toggle, and the Back face keeps Extra information
  and oversized images collapsed.
- **Night mode** remaps theme tokens, animations, and compositor layers.
- **Persistent config** across sessions via `localStorage` with a cookie
  fallback, layered over `window.ANKI_PERSISTENT_CONFIG` injected by the host.

## Why this codebase is unusual

1. **It is pasted into a sandboxed webview**, not bundled by a build tool.
   No modules, no imports, no transpilation: ES5-era JavaScript on purpose
   (QtWebEngine on older Anki builds predates `Array.prototype.fill`, logical
   CSS shorthands, and `interpolate-size`).
2. **Anki swaps card faces by rewriting `#qa`'s innerHTML on every flip.**
   The webview is *not* reloaded. This single fact drives the entire memory
   management strategy (see `RAM_LEAK_ANALYSIS.md`).
3. **The CSS is a heavily-annotated editorial stylesheet** with a documented
   "motion contract" and "leak rules" (no `infinite` animations, no animated
   `filter`, no `will-change`, no per-flip DOM nodes).

## Documentation map

| Document | Covers |
|---|---|
| `docs/ARCHITECTURE.md` | Module-by-module breakdown, data flow, config layering, script-order contract |
| `docs/RAM_LEAK_ANALYSIS.md` | The full history of the RAM leak: root causes, measurements, fixes |
| `docs/RESOURCE_MANAGEMENT.md` | Every resource the note type owns and the rules for handling it |
| `docs/BUG_LOG.md` | Every known bug, fixed and open, with reproduction and fix notes |
| `docs/PUBLISH_WORKFLOW.md` | The gate pipeline: pre-flight → unit tests → RAM tests → design tests → preview → publish |

## The workflow at a glance

```
EDIT FILES
    │
    ▼
1. PRE-FLIGHT        node tests/run-all.js --preflight    static contracts only
    │
    ▼
2. UNIT TESTS        node tests/run-all.js               logic: diff, storage, config, typing
    │
    ▼
3. RAM/LEAK TESTS    (same runner, tests/ram/*)          node retention, listener churn, singleton integrity
    │
    ▼
4. DESIGN TESTS      (same runner, tests/design/*)       contrast pairs, token stepping, motion contract
    │
    ▼
5. UI/DOM TESTS      (same runner, tests/ui/*)           structure parity, menu build, shortcuts, typing
    │
    ▼
6. PREVIEW           open preview/preview.html           visual review of both faces
    │
    ▼
7. PUBLISH           node tests/run-all.js --publish       stage to publish/, checksum, human checklist
```

All tests run from a single command: **`node tests/run-all.js`**.

## How to read the tests

`tests/run-all.js` is a zero-framework runner: plain `node`, `assert`, and
`jsdom`. Every test file is a list of `{ name, fn }` cases and prints a
report like:

```
[PASS] diff: levenshtein distance "katt" vs "kat" = 1
[FAIL] ...
```

Exit code is non-zero on any failure, so CI can consume it directly.

## Installation into Anki

1. Copy `Front.html` into the **Front template** of your card type.
2. Copy `Back.html` into the **Back template**.
3. Add the 5 `_hna_*.js` files and `_hna_styles_v7.css` to Anki's
   `collection.media` folder.
4. Add `_Inter.ttf` and `_JetBrainsMono.ttf` to media.
5. The note type expects fields: `word`, `meaning`, `pos`, `transliteration`,
   `audio_word`, `audio_meaning`, `audio_example`, `example`,
   `example_translated`, `explain`, `image`, `forms`, `synonym`, `antonym`,
   `tag_1..tag_4`, `ID`. Empty fields are handled gracefully by
   the templates (`{{#field}}` sections). The tag tray renders the four
   `tag_1..tag_4` fields (spare note fields, not Anki's built-in `Tags`) plus
   the `ID` badge.
