# Release Report — v7-2026-09-12-1

## 1. Summary of Changes

This release synchronizes the project with the master sources after recovering
from a backup state, implementing multi-line answer support across the typing
overlay and visual diff, mobile performance optimizations, and full test suite
alignment.

| Component | Status | Details |
|---|---|---|
| `_hna_engine.js` | Updated | Added `decodeAnswerField()` parser, `showStats` & `auroraFlow` toggles, 12-item `MENU_SPEC`, debounced `applyConfig` rAF |
| `_hna_diff.js` | Updated | Multi-line `<br>` answer support via `breakMap`, lookahead backtrace alignment optimization |
| `_hna_typing.js` | Updated | Multi-line input support (`typeableSlots`, `.char-linebreak`), 200ms persist debounce, hint integration |
| `_hna_aurora.js` | Updated | Mobile ≤768px early-bail (skips layout queries during VKB keyboard animation), `visualViewport` listener |
| `_hna_styles_v7.css` | Updated | 900px desktop card profile, `filter: none` on ribbon elements, `pause-aurora-flow` animation state pause, `.stats-footer` styling |
| `Front.html` / `Back.html` | Updated | Added `.stats-footer`, badge tooltips (`title`), ARIA live region status attributes on diff container |
| `docs/*` | Synchronized | Architecture, bug logs, publish workflow, and README aligned with new codebase contracts |
| `tests/*` | Passing (100%) | 179 tests across preflight, unit, ram, design, ui suites all green |

## 2. Directory Structure

```
/home/admin/Projects/Note-type/
├── working/                   # Unminified working files (with developer commentary)
│   ├── Front.html
│   ├── Back.html
│   ├── _hna_aurora.js
│   ├── _hna_diff.js
│   ├── _hna_engine.js
│   ├── _hna_storage.js
│   ├── _hna_typing.js
│   ├── _hna_styles_v7.css
│   ├── _Inter.ttf
│   └── _JetBrainsMono.ttf
├── publish/                   # Production release bundle (minified CSS, SHA256 checksums)
│   ├── Front.html
│   ├── Back.html
│   ├── _hna_aurora.js
│   ├── _hna_diff.js
│   ├── _hna_engine.js
│   ├── _hna_storage.js
│   ├── _hna_typing.js
│   ├── _hna_styles_v7.css     # Semantics-preserving minified (92.1 KB)
│   ├── _Inter.ttf
│   ├── _JetBrainsMono.ttf
│   └── SHA256SUMS.txt
├── docs/                      # Architectural and operational documentation
├── tests/                     # Zero-framework automated test suite
├── preview/                   # Visual preview tool
└── package.json
```

## 3. Verification & Gate Results

- `node tests/run-all.js --publish`: **ALL GREEN (179 passed, 0 failed)**
- Pre-flight contract analysis: **15 passed, 0 failed**
- Unit logic tests: **74 passed, 0 failed**
- RAM leak & resource management: **16 passed, 0 failed**
- Design system & WCAG AA contrast: **68 passed, 0 failed**
- UI & DOM structure parity: **18 passed, 0 failed**
