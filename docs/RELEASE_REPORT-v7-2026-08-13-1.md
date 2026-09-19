# HNA Release Report — v7-2026-08-13-1

**Date**: 2026-08-13
**Version**: v7-2026-08-13-1
**Status**: PUBLISH READY (all gates green)

## What this release covers

This release completes the HNA note-type deliverable: full documentation,
5 subagents, a zero-framework test suite covering every shipped file, a
human-review preview page, and a one-command publish gate. It also fixes
two bugs found by the new UI tests and one by the CSS design tests.

## Gate results (all green)

| Gate | Bucket | Passed | Failed |
|---|---|---|---|
| 1 | Pre-flight (static contracts) | 9 | 0 |
| 2 | Unit (diff, storage, config, typing) | 65 | 0 |
| 3 | RAM / leak (20-flip churn, singletons, listeners) | 13 | 0 |
| 4 | Design (contrast, tokens, motion, breakpoints) | 32 | 0 |
| 5 | UI / DOM (structure, menu, shortcuts, overlay, verdicts) | 15 | 0 |
| — | **Total** | **134** | **0** |
| 6 | Preview — `preview/preview.html` (generated, verified in jsdom end-to-end; human visual pass still required) | — | — |
| 7 | Publish — `node tests/run-all.js --publish` | staged 8 files, SHA256SUMS.txt written, full suite re-run against staged bundle | 0 |

## Bugs fixed in this release

| ID | Symptom | Root cause | Fix |
|---|---|---|---|
| BUG-017 | Light-mode aurora hexes (`#FF6B6B/#FF8787/#FF9999`) contradicted their `-rgb` companions (78,194,224 / 47,168,200 / 14,106,75) | retheme pass updated rgb tokens but not hexes; drift was invisible (hexes unused by rules) | hexes now `#4EC2E0 / #2FA8C8 / #0E6A4B`, matching rgb exactly; accent measured ≈4.35:1 on lift → documented WARN (AA large-text ok) |
| BUG-018 | Card-type buttons hid ALL cue cards — prompt area went blank | mode ids (`meaning-word`, `example-word`) do not match cue classes (`cue-card--meaning`, `cue-card--example`); `.cue-card--` + mode query always missed | explicit mode→suffix map in `applyCardType` |
| BUG-019 | Exempel → Ord mode never gap-filled the example on the Front | gap target read `.swedish-word` (Back-only class) → empty on Front; answer span never re-targeted to the word | fall back to `.cue-card--word .prompt-content`; re-target answer + rebuild overlay like word-meaning |

## Files changed

- `_hna_typing.js` — BUG-018 mode→cue map, BUG-019 gap source fallback + answer re-target
- `_hna_styles_v7.css` — BUG-017 light aurora hexes
- `tests/ui/dom.test.js` — +2 tests (all-3-mode visibility, front example gap)
- `tests/design/design.test.js` — BUG-017 hex/companion lockstep tests (added earlier)
- `docs/BUG_LOG.md` — BUG-017/018/019 entries with regression guards
- `docs/ARCHITECTURE.md` — card-type selector section updated
- `docs/PUBLISH_WORKFLOW.md` — preview regeneration documented (gate 6 + 7)
- `preview/build-preview.js` — NEW: generates `preview/preview.html` from the shipped files (or `HNA_ROOT=<dir>` staged bundle)
- `preview/preview.html` — generated page (regenerated automatically by `--publish`)
- `tests/run-all.js` — `--publish` now regenerates the preview from the staged bundle

## Deliverables

| Item | Location | Status |
|---|---|---|
| Master docs | `docs/README.md`, `ARCHITECTURE.md`, `RAM_LEAK_ANALYSIS.md`, `RESOURCE_MANAGEMENT.md`, `BUG_LOG.md` (BUG-001..019, ISSUE-001..004), `PUBLISH_WORKFLOW.md` | done |
| Subagents | `.opencode/agent/` — memory-engineer, design-reviewer, test-engineer, bug-triage, release-manager | done |
| Test suite | `tests/` — pre-flight, unit (4 files), ram, design, ui + `harness.js` + `run-all.js` | 134/134 green |
| Preview | `preview/preview.html` | generated; open in a browser for the human visual pass |
| Publish bundle | `publish/` — 8 files + `SHA256SUMS.txt` | staged, verified |

## What is still required from a human (cannot be automated)

1. **Preview visual pass** — open `preview/preview.html`, walk the checklist in
   `docs/PUBLISH_WORKFLOW.md` §6 (night/ultra/perf/aurora toggles, 3 card
   types, flip + verdicts, 375/768/1200 px widths, no console errors).
2. **Anki install** — final human checklist printed by `--publish`
   (paste templates, drop media, sync, 10-card review, watch QtWebEngine RSS
   return to baseline).

## Known / accepted issues (documented, not blockers)

- Light `--text-muted` on card base = 4.23:1 (WARN; chrome-only usage)
- Accent on lift ≈ 4.35:1 (WARN; passes large-text AA)
- ISSUE-001..004 — latent notes in `BUG_LOG.md` (typing timer cleanup,
  example gap-fill regex scope, `decodeHTML` type guard, resize re-applies
  config)
- Fonts `_Inter.ttf` / `_JetBrainsMono.ttf` referenced but not in this repo —
  must be added to Anki media (preflight gate 9 passes on declaration)
