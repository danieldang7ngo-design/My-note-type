'use strict';
/* HNA test runner — zero framework.
   Usage:
     node tests/run-all.js                -> all buckets (preflight, unit, mcq, ram, design, ui)
     node tests/run-all.js --preflight    -> one bucket
     node tests/run-all.js --publish      -> stage to publish/, checksum, re-test staged, checklist
   Exit code 0 = green, 1 = failures.
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minifyCss } = require('./minify-css');

const ROOT = path.resolve(__dirname, '..');

// Reproducibility gate: every bucket loads jsdom through the harness, so a
// missing/stale node_modules must fail with an actionable message instead of a
// raw module-not-found stack thrown by the first bucket file.
let depsOk = true;
try { require('jsdom'); } catch (e) { depsOk = false; }
if (depsOk) { try { require('./harness'); } catch (e) { depsOk = false; } }
if (!depsOk) {
  process.stdout.write('Dependencies missing — run `npm install` in ' + ROOT + ' and retry.\n');
  process.exit(1);
}

const PUBLISH_DIR = path.join(ROOT, 'publish');
const CSS_FILE = '_hna_styles_v7.css';
const MCQ_CSS_FILE = 'mcq/_mcq_styles.css';

// Staging specs: { rel, minify } — rel is the path under ROOT that is also
// created under publish/. CSS ships MINIFIED (comments + whitespace stripped);
// the readable ROOT copy stays the source of truth; every other file ships
// byte-for-byte. The MCQ note type (mcq/) stages into publish/mcq/.
const SHIPPED = [
  { rel: 'Front.html', minify: false },
  { rel: 'Back.html', minify: false },
  { rel: CSS_FILE, minify: true },
  { rel: '_hna_storage.js', minify: false },
  { rel: '_hna_engine.js', minify: false },
  { rel: '_hna_diff.js', minify: false },
  { rel: '_hna_typing.js', minify: false },
  { rel: '_hna_aurora.js', minify: false }
];
const MCQ_SHIPPED = [
  { rel: 'mcq/Front.html', minify: false },
  { rel: 'mcq/Back.html', minify: false },
  { rel: MCQ_CSS_FILE, minify: true },
  { rel: 'mcq/_mcq_storage.js', minify: false },
  { rel: 'mcq/_mcq_engine.js', minify: false },
  { rel: 'mcq/_mcq_logic.js', minify: false },
  { rel: 'mcq/_mcq_aurora.js', minify: false },
  { rel: 'mcq/_Inter.ttf', minify: false },
  { rel: 'mcq/_JetBrainsMono.ttf', minify: false }
];

const BUCKETS = {
  preflight: './pre-flight.js',
  unit: ['./unit/diff.test.js', './unit/storage.test.js', './unit/config.test.js', './unit/typing.test.js'],
  mcq: ['./unit/mcq.test.js', './unit/mcq.integration.test.js'],
  ram: ['./ram/leak.test.js'],
  design: ['./design/design.test.js'],
  ui: ['./ui/dom.test.js']
};

const args = process.argv.slice(2);
// Every --flag must be a known bucket or 'publish'. Unknown flags used to be
// silently dropped (WANTED.filter(b => BUCKETS[b]) produced an empty list) and
// the suite exited 0 without running anything — false green. Fail loudly.
const WANTED = args.filter((a) => a.startsWith('--')).map((a) => a.slice(2));
const KNOWN_FLAGS = ['publish', 'preflight', 'unit', 'mcq', 'ram', 'design', 'ui'];
const unknownFlags = WANTED.filter((f) => KNOWN_FLAGS.indexOf(f) === -1);
if (unknownFlags.length > 0) {
  process.stdout.write('Unknown flag(s): ' + unknownFlags.map((f) => '--' + f).join(', ') + '\n');
  process.stdout.write('Known flags: ' + KNOWN_FLAGS.map((f) => '--' + f).join(', ') + ' — or no flag to run the whole suite.\n');
  process.exit(1);
}
const RUN_ALL = WANTED.length === 0;

function loadBucket(bucket) {
  const files = BUCKETS[bucket];
  const cases = [];
  (Array.isArray(files) ? files : [files]).forEach((f) => {
    const p = path.join(__dirname, f);
    delete require.cache[require.resolve(p)];
    const mod = require(p);
    if (!Array.isArray(mod)) throw new Error(f + ' must export an array of {name, fn}');
    mod.forEach((c) => cases.push(Object.assign({ file: f }, c)));
  });
  return cases;
}

async function runBucket(bucket, rootDir) {
  if (rootDir) process.env.HNA_ROOT = rootDir;
  const cases = loadBucket(bucket);
  let pass = 0, fail = 0;
  const failures = [];
  for (const c of cases) {
    let ok = true, err = null;
    try {
      const result = c.fn();
      if (result && typeof result.then === 'function') await result;
    } catch (e) {
      ok = false; err = e;
    }
    if (ok) { pass++; process.stdout.write('[PASS] ' + c.name + '\n'); }
    else {
      fail++;
      failures.push({ name: c.name, file: c.file, err });
      process.stdout.write('[FAIL] ' + c.name + '\n');
      if (process.env.HNA_VERBOSE) {
        process.stdout.write('       ' + String((err && (err.stack || err.message)) || err).split('\n').join('\n       ') + '\n');
      }
    }
  }
  process.stdout.write(`\n== ${bucket} (root: ${rootDir || ROOT}) ==  ${pass} passed, ${fail} failed\n\n`);
  return { pass, fail, failures };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stageBatch(entries, sums) {
  // The CSS ships MINIFIED (comments + whitespace stripped). The readable ROOT
  // copy stays the source of truth; every other file ships byte-for-byte.
  let mismatch = 0;
  entries.forEach((e) => {
    const src = path.join(ROOT, e.rel);
    const dst = path.join(PUBLISH_DIR, e.rel);
    const srcBytes = e.minify
      ? Buffer.from(minifyCss(fs.readFileSync(src, 'utf8')), 'utf8')
      : fs.readFileSync(src);
    const srcHash = crypto.createHash('sha256').update(srcBytes).digest('hex');
    let dstHash = null;
    if (fs.existsSync(dst)) dstHash = sha256(dst);
    if (dstHash !== srcHash) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, srcBytes);
      mismatch++;
    }
    sums.push(srcHash + '  ' + e.rel);
  });
  return mismatch;
}

function verifyStaged(entries) {
  let ok = true;
  entries.forEach((e) => {
    const expected = e.minify
      ? crypto.createHash('sha256').update(
          Buffer.from(minifyCss(fs.readFileSync(path.join(ROOT, e.rel), 'utf8')), 'utf8')).digest('hex')
      : sha256(path.join(ROOT, e.rel));
    if (expected !== sha256(path.join(PUBLISH_DIR, e.rel))) ok = false;
  });
  return ok;
}

async function runPublish() {
  let totalFail = 0;
  process.stdout.write('=== PUBLISH GATE ===\n\n');

  process.stdout.write('-- pre-flight (source) --\n');
  totalFail += (await runBucket('preflight', null)).fail;

  if (totalFail > 0) {
    process.stdout.write('PUBLISH ABORTED: pre-flight failed.\n');
    process.exit(1);
  }

  if (!fs.existsSync(PUBLISH_DIR)) fs.mkdirSync(PUBLISH_DIR, { recursive: true });

  const sums = [];
  let mainMismatch = 0, mcqMismatch = 0;
  mainMismatch = stageBatch(SHIPPED, sums);
  mcqMismatch = stageBatch(MCQ_SHIPPED, sums);
  fs.writeFileSync(path.join(PUBLISH_DIR, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

  process.stdout.write(`-- staged ${SHIPPED.length} main files + ${MCQ_SHIPPED.length} mcq files into ${PUBLISH_DIR} ` +
    `(${mainMismatch + mcqMismatch} refreshed, ${SHIPPED.length + MCQ_SHIPPED.length - mainMismatch - mcqMismatch} unchanged)\n`);
  const cssStaged = fs.statSync(path.join(PUBLISH_DIR, CSS_FILE)).size;
  const cssSrc = fs.statSync(path.join(ROOT, CSS_FILE)).size;
  process.stdout.write(`  (${CSS_FILE} ships minified: ${(cssStaged / 1024).toFixed(1)} KB vs ${(cssSrc / 1024).toFixed(1)} KB readable source)\n`);
  const mcqStaged = fs.statSync(path.join(PUBLISH_DIR, MCQ_CSS_FILE)).size;
  const mcqSrc = fs.statSync(path.join(ROOT, MCQ_CSS_FILE)).size;
  process.stdout.write(`  (${MCQ_CSS_FILE} ships minified: ${(mcqStaged / 1024).toFixed(1)} KB vs ${(mcqSrc / 1024).toFixed(1)} KB readable source)\n`);

  // verify staged bytes == the canonical artifact bytes (minified css / raw files)
  if (!verifyStaged(SHIPPED) || !verifyStaged(MCQ_SHIPPED)) {
    process.stdout.write('FATAL: staged bundle does not match the canonical artifact bytes (CSS is the minified build of ROOT).\n');
    process.exit(1);
  }

  // Regenerate the human-review previews from the STAGED bundle so the page
  // you review is byte-identical to what ships (no "works in src" drift).
  const { spawnSync } = require('child_process');
  const builds = [
    ['preview/build-preview.js', 'preview/preview.html', PUBLISH_DIR],
    ['mcq/preview/build-preview.js', 'mcq/preview/preview_mcq.html', path.join(PUBLISH_DIR, 'mcq')]
  ];
  builds.forEach(([script, label, stagedRoot]) => {
    const p = path.join(ROOT, script);
    if (fs.existsSync(p)) {
      process.env.HNA_ROOT = stagedRoot;
      const r = spawnSync(process.execPath, [p], { encoding: 'utf8' });
      delete process.env.HNA_ROOT;
      if (r.status !== 0) {
        process.stdout.write('FATAL: preview regeneration failed (' + script + '):\n' + (r.stderr || r.stdout) + '\n');
        process.exit(1);
      }
      process.stdout.write('-- preview regenerated from staged bundle (' + label + ') --\n');
    } else {
      process.stdout.write('-- WARNING: ' + script + ' missing; that preview not regenerated --\n');
    }
  });

  process.stdout.write('-- full suite against STAGED bundle --\n');
  for (const b of ['unit', 'mcq', 'ram', 'design', 'ui']) {
    try {
      totalFail += (await runBucket(b, PUBLISH_DIR)).fail;
    } catch (e) {
      totalFail++;
      process.stdout.write('[BUCKET-ERROR] ' + b + ': ' + (e && e.message) + '\n');
      process.stdout.write('  Re-run the bucket alone to isolate: node tests/run-all.js --' + b + ' (HNA_VERBOSE=1 prints case stacks).\n');
    }
  }
  delete process.env.HNA_ROOT;

  if (totalFail > 0) {
    process.stdout.write('PUBLISH FAILED: ' + totalFail + ' failing test(s). Nothing is ready to ship.\n');
    process.exit(1);
  }

  process.stdout.write('=== FINAL HUMAN CHECKLIST (from docs/PUBLISH_WORKFLOW.md) ===\n');
  [
    '1. Paste Front.html and Back.html into the Anki template editor.',
    '2. Drop _hna_storage.js, _hna_engine.js, _hna_diff.js, _hna_typing.js, _hna_aurora.js, _hna_styles_v7.css into collection.media.',
    '3. Drop _Inter.ttf and _JetBrainsMono.ttf into media if not already present.',
    '4. Sync Anki, review 10 cards, type answers, open the settings menu once.',
    '5. Watch the QtWebEngineProcess child RSS: must return to baseline after review.',
    '6. Confirm preview/preview.html checklist items were reviewed at 375/768/1200 px.',
    '7. MCQ note type: paste mcq/Front.html and mcq/Back.html into its template editor, drop mcq/_mcq_styles.css + mcq/_mcq_*.js into collection.media.',
    '8. Confirm mcq/preview/preview_mcq.html was reviewed at 375/768/1200 px — including one JS-disabled run of the safety backdoor (raw list renders).',
    '9. Version this release in the report (e.g. v7-YYYY-MM-DD-N).'
  ].forEach((l) => process.stdout.write('  ' + l + '\n'));
  process.stdout.write('\nPUBLISH READY.\n');
  process.exit(0);
}

const buckets = RUN_ALL ? Object.keys(BUCKETS) : WANTED.filter((b) => BUCKETS[b]);
async function main() {
  if (args.includes('--publish')) await runPublish();  let totalFail = 0;
  if (RUN_ALL) process.stdout.write('=== HNA FULL SUITE ===\n\n');
  for (const b of buckets) {
    try {
      totalFail += (await runBucket(b, null)).fail;
    } catch (e) {
      totalFail++;
      process.stdout.write('[BUCKET-ERROR] ' + b + ': ' + (e && e.message) + '\n');
      process.stdout.write('  Re-run the bucket alone to isolate: node tests/run-all.js --' + b + ' (HNA_VERBOSE=1 prints case stacks).\n');
    }
  }
  process.stdout.write(totalFail === 0
    ? 'ALL GREEN — ' + buckets.join(', ') + '\n'
    : 'FAILURES: ' + totalFail + ' test(s) failed. See [FAIL] lines above.\n');
  process.exit(totalFail === 0 ? 0 : 1);
}
main();
