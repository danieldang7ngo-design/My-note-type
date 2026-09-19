# Note-type

Production-oriented Anki note types for active typing recall and multiple-choice practice.

## Development workflow

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

Available buckets: `test:preflight`, `test:unit`, `test:mcq`, `test:ram`,
`test:design`, `test:ui`, and `test:all`.

## Source of truth

Edit root templates/modules and `mcq/` sources only. `preview/` and `publish/`
are generated artifacts and must be regenerated, not edited. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`docs/PUBLISH_WORKFLOW.md`](docs/PUBLISH_WORKFLOW.md).

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

Snapshots created before this policy may be typing-only; do not use them for a
full MCQ rollback. Generated previews and `publish/` are rebuilt, never copied.
