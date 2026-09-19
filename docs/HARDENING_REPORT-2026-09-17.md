# Production-Hardening Report — HNA + MCQ Note Types

- **Date**: 2026-09-17
- **Repo**: `/home/admin/Projects/Note-type`
- **Status**: ALL PHASES COMPLETE — full suite and publish gate green
- **Gate results**: `preflight 25 / unit 90 / mcq 13 / ram 17 / design 68 / ui 18` → `--publish` → **PUBLISH READY** (17 staged files, `SHA256SUMS.txt` 17 lines)

---

## 1. Executive summary

The six-phase production-hardening plan for the HNA (typing + visual-diff)
note type and its sibling MCQ note type is finished. The plan took the note
types from "works in Anki on a good day" to "reproducible, defensible, and
shippable":

- a **zero-framework test suite** with six buckets and a checksum-verified
  publish gate;
- **two first-class Anki note types** (HNA typing and MCQ) that both share the
  same pre-flight contracts, previews, and staged-bundle re-test;
- a **reproducible toolchain** (npm lockfile contract) and a **single source of
  truth** for media and source files (byte-parity + no-parallel-bundle guards);
- an **XSS audit and hardening pass** over both note types;
- **backup hygiene** preserving every rollback snapshot.

Phases 0–2 (inventory, typing overlay, diff/verdicts) were completed in
earlier work; **Phase 3 (MCQ first-class + pipeline), Phase 4 (MCQ security,
lockfile, parity), and Phase 5 (final sweep)** were completed on 2026-09-17
and are documented here in detail.

---

## 2. Conventions locked during this plan

| Rule | Detail |
| --- | --- |
| Root is the single source of truth | `working/` (deleted, Phase 5), `publish/`, `backups/` are all derived |
| ES5-safe shipped JS | no `=>`, `const`, `let`, template literals, `class`, `Array#fill` — enforced by pre-flight for BOTH note types |
| Runtime-built unicode regex | the `\p{L}` letter regex is built at runtime in try/catch with an ASCII fallback (BUG-030) — never a literal, never `GU` exported unguarded |
| No raw-data loss | raw answer divs stay present under the progressive-enhancement "safety backdoor" |
| Gate command | `node tests/run-all.js && node tests/run-all.js --publish` |
| Test-first, then BUG_LOG | every defect gets a failing test first and a BUG-xxx entry after |
| No commits without an explicit ask | — |
| One media source of truth | MCQ fonts must be byte-identical to the root fonts |
| Timers/RAF never leak across flips | enforced by RAM bucket + per-flip teardown chains |

---

## 3. The six phases

### Phase 0 — Inventory & hygiene (completed pre-2026-09-17)
Baseline inventory of every template, module, preview, backup, and the
publish process. Established the shutdown/teardown discipline for timers,
rAFs, and listeners, and the "root is source of truth" repo policy.

### Phase 1 — Typing overlay (completed pre-2026-09-17)
Rebuilt the front-face typing interaction:
- continuous, positional 1:1 typing model (spaces are typeable);
- word-group verdict classes (`.word-correct` / `.word-wrong` / `.word-extra`
  / `.word-current`), per-char detail spans, never writing into `input#typeans`;
- 2-tier progressive hints (`Ctrl+H`, first-letter then full scaffold);
- typed-answer persistence with a crash-fallback channel
  (`__hnaTypedAnswerBuffer`), shortcut handling, settings menu.
- Rollback snapshot: `backups/phase1_20260917_152903`.

### Phase 2 — Diff & verdicts (completed pre-2026-09-17)
Rewired the back face around per-word verdicts derived from the diff
alignment, with the hidden numeric `posDiffs` retained as a legacy fallback.
Layout, fonts re-verified (`_Inter.ttf`, `_JetBrainsMono.ttf`), and the
Bug Log consolidated (BUG-001…BUG-043 era). Rollback snapshot:
`backups/phase2_20260917_161023`.

The post-Phase-2 baseline was `preflight 22 / unit 96 / ram / design / ui`
(unit bucket later shrank to 93 when the legacy `mcq.test.js` was moved to its
own bucket in Phase 3).

---

### Phase 3: MCQ first-class + pipeline (2026-09-17)

> Scope (user-confirmed): progressive-enhancement fallback + full pipeline
> integration. Explicitly NOT in Phase 3: state-loss verdict hardening and MCQ
> security (the latter became Phase 4).

**Templates — `mcq/Front.html` / `mcq/Back.html`**
- Raw question/answer data moved **inside** `.aurora-card`;
- inline `display:none` attributes removed (the stylesheet now owns hiding, so
  no-HTML-engine consumers of the raw divs always see readable content);
- new comments document the backdoor contract.

**Logic — `mcq/_mcq_logic.js`**
- `AnkiMCQ.markReady()` adds `html.mcq-ready` **after** the grid renders:
  `initFront` after the option loop (before keyboard block), `initBack` after
  the options loop (before the verdict render).

**Styles — `mcq/_mcq_styles.css`**
- SAFETY BACKDOOR block appended: `#mcq-question-raw`, `.mcq-raw-ans` hidden by
  default, revealed when `html:not(.mcq-ready)`; back-face correct marker via
  the shared `--diff-correct-*` tokens. Styling balance re-verified.

**Preview — `mcq/preview/build-preview.js`**
- Mirrors the main preview builder: `HNA_ROOT` support + a freshness gate.

**Tests**
- `tests/pre-flight.js`: +7 MCQ cases — shipped files present, ES5, script
  order (storage→engine→logic→aurora), motion contract, safety-backdoor
  contract, TODO scan, preview freshness.
- `tests/unit/mcq.integration.test.js` (new): **9 hermetic tests** using
  jsdom + `vm.createContext(win)` with stubbed timers/rAF, exercising the real
  MCQ sources — grid+marker render, shuffle false/true + seeded permutation,
  state round-trip + `pycmd('ans')`, back verdicts/tones, neutral no-state,
  empty-choices marker OFF, keydown/destroy listener counts.
- `tests/run-all.js`: new **`mcq` bucket** (`mcq.test.js` moved out of unit),
  `MCQ_SHIPPED` staging spec (9 files incl. both fonts, `_mcq_styles.css`
  minified), `stageBatch`/`verifyStaged` helpers, publish now regenerates BOTH
  previews from the staged bundle (`HNA_ROOT=PUBLISH_DIR`) and re-tests
  `['unit','mcq','ram','design','ui']` against `publish/`; human checklist
  items 7–9 cover the MCQ type.

**Docs**: `docs/PUBLISH_WORKFLOW.md` gained the MCQ gate rows and the
safety-backdoor section.

**Result**: root gate `preflight 22 / unit 93 / mcq 12 / ram 17 / design 68 /
ui 18`; `--publish` → PUBLISH READY, 17 checksum lines, staged minified MCQ
CSS retained all backdoor rules. Rollback snapshot:
`backups/phase3_20260917_162428/pre_mcq`.

---

### Phase 4: MCQ security, npm lockfile, asset parity (2026-09-17)

**4.1 XSS hardening — killed the `item.text` innerHTML sink (BUG-044)**

The full innerHTML audit across both note types:

| Site | Verdict |
| --- | --- |
| `mcq/_mcq_logic.js:236` `initBack` — `btn.innerHTML` built from user-supplied option text | **XSS sink — FIXED** |
| `mcq/_mcq_logic.js:132` / `:215` `container.innerHTML = ''` | safe (clear only) |
| `mcq/_mcq_logic.js:249/251/254` static verdict strings | safe (constant) |
| `mcq/_mcq_aurora.js:25`, `mcq/_mcq_engine.js:13` (decoder `textarea`) | safe (static / known textarea pattern) |
| `_hna_diff.js:265/269/293` — `innerHTML=''` + `textContent` writes | safe |
| `_hna_typing.js:231`, `_hna_diff.js:38` | reads (not writes) |

Why it was a sink: option text arrives as **text** (read via `textContent`
from the raw answer divs) but was re-inserted as **HTML**. A field typed as
`&lt;b&gt;…&lt;/b&gt;` or `&lt;img src=x onerror=…&gt;` re-parses into a real
DOM element. **Test-first (RED)**: a case drove a markup payload through front
AND back; the back-face test failed. **Fix**: `initBack` now builds the badge,
option content, and status caption with `createElement`/`textContent` —
labels are bound as text, never parsed. DOM shape unchanged
(`.option-badge`, `.option-content`, `.status-badge.correct|.wrong`). Also
restored the `isCorrectChoice` declaration dropped during the rewrite.

**4.2 npm lockfile contract**
- `package.json` verified consistent (dev-dep `jsdom ^30.0.1`); lockfile is
  `lockfileVersion 3`; `npm ls` clean.
- Added lockfile-safe scripts: `npm test` → `node tests/run-all.js`,
  `npm run test:publish` → `node tests/run-all.js --publish`.
- New pre-flight case enforces: `package-lock.json` exists, `lockfileVersion
  >= 2` (for `npm ci`), root lock entry covers every declared dep, and the
  jsdom dependency tree is pinned (jsdom, whatwg-url, parse5, symbol-tree,
  saxes, tough-cookie) so a fresh clone is reproducible.

**4.3 Asset parity**
- Verified `mcq/_Inter.ttf` and `mcq/_JetBrainsMono.ttf` are byte-identical to
  the root fonts (sha256 `0be2399e…` / `192a3158…`).
- New pre-flight case enforces this byte-parity going forward — one media
  source of truth.

**Docs**: `docs/BUG_LOG.md` → **BUG-044** entry (symptom, root cause, fix,
regression guard); `PUBLISH_WORKFLOW.md` pre-flight bullets for the lockfile
contract, font parity, and the textContent rule.

**Result**: root gate `preflight 24 / unit 93 / mcq 13 / ram 17 / design 68 /
ui 18`; `--publish` → PUBLISH READY; staged `_mcq_logic.js` clean of sinks.

---

### Phase 5: Final sweep (2026-09-17)

**5.1 Dead code disposed — `_hna_typingLogic.js`**
Survey confirmed `window.AnkiTypingLogic` had **no live consumer**: it was
loaded by nothing in either template, the overlay re-implements the logic
inline, and its only references were ARCHITECTURE.md and its own test. Deleted
the module and `tests/unit/typingLogic.test.js`, removed it from the unit
bucket, and rewrote the ARCHITECTURE.md typing section (also retired the stale
"TO BE REFACTORED" note).

**5.2 `working/` removed + guard**
The hand-maintained duplicate bundle folder is deleted. New pre-flight case
fails loudly if `working/` reappears or any top-level dir re-creates a
parallel copy of the shipped filenames (probes for Front.html + Back.html +
`_hna_engine.js`). Derivation dirs (`publish/`, `backups/`, `node_modules`)
are excluded.

**5.3 BUG-030 ASCII-fallback regression test**
Previously the unicode-property → ASCII fallback path had only indirect
coverage. New test in `tests/unit/typing.test.js`:
- stubs the jsdom window `RegExp` constructor so `new RegExp('[\\p{L}\\p{N}]',
  'u')` throws — simulating Chromium < 64 QtWebEngine;
- re-evaluates the module, forcing `PLACEHOLDER_LETTER_RE = null` → ASCII
  branch;
- flips `frontCard({ word: 'caféя' })` and asserts: ASCII + `À-ɏ` chars (é,
  U+00E9) still produce placeholder spans (4), and the Cyrillic char (я,
  U+044F — unicode-only) degrades to the visible punctuation hint (total 5
  spans, 1 hint) instead of vanishing.
BUG-030's regression-guard note updated to point at this test.

**5.4 Backup hygiene**
Per user decision, **all snapshots are retained** (no pruning). A fresh
pre-Phase-5 rollback snapshot was created: `backups/phase5_20260917_165728/
pre_phase5` (11 main + 9 MCQ files).

**5.5 TODO/marker sweep**
Repo-wide scan: no TODO/FIXME/HACK markers in any shipped file (main or MCQ —
already enforced by pre-flight); only hits are `node_modules` internals and
docs that describe the scan itself.

**Result**: final root gate `preflight 25 / unit 90 / mcq 13 / ram 17 /
design 68 / ui 18` (unit: −4 removed dead tests, +1 ASCII-fallback test);
`--publish` → PUBLISH READY.

---

## 4. Test suite today

Zero-framework runner: `tests/run-all.js` (`node tests/run-all.js`, optional
`--<bucket>`; `--publish` stages + checksums + re-tests + prints the human
checklist).

| Bucket | File | Count | Covers |
| --- | --- | --- | --- |
| preflight | `tests/pre-flight.js` | 25 | shipped presence, ES5, script order, motion contract, aurora kill-switch, template hygiene, AudioContext churn, fonts, CSS budget, unknown-flag rejection, TODO scan, `\p{` literal scan, preview freshness, no-parallel-bundle; MCQ mirror + backdoor contract + font parity; **npm lockfile contract** |
| unit | `tests/unit/*.test.js` | 90 | diff algorithm, storage fallbacks, config, typing overlay (positional model, hints, persistence, **ASCII fallback**) |
| mcq | `tests/unit/mcq.test.js` + `mcq.integration.test.js` | 13 | MCQ logic + 9 hermetic integration cases + **XSS option-text case** |
| ram | `tests/ram/leak.test.js` | 17 | timer/rAF/listener teardown per flip, compositor-layer policy, AudioContext counts |
| design | `tests/design/design.test.js` | 68 | WCAG contrast, token system, breakpoint stepping, animation/motion contract |
| ui | `tests/ui/dom.test.js` | 18 | DOM structure, semantics/ARIA, DOM smoke over both templates |

**Publish gate** stages 8 main + 9 MCQ files into `publish/` (CSS minified),
writes `SHA256SUMS.txt` (17 lines), regenerates both previews from the staged
bundle with `HNA_ROOT=publish`, re-runs the five runtime buckets against the
staged copy, prints the 9-step human checklist, and exits `PUBLISH READY` on
green.

**Bug log** (`docs/BUG_LOG.md`): entries BUG-001…BUG-043 plus the Phase-4
**BUG-044**; open/latent issues ISSUE-001…ISSUE-004 documented separately.

---

## 5. Security & robustness summary

- Stored/marker XSS channel removed: no user-content innerHTML anywhere (both
  note types) — audited and regression-tested (BUG-044).
- Typing regex can no longer crash old engines at parse time: runtime-built
  with an exercised ASCII fallback (BUG-030 test).
- Reproducible installs: locked dependency tree enforced by pre-flight.
- Single source of truth: fonts byte-parity; no parallel bundle dirs.
- Push-to-publish verified by checksum + staged re-test, not trust.

---

## 6. Repo layout (production)

```
Front.html / Back.html        # HNA templates (typ).  mcq/Front.html, mcq/Back.html (MCQ)
_hna_storage.js _hna_engine.js _hna_diff.js _hna_typing.js _hna_aurora.js
_hna_styles_v7.css _Inter.ttf _JetBrainsMono.ttf
mcq/_mcq_storage.js _mcq_engine.js _mcq_logic.js _mcq_aurora.js _mcq_styles.css
mcq/_Inter.ttf mcq/_JetBrainsMono.ttf
preview/  mcq/preview/        # standalone previews + builders (freshness-gated)
tests/    tests/unit/ ram/ design/ ui/   # zero-framework suite
docs/     # BUG_LOG, PUBLISH_WORKFLOW, ARCHITECTURE, reports
publish/  # derived staging dir (regenerated; never hand-edited)
backups/  # rollback snapshots (all retained by user order)
package.json package-lock.json  # jsdom dev-dep; npm test / test:publish
```

Rollback snapshots created during this campaign:
`phase1_20260917_152903`, `phase2_20260917_161023`,
`phase3_20260917_162428/pre_mcq`, `phase5_20260917_165728/pre_phase5`
(plus the pre-existing `pre_production_*`, `pre-refactor-*`, `ux_phase1_*`,
and 2026-08-14…08-16 era snapshots).

---

## 7. How to verify

```sh
rm -f preview/preview.html && node preview/build-preview.js   # main preview
node mcq/preview/build-preview.js                             # MCQ preview
npm test                                                      # full suite
npm run test:publish                                          # publish gate
```

---

## 8. Known, accepted, future

- **Open/latent issues** (non-blocking, tracked in `docs/BUG_LOG.md`):
  ISSUE-001 shared typing timer only cleared in typing module; ISSUE-002
  (resolved note, removed feature); ISSUE-003 `decodeHTML` lacks a type guard;
  ISSUE-004 resize handler re-applies config (idempotent).
- **Out of scope by user decision**: back-face state-loss verdict hardening
  (captured but deferred beyond the 6-phase plan); no further MCQ feature
  work.
- Functionally complete — no blocking work remains for a release at
  `publish/` following the human checklist.