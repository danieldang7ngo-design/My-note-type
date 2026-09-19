# Note-type

Production-oriented [Anki](https://apps.ankiweb.net/) note types for **active
typing recall** and **multiple-choice practice**, built as hand-pasted HTML/CSS/JS
templates that run inside Anki's QtWebEngine webview.

## Overview

This repository ships **two Anki note types** that share the same design system
(tokens, glassmorphic UI, aurora background) and settings engine, but have
independent gameplay logic:

| Note type | What it does | Package |
|---|---|---|
| **HNA Typing** | Shows a meaning cue, you type the target word character-by-character with real-time feedback, then sees a Levenshtein visual diff on the back | Root: `Front.html`, `Back.html`, `_hna_*.js`, `_hna_styles_v7.css` |
| **HNA MCQ** | Asks a question with 2–4 shuffled options; instant correctness verdict, audio cue, and explanation on the back | `mcq/Front.html`, `mcq/Back.html`, `mcq/_mcq_*.js`, `mcq/_mcq_styles.css` |

## Features

### HNA Typing

- **Meaning-cue front card** — the prompt shows the meaning/translation (plus
  part-of-speech badge and optional audio); the target word is typed into an
  invisible-but-active field with a **real-time per-character overlay**.
- **Instant verdicts** — every keystroke is colored inline (green correct /
  red wrong / amber extra) against the hidden answer, with a smooth animated
  caret. Extras beyond the answer collect into a single `.word-extra` unit.
- **2-tier hint** — reveals the answer one character at a time.
- **Normalized comparison** — case-insensitive and accent-insensitive
  comparison; multi-line answers (`<br>` in note fields) parse correctly via
  `decodeAnswerField()`.
- **Back face** — recall card (headword, IPA, audio, example + translation,
  image, forms, synonyms, antonyms, explanation) with a **Levenshtein visual
  diff** showing exactly which characters were substituted, omitted, or extra,
  plus an accessible verdict plate (Exakt! / near-miss / wrong) and a sound cue.
- **Progressive reveal** — headword appears instantly, context fades in,
  extra information is collapsible (collapsed on phones, open on desktop).
- **Settings menu** — 12 toggles + collapsed "Mer" section + Facebook link,
  built **lazily** on first gear click from a single `MENU_SPEC`.
- **Keyboard shortcuts** — `Alt+S` menu, `Alt+D` night mode, `Ctrl+J` focus
  typing field, `Escape` close.
- **Night mode** — remaps theme tokens, animations, and compositor layers.
- **Session-persistent aurora background** — one shared singleton canvas,
  never recreated per card.
- **Mobile/tablet tuning** — breakpoints at 1024/768/480 px; long diffs
  collapse to two lines with tap-to-expand; settings becomes a compact popover.

### HNA MCQ

- **Question card** — question text (HTML/MathJax supported) with optional
  audio on the cue card.
- **2–4 shuffled options** — `Correct-answer` always sits in **Answer 1**; the
  engine filters empty distractors and applies a Fisher-Yates shuffle (can be
  disabled in settings).
- **Instant feedback** — click an option for an immediate verdict banner, tone
  (correct/wrong), and state coloring; the explanation collapses open on the
  back face when present.
- **Session-only state** — selection and verdict survive the front→back flip
  via `sessionStorage` with a 5-minute TTL; nothing durable is written for
  answers.
- **Progressive-enhancement safety backdoor** — if the JS engine ever fails,
  the raw answer list (in `#mcq-raw-data`) renders as static fallback, so no
  card is ever stranded with zero options.

## Note fields

### HNA Typing

Field names are used directly in the templates. Empty fields are handled
gracefully by `{{#field}}` sections.

| Field | Role |
|---|---|
| `word` | Target answer (typed; hidden answer used for realtime check and diff) |
| `meaning` | Front-cue prompt text |
| `pos` | Part-of-speech badge |
| `transliteration` | IPA / pronunciation cue on the back |
| `audio_word`, `audio_meaning`, `audio_example` | Anki audio fields |
| `example` | Example sentence |
| `example_translated` | Example translation |
| `explain` | Explanation (front hint + back section) |
| `image` | Media on the back |
| `forms`, `synonym`, `antonym` | Extra back-section rows |
| `tag_1`…`tag_4` | Custom tag tray (spare fields, not Anki's built-in `Tags`) |
| `ID` | Card ID badge |

### HNA MCQ

Field **order matters** (the engine maps the template placeholders directly):

| Field | Role |
|---|---|
| `Question` | The question text (HTML / MathJax) |
| `Correct-answer` | **Always the right answer** — shuffled during review |
| `Distraction-1` | Wrong choice (optional) |
| `Distraction-2` | Wrong choice (optional) |
| `Distraction-3` | Wrong choice (optional) |
| `Explanation` | Shown in a collapse on the back (optional) |
| `Audio_Question` | Optional audio on the question |
| `Tags_Custom`, `ID` | Tag badge tray + ID |

## Installation into Anki

### HNA Typing

1. Anki → Tools → Manage Note Types → Add → Clone: *Basic* → create the note
   type.
2. Set the fields listed above (names matter — they map to the template
   placeholders).
3. Open **Cards…**:
   - Front template: paste `Front.html`
   - Back template: paste `Back.html`
   - Styling: paste `_hna_styles_v7.css`
4. Copy into Anki's media folder (`collection.media`):
   `_hna_storage.js`, `_hna_engine.js`, `_hna_diff.js`, `_hna_typing.js`,
   `_hna_aurora.js`, `_hna_styles_v7.css`, `_Inter.ttf`, `_JetBrainsMono.ttf`.

### HNA MCQ

1. Create a note type (clone of *Basic*) named e.g. "HNA MCQ".
2. Set the fields above in the order given.
3. Open **Cards…**:
   - Front template: paste `mcq/Front.html`
   - Back template: paste `mcq/Back.html`
   - Styling: paste `mcq/_mcq_styles.css`
4. Copy into media: `mcq/_mcq_storage.js`, `mcq/_mcq_engine.js`,
   `mcq/_mcq_logic.js`, `mcq/_mcq_aurora.js`, `mcq/_mcq_styles.css`,
   `mcq/_Inter.ttf`, `mcq/_JetBrainsMono.ttf`.

> Use the **minified CSS** for the smallest upload:
> `publish/_hna_styles_v7.css` and `publish/mcq/_mcq_styles.css` (see
> [Release](#release-pipeline)).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+S` | Open/close settings menu |
| `Alt+D` | Toggle night mode |
| `Ctrl+J` | Focus the typing answer field |
| `Escape` | Close settings menu |
| `Space` / `Enter` | Toggle a focused settings switch |

## Development workflow

`preview/` and `publish/` are **generated artifacts** — never edit them
directly. Edit root templates/modules and `mcq/` sources only, then
regenerate (see [Source of truth](#source-of-truth)).

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm ci
```

### Validation

```bash
# One bucket
npm run test:unit

# Full release-quality suite
npm run test:all

# Rebuild both generated review artifacts after source changes
rm -f preview/preview.html mcq/preview/preview_mcq.html
npm run preview:build
node mcq/preview/build-preview.js

# Stage, checksum, rebuild staged previews, and retest the publish artifact
npm run release:check
```

All buckets: `test:preflight`, `test:unit`, `test:mcq`, `test:ram`,
`test:design`, `test:ui`, `test:all` (and `test:publish`).

## Test suite

`tests/run-all.js` is a zero-framework runner: plain `node`, `assert`,
`jsdom`. Every bucket exits non-zero on failure so CI consumes it directly.

| Bucket | Flag | Covers |
|---|---|---|
| Pre-flight | `--preflight` | Static contracts: script order, ES5 syntax, motion contract, no settings markup in HTML, font refs, MCQ backdoor |
| Unit | `--unit` | Levenshtein diff, storage fallback, config layering, typing logic |
| MCQ | `--mcq` | MCQ logic + hermetic DOM integration (grid, shuffle, state round-trip, verdicts, keydown) |
| RAM | `--ram` | Listener counts across flips, timer/rAF handles, aurora singleton, flip churn |
| Design | `--design` | 30 WCAG AA contrast pairs, token stepping, motion contract, theme lockstep |
| UI | `--ui` | Template structure + parity, menu build, shortcuts, typing overlay, diff render, a11y roles |
| Publish | `--publish` | Stage to `publish/`, SHA-256 checksums, re-run full suite against the staged bundle |

## Release pipeline

`npm run release:check` (`node tests/run-all.js --publish`) is the release
gate. It:

1. Runs pre-flight on the source.
2. Stages the 8 main shipped files into `publish/` and the MCQ bundle into
   `publish/mcq/` (CSS ships **minified**, everything else byte-for-byte).
3. Writes SHA-256 checksums to `publish/SHA256SUMS.txt`.
4. Regenerates `preview/preview.html` and `mcq/preview/preview_mcq.html`
   **from the staged bundle** so the reviewed artifact == shipped artifact.
5. Re-runs the full suite against the staged bundle.
6. Prints the final human checklist (paste, media, real review, RSS watch).
7. Exits non-zero (release aborted) on any failure.

See [`docs/PUBLISH_WORKFLOW.md`](docs/PUBLISH_WORKFLOW.md) for the full gate
breakdown and the per-change "which gates to re-run" table.

## Source of truth

| Artifact | Source of truth | Generated? |
|---|---|---|
| Front / Back templates | `Front.html`, `Back.html`, `mcq/Front.html`, `mcq/Back.html` | No |
| Typing CSS | `_hna_styles_v7.css` | No |
| MCQ CSS | `mcq/_mcq_styles.css` | No |
| Storage | `_hna_storage.js` (+ MCQ's `_mcq_storage.js` session copy) | No |
| Engine & aurora | `_hna_engine.js`, `_hna_aurora.js` | No |
| Typing runtime | `_hna_typing.js`, `_hna_diff.js` | No |
| MCQ logic | `mcq/_mcq_logic.js`, `mcq/_mcq_engine.js` | No |
| Preview | `preview/preview.html`, `mcq/preview/preview_mcq.html` | **Yes** — `node preview/build-preview.js`, `node mcq/preview/build-preview.js` |
| Publish bundle | `publish/` | **Yes** — `node tests/run-all.js --publish` |

## Repository layout

```
Note-type/
├── Front.html               # Typing front card template
├── Back.html                # Typing back card template
├── _hna_engine.js           # Shared config, settings UI, shortcuts, audio
├── _hna_storage.js          # localStorage + cookie fallback abstraction
├── _hna_aurora.js           # Shared aurora background singleton
├── _hna_typing.js           # Per-character typing overlay (Front face)
├── _hna_diff.js             # Levenshtein visual diff + verdict rendering
├── _hna_styles_v7.css       # Entire design system (~95 KB readable)
├── _Inter.ttf / _JetBrainsMono.ttf  # Media fonts
├── mcq/                     # Independent MCQ note type package
│   ├── Front.html / Back.html
│   ├── _mcq_engine.js / _mcq_logic.js / _mcq_storage.js / _mcq_aurora.js
│   ├── _mcq_styles.css
│   ├── preview/  docs/  tests/
├── preview/                 # Generated typing preview (build-preview.js)
├── publish/                 # Generated release bundle + SHA256SUMS.txt
├── tests/                   # run-all.js + unit / mcq / ram / design / ui buckets
├── docs/                    # Architecture, RAM leak, resource, bug log, publish
├── plans/                   # Design/UX planning notes
└── .github/workflows/       # GitHub Actions: release gate on every push
```

## Architecture notes

- **ES5-only JavaScript** on purpose — AnkiDroid's QtWebEngine (older WebKit
  builds) predates ES6+; `const`/`let`/arrows/template literals are banned by
  the pre-flight gate. Combined with the shared settings engine, this keeps
  both note types running on Desktop Anki, AnkiDroid, AnkiMobile, and AnkiWeb.
- **Template system** is plain Handlebars-style `{{field}}` substitution by
  Anki — no build step, no template logic.
- **Security rendering policy** — all untrusted note-field content must use
  `textContent`; `innerHTML` on field data is prohibited unless going through
  the strict allowlist sanitizer.
- **System design docs** — see [`docs/README.md`](docs/README.md) for the
  master documentation map:

  | Document | Covers |
  |---|---|
  | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Module-by-module breakdown, data flow, config layering, script-order contract |
  | [`docs/RAM_LEAK_ANALYSIS.md`](docs/RAM_LEAK_ANALYSIS.md) | RAM leak history: root causes, measurements, fixes |
  | [`docs/RESOURCE_MANAGEMENT.md`](docs/RESOURCE_MANAGEMENT.md) | Every resource the note type owns and its handling rules |
  | [`docs/BUG_LOG.md`](docs/BUG_LOG.md) | Every known bug, fixed and open, with reproduction and fix notes |
  | [`docs/PUBLISH_WORKFLOW.md`](docs/PUBLISH_WORKFLOW.md) | The release gate pipeline and human checklist |

## Rollback

Only restore from a **complete** pre-production snapshot: it must include root
files, fonts, `mcq/`, `tests/`, and `docs/`. Every snapshot created before a
production change follows this layout.

```bash
# Choose a complete timestamped snapshot.
ls backups/
STAMP=20260917_185049
BACKUP="backups/pre_production_${STAMP}"

# Refuse an incomplete snapshot rather than partially rolling back MCQ.
test -f "$BACKUP/Front.html" && test -f "$BACKUP/_Inter.ttf" && \
  test -f "$BACKUP/mcq/Front.html" && test -f "$BACKUP/mcq/_mcq_logic.js" || exit 1

# Restore all source inputs, including media and release tests.
cp -a "$BACKUP"/Front.html "$BACKUP"/Back.html "$BACKUP"/_hna_*.js \
  "$BACKUP"/_hna_styles_v7.css "$BACKUP"/_Inter.ttf "$BACKUP"/_JetBrainsMono.ttf ./
cp -a "$BACKUP"/mcq/. ./mcq/
cp -a "$BACKUP"/tests/. ./tests/
cp -a "$BACKUP"/docs/. ./docs/

# Recreate generated artifacts and validate the restored release.
rm -f preview/preview.html mcq/preview/preview_mcq.html
npm run preview:build
node mcq/preview/build-preview.js
npm test
npm run release:check
```

Generated previews and `publish/` are rebuilt, never copied. Snapshots created
before this policy may be typing-only; do not use them for a full MCQ
rollback.

## Contributing

1. **Read existing code first** — understand the patterns before changing.
2. **Preserve ES5 style** — no ES6+ features (compatibility requirement; the
   pre-flight gate enforces it).
3. **Test your changes** — run `node tests/run-all.js` before committing.
4. **Update docs** — keep `ARCHITECTURE.md` and the docs in sync with code
   changes.
5. **Preserve performance** — no memory leaks, no per-flip DOM nodes, no
   unbounded animation; run the RAM bucket before shipping.

## License

Personal use. No external distribution planned.