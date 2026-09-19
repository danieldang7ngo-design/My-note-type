# Note-type Architecture

## Overview

This project contains two Anki note types for language learning:

1. **Typing (HNA)** - Character-by-character typing with real-time feedback
2. **Multiple Choice (MCQ)** - Question with 2-4 shuffled answer options

Both note types share common infrastructure (engine, storage, aurora) but have separate logic modules.

## Source of Truth

| Artifact              | Source of truth         | Generated? | How to generate                        |
|-----------------------|-------------------------|------------|----------------------------------------|
| Front template        | `Front.html`            | No         | Hand-maintained                        |
| Back template         | `Back.html`             | No         | Hand-maintained                        |
| MCQ Front template    | `mcq/Front.html`        | No         | Hand-maintained                        |
| MCQ Back template     | `mcq/Back.html`         | No         | Hand-maintained                        |
| Typing CSS            | `_hna_styles_v7.css`    | No         | Hand-maintained                        |
| MCQ CSS               | `mcq/_mcq_styles.css`   | No         | Hand-maintained                        |
| Preview               | `preview/preview.html`  | Yes        | `node preview/build-preview.js`        |
| Publish artifact      | `staging output`        | Yes        | `node tests/run-all.js --publish`      |
| Shared storage logic  | `_hna_storage.js`       | No         | Hand-maintained (MCQ has session-only copy) |
| Engine & Aurora       | `_hna_engine.js`, `_hna_aurora.js` | No | Hand-maintained                        |
| Typing runtime        | `_hna_typing.js`, `_hna_diff.js` | No | Hand-maintained                        |
| MCQ logic             | `mcq/_mcq_logic.js`     | No         | Hand-maintained                        |
| MCQ storage (ephemeral)| `mcq/_mcq_storage.js`   | No         | Hand-maintained (session-only)         |

Generated files must never be edited directly; changes to source files require regeneration.

## Storage & Privacy Policy

- **Card-local interaction state** (typed answer, MCQ selection) lives only in memory during the card flip and is flushed to `sessionStorage` only as a crash/reload fallback. No durable storage is used for answers.
- Typing fallback uses `{value:string, expiresAt:number}` with a 30-minute TTL; MCQ state carries its own five-minute `expiresAt`. Malformed or expired state is removed on read.
- **Durable user preferences** (night mode, realtime check, etc.) go to `localStorage` via the `_hna_storage` module, namespaced and minimal.

## Security Rendering Policy

- All untrusted note field content (question text, option labels, answer text) **must** be inserted using `textContent` (or equivalent safe setter).
- `innerHTML`, `insertAdjacentHTML`, `outerHTML` are prohibited for note‑field data.
- Rich HTML support, if ever needed, must go through a strict allowlist sanitizer (tags: `b`, `strong`, `i`, `em`, `br`; strip `script`, `style`, `on*`, `iframe`, `object`, `embed`, and unsafe URL protocols).
- Shared infrastructure (engine, storage, aurora) is audited to avoid sinks; any new sink must follow the same rule.

## Performance & RAM Constraints

- No accumulation of listeners, timers, requestAnimationFrame callbacks, or DOM nodes across multiple card flips.
- Aurora is a singleton canvas; timers are cleared on state teardown.
- All modules must clean up interval/animation listeners in their destroy/reset functions.

## Components

### Shared Modules

#### `_hna_engine.js` (514 lines)
- **Purpose:** Settings UI, keyboard shortcuts, configuration management
- **Exports:** `window.AnkiEngine`
- **Key functions:**
  - `decodeHTML()` - Safe HTML entity decoding
  - `toggleSettings()` - Show/hide settings menu
  - `MENU_SPEC` - Settings menu definition (shared by both note types)
- **Used by:** Both Typing and MCQ

#### `_hna_storage.js` (94 lines)
- **Purpose:** Cross-platform storage with localStorage + cookie fallback
- **Exports:** `safeGet()`, `safeSet()`, `STORAGE_KEYS`
- **Storage keys:**
  - `CONFIG` - User settings (night mode, realtime check, etc.)
  - `TYPED_ANSWER` - Persisted typing input across flips
- **Used by:** Both Typing and MCQ (MCQ has its own copy)

#### `_hna_aurora.js` (181 lines)
- **Purpose:** Animated aurora background (session-persistent singleton)
- **Exports:** Initializes aurora canvas on page load
- **Optimization:** Single canvas reused across all cards to reduce GPU load
- **Used by:** Both Typing and MCQ (MCQ has its own copy)

### Typing (HNA) Modules

#### `_hna_typing.js` (overlay — self-contained)
- **Purpose:** Real-time character-by-character overlay for the `{{type:word}}`
  input. The positional state machine, verdict painting, and 2-tier hint logic
  are all inline here — the old separate `_hna_typingLogic.js` pure-logic
  module was deleted in Phase 5 as dead code (the overlay had already absorbed
  its behaviour).
- **Dependencies:** `AnkiEngine`, `safeGet/safeSet`
- **Responsibilities:**
  - Build the overlay: per-char placeholder spans, space/linebreak spans,
    punctuation hints
  - Listen for input on the (invisible-but-active) `#typeans` input
  - Map typed positions to the answer's typeable slots 1:1 and paint
    per-character verdicts the moment each letter lands (green/red, plus
    `*-space` variants for separators); extras past the answer collect into a
    single `.word-extra` unit
  - Persist the typed answer to storage (with a crash-fallback global)
- **Compat note:** the letter regex is built at runtime inside try/catch
  (`new RegExp('[\\p{L}\\p{N}]', 'u')`) with an ASCII `/[a-zA-Z0-9À-ɏ]/i`
  fallback, so engines without Unicode property escapes (BUG-030) still get
  letter placeholders — exercised by a dedicated fallback test.

#### `_hna_diff.js` (352 lines)
- **Purpose:** Visual diff engine (character-by-character comparison)
- **Used by:** Typing Back card to show mistakes

### Multiple Choice (MCQ) Modules

#### `mcq/_mcq_logic.js` (278 lines)
- **Purpose:** MCQ gameplay logic (shuffle, state, validation)
- **Exports:** `window.AnkiMCQ`
- **Key functions:**
  - `getRawChoicesFromDOM()` - Read and filter answer fields (skips empty/placeholder)
  - `shuffleChoices()` - Fisher-Yates shuffle
  - `getCardSignature()` - Unique identifier for state persistence
  - `saveState()` / `loadState()` - Front→Back state transition
- **Dynamic rendering:** Already supports 2-4 options (filters empty fields)

#### `mcq/_mcq_engine.js` (302 lines)
- **Purpose:** MCQ UI, settings, event handling
- **Reuses:** `AnkiEngine` namespace for theme compatibility
- **Default config:**
  - `shuffleChoices: true` - Randomize order each review
  - `playSound: true` - Audio feedback on correct/wrong
  - `showExplain: true` - Show explanation on Back

#### `mcq/_mcq_storage.js` (68 lines)
- **Purpose:** Same as `_hna_storage.js` but uses `sessionStorage` for ephemeral MCQ state
- **Note:** This is intentional code reuse (not DRY violation) to keep MCQ independent

#### `mcq/_mcq_aurora.js` (173 lines)
- **Purpose:** Copy of `_hna_aurora.js` for MCQ (intentional reuse)

## Data Flow

### Typing (HNA)

```
Note Fields ({{word}}, {{meaning}}, etc.)
    ↓
Template replacement (Handlebars-style {{}} → actual values)
    ↓
Front.html rendered
    ↓
User types in overlay
    ↓
_hna_typing.js input listener (positional model)
    ↓
    overlay paints per-character verdicts (green/red on each typed position)
    ↓
persist typed answer to storage
    ↓
Storage persists typed answer
    ↓
User flips to Back
    ↓
_hna_diff.js shows visual diff
```

### Multiple Choice (MCQ)

```
Note Fields ({{Question}}, {{Answer 1-4}})
    ↓
Template replacement
    ↓
Front.html rendered with hidden raw data
    ↓
_mcq_logic.js reads raw choices from DOM
    ↓
Filter out empty fields and {{}} placeholders
    ↓
Shuffle remaining choices (if enabled)
    ↓
Render buttons dynamically (2-4 options)
    ↓
User clicks an option
    ↓
_mcq_logic.js checks correctness
    ↓
Save state to sessionStorage (ephemeral)
    ↓
User flips to Back
    ↓
_mcq_logic.js loads state
    ↓
Render verdict (correct/wrong) + explanation
```

## Template System

Both note types use **Handlebars-style** placeholders (`{{variable}}`):

- Not the actual Handlebars library - just simple string replacement
- Anki replaces `{{field_name}}` with note field content before rendering
- No build step required
- Advantages: Simple, no dependencies, works everywhere
- Disadvantages: No logic in templates (if/else handled in JS)

## Styling

- ES5 JavaScript (no ES6+ features)
- Uses `var`, function expressions (no arrow functions, template literals)
- Reason: Maximum compatibility with older browsers (QtWebEngine in AnkiDroid)

## Testing

### Unit Tests

Located in `tests/unit/`:

- `typing.test.js` - Typing overlay tests (positional model, hints, ASCII fallback)
- `mcq.test.js` - MCQ logic tests (minimal DOM mocking)
- `diff.test.js` - Visual diff algorithm tests
- `storage.test.js` - Storage fallback tests
- `config.test.js` - Configuration validation tests

### Test Runner

- Run with: `node tests/run-all.js`
- Uses `jsdom` for minimal DOM environment when needed
- Pure logic tests run in plain Node (no DOM)

### Integration Tests

Located in `tests/ui/`:

- `dom.test.js` - Full DOM integration tests

## Edge Cases

### Typing

- **Very long input:** State arrays grow with input length; no known limit
- **Rapid keypresses:** Each `keyup` processed individually; debouncing not needed
- **Non-printable keys:** Ignored in `processInput` (only single-character keys processed)
- **Unicode:** Normalized for comparison (case-insensitive, accent-insensitive)

### MCQ

- **All fields empty:** Results in zero options → UI shows no buttons (unlikely in practice)
- **Mixed empty/non-empty:** Only non-empty fields rendered; shuffling works on subset
- **HTML in answers:** Preserved as raw `innerHTML` (supports `<b>`, `<br>`, etc.)
- **2-3 options:** Fully supported; grid layout adapts automatically

## Performance Optimizations

1. **Aurora singleton:** One canvas for entire session (not per card)
2. **Textarea reuse:** Single `<textarea>` element reused for HTML decoding
3. **Event cleanup:** RAF/timers canceled on card change to prevent memory leaks
4. **Debounced storage:** Config writes debounced to reduce I/O
5. **SessionStorage for MCQ:** Ephemeral state doesn't pollute localStorage

## Browser Compatibility

- **Desktop Anki:** Chromium-based (modern features available)
- **AnkiDroid:** QtWebEngine 5.12+ (ES5 required, unicode regex built at runtime)
- **AnkiMobile:** WebKit-based (iOS Safari equivalent)
- **AnkiWeb:** Modern browsers only

## File Organization

```
Note-type/
├── Front.html              # Typing front card template
├── Back.html               # Typing back card template
├── _hna_engine.js          # Shared engine (settings, shortcuts)
├── _hna_storage.js         # Shared storage abstraction
├── _hna_aurora.js          # Shared aurora background
├── _hna_typing.js          # Typing overlay (self-contained)
├── _hna_diff.js            # Visual diff engine
├── _hna_styles_v7.css      # Typing styles (~95KB)
├── mcq/
│   ├── Front.html          # MCQ front card template
│   ├── Back.html           # MCQ back card template
│   ├── _mcq_engine.js      # MCQ UI and settings
│   ├── _mcq_logic.js       # MCQ gameplay logic
│   ├── _mcq_storage.js     # MCQ storage (copy of _hna_storage.js)
│   ├── _mcq_aurora.js      # MCQ aurora (copy of _hna_aurora.js)
│   └── _mcq_styles.css     # MCQ styles (~95KB)
├── tests/
│   ├── unit/               # Unit tests
│   ├── ui/                 # Integration tests
│   ├── harness.js          # Test framework
│   └── run-all.js          # Test runner
└── docs/                   # Additional documentation
```

## Future Improvements

### Typing

- [ ] Simplify `_hna_typing.js` to thin wrapper (~200 lines)
- [ ] Extract more logic into pure functions
- [ ] Add accessibility attributes (ARIA labels)

### MCQ

- [ ] Extract shared modules (storage, aurora) to avoid duplication
- [ ] Add "show correct answer" hint on wrong selection
- [ ] Support partial scoring for multi-select questions

### Shared

- [ ] Add internationalization framework (currently hardcoded Swedish/Vietnamese)
- [ ] Introduce build step for template precompilation (optional)
- [ ] Upgrade to ES6+ with Babel transpilation (optional)

## Contributing

When modifying this codebase:

1. **Read existing code first** - Understand the patterns before changing
2. **Preserve ES5 style** - No ES6+ features (compatibility requirement)
3. **Test your changes** - Run `node tests/run-all.js` before committing
4. **Update this doc** - Keep ARCHITECTURE.md in sync with code changes
5. **Preserve performance** - Don't introduce memory leaks or excessive reflows

## License

Personal use. No external distribution planned.
