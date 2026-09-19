'use strict';
/* Pre-flight static checks: ES5-only JS, load order, motion contract,
   template hygiene, audio resource rules. These scan shipped files. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { minifyCss } = require('./minify-css');

const ROOT = process.env.HNA_ROOT || path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

/* True when the stripped JS source contains a regex-LITERAL \p{ escape.
   The shipped fix builds the unicode-property regex at runtime
   (new RegExp('[\\p{L}\\p{N}]', 'u')) — that string contains TWO backslashes
   in source, so its \p{ is always preceded by another backslash and skipped
   here. A real literal (/[\p{L}\p{N}]/u) has a single backslash preceded by
   the regex delimiter or a `[`, which flags it. */
function hasLiteralP(src) {
  const re = /\\p\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (src.charAt(m.index - 1) !== '\\') return true;
  }
  return false;
}

/* Strip // and /* *\/ comments from JS while keeping string contents intact
   (the modules contain URLs in comments that must not trip the scanner). */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i]; i++;
      }
      out += (src[i] || ''); i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

function scriptSrcs(tpl) {
  const out = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(tpl)) !== null) out.push(m[1]);
  return out;
}

const cases = [];

cases.push({
  name: 'all shipped files present',
  fn() {
    const names = ['Front.html', 'Back.html', '_hna_styles_v7.css',
      '_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
    names.forEach((n) => {
      if (!fs.existsSync(path.join(ROOT, n))) throw new Error('missing ' + n);
    });
  }
});

cases.push({
  name: 'preflight: JS is ES5-compatible (no =>, const, let, template literals, class, fill)',
  fn() {
    const jsFiles = ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
    const bad = [];
    const patterns = [
      ['arrow', '=>'],
      ['const ', '\\bconst\\s+'],
      ['let ', '\\blet\\s+'],
      ['template-literal', '`'],
      ['class ', '\\bclass\\s+'],
      ['.fill(', '\\.fill\\('],
      ['spread', '\\.\\.\\.'],
      ['default-param', '=\\s*\\{[^}]*\\s*=\\s*\\}|function\\s*[A-Za-z0-9_]*\\s*\\([^)]*=\\s*[^)]*\\)']
    ];
    for (const f of jsFiles) {
      const src = stripComments(read(f));
      for (const [label, re] of patterns) {
        let m;
        const r = new RegExp(re, 'g');
        while ((m = r.exec(src)) !== null) bad.push(f + ': ' + label + ' @' + m.index);
      }
    }
    if (bad.length) throw new Error('ES5 violations:\n  ' + bad.join('\n  '));
  }
});

cases.push({
  name: 'preflight: script load order is storage -> engine -> diff -> typing -> aurora',
  fn() {
    ['Front.html', 'Back.html'].forEach((tpl) => {
      const srcs = scriptSrcs(read(tpl));
      const expected = ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
      if (srcs.length !== expected.length) {
        throw new Error(tpl + ': found ' + srcs.join(', ') + ', expected ' + expected.join(', '));
      }
      for (let i = 0; i < expected.length; i++) {
        if (srcs[i] !== expected[i]) throw new Error(tpl + ': position ' + i + ' is ' + srcs[i] + ' (expected ' + expected[i] + ')');
      }
    });
  }
});

cases.push({
  name: 'preflight: each script appears exactly once per template',
  fn() {
    ['Front.html', 'Back.html'].forEach((tpl) => {
      const src = read(tpl);
      ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'].forEach((n) => {
        const count = (src.split('src="' + n + '"').length - 1);
        if (count !== 1) throw new Error(tpl + ': ' + n + ' appears ' + count + ' times');
      });
    });
  }
});

cases.push({
  name: 'preflight: motion contract — no infinite, no will-change, no transition of filter, no filter inside keyframes',
  fn() {
    const css = stripComments(read('_hna_styles_v7.css'));
    if (/\binfinite\b/.test(css)) throw new Error('"infinite" animation found');
    if (/will-change/.test(css)) throw new Error('"will-change" found');
    if (/transition[^;{]*filter/.test(css)) throw new Error('filter in a transition (layer churn)');

    const keyframes = css.match(/@keyframes\s+[^{]+\{[\s\S]*?\}\s*\}/g) || [];
    for (const kf of keyframes) {
      if (/filter\s*:/.test(kf)) {
        throw new Error('keyframes must never animate filter: ' + kf.slice(0, 160));
      }
    }
  }
});

cases.push({
  name: 'preflight: aurora kill-switch CSS removed — animation runs unconditionally',
  fn() {
    const css = read('_hna_styles_v7.css');
    assertTrue(!/\.pause-animation|\.pause-aurora(?![-\w])/.test(css),
      'no pause-animation/pause-aurora selectors may remain (pause-aurora-flow is allowed)');
    assertTrue(/\.aurora-bg::before\s*\{[^}]*animation\s*:/.test(css),
      '.aurora-bg::before must keep its animation');
  }
});

cases.push({
  name: 'preflight: templates contain no settings markup, no .aurora-bg, no inline colors',
  fn() {
    ['Front.html', 'Back.html'].forEach((tpl) => {
      const src = stripHtmlComments(read(tpl));
      if (/settings-template|sw_|menu-item|menu-link/.test(src)) throw new Error(tpl + ' contains settings markup');
      if (/aurora-bg/.test(src)) throw new Error(tpl + ' contains .aurora-bg');
      if (/#[0-9a-fA-F]{3,6}\b/.test(src)) throw new Error(tpl + ' contains inline hex color');
    });
  }
});

cases.push({
  name: 'preflight: no AudioContext churn (no .close(), exactly one session context creation)',
  fn() {
    const jsFiles = ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
    let creations = 0;
    for (const f of jsFiles) {
      const src = stripComments(read(f));
      if (/\.close\s*\(/.test(src)) throw new Error(f + ' calls .close()');
      creations += (src.match(/new\s*\(\s*window\.AudioContext\s*\|\|\s*window\.webkitAudioContext\s*\)/g) || []).length;
    }
    if (creations !== 1) throw new Error('expected exactly one AudioContext creation (AnkiAudio session context), got ' + creations);
  }
});

cases.push({
  name: 'preflight: fonts referenced as _Inter.ttf / _JetBrainsMono.ttf',
  fn() {
    const css = read('_hna_styles_v7.css');
    if (!/_Inter\.ttf/.test(css)) throw new Error('_Inter.ttf not referenced');
    if (!/_JetBrainsMono\.ttf/.test(css)) throw new Error('_JetBrainsMono.ttf not referenced');
  }
});

// Size ceilings for the CSS artifact: the staged file ships minified (see
// tests/minify-css.js — comments stripped, whitespace collapsed), so both the
// readable source and the minified build (current source AND the staged file)
// get a budget. CSS bloat past these ceilings fails the gate.
// Source budget: 200000 -> 206000 on the 2026-08-16 three-feature pass
// (≤768 flush-left read, compact 30px audio, frosted tint 0.55/0.72). That
// pass added 13 test-pinned rules (~2.1KB, every one asserted by
// tests/design/design.test.js) plus their editorial annotations in this
// file's documented style. The readable source ships with comments, so the
// raw budget is the binding one: the file now sits at ~204.5KB (204,481)
// against 206000. The minified anti-bloat gate (100000) is UNCHANGED and
// still passes at ~94.2KB (94,204).
cases.push({
  name: 'preflight: CSS size budget (source + staged minified)',
  fn() {
    const srcCss = read('_hna_styles_v7.css');
    const srcBytes = Buffer.byteLength(srcCss, 'utf8');
    const minBytes = Buffer.byteLength(minifyCss(srcCss), 'utf8');
    assertTrue(srcBytes < 206000,
      'source _hna_styles_v7.css is ' + srcBytes + ' bytes — budget is 206000 (CSS bloat fails the gate)');
    assertTrue(minBytes < 100000,
      'minified source CSS is ' + minBytes + ' bytes — budget is 100000');

    const staged = path.join(ROOT, 'publish', '_hna_styles_v7.css');
    if (fs.existsSync(staged)) {
      const stagedBytes = fs.statSync(staged).size;
      const stagedCss = fs.readFileSync(staged, 'utf8');
      assertTrue(stagedBytes < 100000,
        'publish/_hna_styles_v7.css is ' + stagedBytes + ' bytes — budget is 100000');
      // BUG-047: never compare the staged size to the readable source. That
      // comparison doubles as a staleness check and wedges the publish gate
      // whenever a source shrink makes the previous (larger) staged build
      // bigger than the new readable source — runPublish runs this pre-flight
      // BEFORE it restages, so the gate aborts and can never refresh the
      // bundle. The real invariant is "the staged artifact is a minified
      // build": the minifier (tests/minify-css.js) strips every block
      // comment, so a comment-free staged file is a build artifact and the
      // 100000 budget bounds it. Drift is still caught by verifyStaged()
      // inside runPublish, which restages the canonical minified bytes.
      assertTrue(stagedCss.indexOf('/*') === -1,
        'publish/_hna_styles_v7.css contains CSS comments — it is not a minified build; re-run `node tests/run-all.js --publish`');
    }
  }
});

cases.push({
  name: 'preflight: run-all rejects unknown CLI flags with a non-zero exit and a message naming them',
  fn() {
    // Guards tests/run-all.js: unknown --flags must not be silently dropped
    // into an empty bucket list that exits 0 (false green).
    const runner = path.join(__dirname, 'run-all.js');
    const r = spawnSync(process.execPath, [runner, '--bogus-flag'], { encoding: 'utf8' });
    assertTrue(r.status !== 0, 'unknown flag must exit non-zero, got status ' + r.status);
    const out = (r.stdout || '') + (r.stderr || '');
    assertTrue(out.indexOf('--bogus-flag') !== -1,
      'error message must name the bogus flag, got: ' + out.slice(0, 300));
    assertTrue(out.indexOf('--preflight') !== -1,
      'error message must list the known flags, got: ' + out.slice(0, 300));
  }
});

cases.push({
  name: 'preflight: _Inter.ttf and _JetBrainsMono.ttf physically exist in the working root',
  fn() {
    ['_Inter.ttf', '_JetBrainsMono.ttf'].forEach((f) => {
      const p = path.join(ROOT, f);
      assertTrue(fs.existsSync(p),
        'font file ' + f + ' missing from ' + ROOT + ' — @font-face references it, so it must ship with the bundle');
    });
  }
});

cases.push({
  name: 'preflight: no TODO/FIXME/HACK markers remain in shipped files',
  fn() {
    const shipped = ['Front.html', 'Back.html', '_hna_styles_v7.css',
      '_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
    const hits = [];
    const re = /\b(?:TODO|FIXME|HACK)\b/g;
    shipped.forEach((f) => {
      const src = read(f);
      let m;
      while ((m = re.exec(src)) !== null) hits.push(f + ': ' + m[0] + ' @' + m.index);
    });
    if (hits.length) throw new Error('stray markers in shipped files:\n  ' + hits.join('\n  '));
  }
});

cases.push({
  name: 'preflight: no regex-literal \\p{ escapes in shipped JS (unicode-property regex is runtime-built)',
  fn() {
    const jsFiles = ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'];
    const bad = [];
    jsFiles.forEach((f) => {
      const src = stripComments(read(f));
      if (hasLiteralP(src)) {
        bad.push(f + ': regex-literal \\p{ present — property escapes fail to PARSE on older QtWebEngine; use new RegExp(\'[\\\\p{L}\\\\p{N}]\', \'u\')');
      }
    });
    if (bad.length) throw new Error('regex-literal \\p{ found:\n  ' + bad.join('\n  '));
  }
});

cases.push({
  name: 'preflight: preview/preview.html is not older than the working sources (preview freshness)',
  fn() {
    // The human-review gate must reflect the current bundle. build-preview.js
    // skips regeneration when the artifact is already newer than every input;
    // this test fails when a source has been touched since the last build.
    const out = path.join(ROOT, 'preview', 'preview.html');
    assertTrue(fs.existsSync(out),
      'preview/preview.html missing — run `node preview/build-preview.js` to regenerate');
    const outM = fs.statSync(out).mtimeMs;
    const stale = [];
    ['Front.html', 'Back.html', '_hna_styles_v7.css',
      '_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js'].forEach((n) => {
      const p = path.join(ROOT, n);
      if (fs.existsSync(p) && fs.statSync(p).mtimeMs > outM) stale.push(n);
    });
    const gen = path.join(ROOT, 'preview', 'build-preview.js');
    if (fs.existsSync(gen) && fs.statSync(gen).mtimeMs > outM) stale.push('preview/build-preview.js');
    assertTrue(stale.length === 0,
      'preview/preview.html is stale — newer than it: ' + stale.join(', ') + '. Regenerate with `node preview/build-preview.js`.');
  }
});

cases.push({
  name: 'preflight (mcq): preview/preview_mcq.html is not older than working MCQ sources',
  fn() {
    const out = path.join(ROOT, 'mcq', 'preview', 'preview_mcq.html');
    assertTrue(fs.existsSync(out),
      'mcq/preview/preview_mcq.html missing — run `node mcq/preview/build-preview.js` to regenerate');
    const outM = fs.statSync(out).mtimeMs;
    const stale = [];
    ['Front.html', 'Back.html', '_mcq_styles.css', '_mcq_storage.js', '_mcq_engine.js', '_mcq_logic.js', '_mcq_aurora.js'].forEach((n) => {
      const p = path.join(ROOT, 'mcq', n);
      if (fs.existsSync(p) && fs.statSync(p).mtimeMs > outM) stale.push('mcq/' + n);
    });
    const gen = path.join(ROOT, 'mcq', 'preview', 'build-preview.js');
    if (fs.existsSync(gen) && fs.statSync(gen).mtimeMs > outM) stale.push('mcq/preview/build-preview.js');
    assertTrue(stale.length === 0,
      'mcq/preview/preview_mcq.html is stale — newer than it: ' + stale.join(', ') + '. Regenerate with `node mcq/preview/build-preview.js`.');
  }
});

cases.push({
  name: 'preflight: no stray parallel bundle directory (`working/`) — root is the single source of truth',
  fn() {
    // `working/` used to hold a hand-edited second copy of the shipped bundle.
    // It drifted away from root and was the #1 source of "where is the file"
    // confusion; it was removed in Phase 5. If a parallel copy ever reappears
    // here the gate must fail loudly instead of silently diverging.
    const wp = path.join(ROOT, 'working');
    assertTrue(!fs.existsSync(wp),
      'working/ exists — it is a stale duplicate bundle; the files at the repo root are the single source of truth. Delete working/.');
    const derived = { publish: 1, backups: 1, node_modules: 1 };
    const dirs = fs.readdirSync(ROOT).filter((n) => {
      if (derived[n]) return false;
      if (!fs.statSync(path.join(ROOT, n)).isDirectory()) return false;
      return ['Front.html', 'Back.html', '_hna_engine.js'].every((f) =>
        fs.existsSync(path.join(ROOT, n, f)));
    });
    assertTrue(dirs.length === 0,
      'parallel bundle directories hold a second copy of the shipped files: ' + dirs.join(', ') +
      ' — remove them; the repo root is the single source of truth.');
  }
});

/* ────────────────────────────────────────────────────────────
   MCQ note type (mcq/ dir) — first-class production checks.
   The MCQ type is a sibling note produced alongside the main HNA
   type; since the 2026-09-17 Phase 3 pass it ships "safety backdoor"
   progressive enhancement (raw answer divs remain readable if JS
   never renders) and shares the same pre-flight, preview-freshness,
   staging and publish gates as the main bundle.
   ──────────────────────────────────────────────────────────── */
const MCQ_SHIPPED_FILES = ['mcq/Front.html', 'mcq/Back.html', 'mcq/_mcq_styles.css',
  'mcq/_mcq_storage.js', 'mcq/_mcq_engine.js', 'mcq/_mcq_logic.js', 'mcq/_mcq_aurora.js'];
const MCQ_JS_FILES = ['mcq/_mcq_storage.js', 'mcq/_mcq_engine.js', 'mcq/_mcq_logic.js', 'mcq/_mcq_aurora.js'];

cases.push({
  name: 'preflight (mcq): shipped files present',
  fn() {
    MCQ_SHIPPED_FILES.forEach((n) => {
      if (!fs.existsSync(path.join(ROOT, n))) throw new Error('missing ' + n);
    });
    ['_Inter.ttf', '_JetBrainsMono.ttf'].forEach((f) => {
      if (!fs.existsSync(path.join(ROOT, 'mcq', f))) throw new Error('missing mcq/' + f);
    });
  }
});

cases.push({
  name: 'preflight (mcq): font copies are byte-identical to the root fonts (single media source of truth)',
  fn() {
    ['_Inter.ttf', '_JetBrainsMono.ttf'].forEach((f) => {
      const root = fs.readFileSync(path.join(ROOT, f));
      const mcq = fs.readFileSync(path.join(ROOT, 'mcq', f));
      assertTrue(root.equals(mcq),
        'mcq/' + f + ' diverged from ' + f + ' — both note types must ship the identical font');
    });
  }
});

cases.push({
  name: 'preflight: npm lockfile contract — package-lock.json tracks package.json so `npm ci` is reproducible',
  fn() {
    // The test harness (jsdom) is the only runtime dependency. A fresh clone
    // must be installable with `npm ci` (lockfileVersion >= 2) and the lock
    // must actually pin every dependency that package.json declares.
    const pj = path.join(ROOT, 'package.json');
    const pl = path.join(ROOT, 'package-lock.json');
    assertTrue(fs.existsSync(pj), 'package.json missing');
    assertTrue(fs.existsSync(pl),
      'package-lock.json missing — run `npm install` once and commit the lockfile');

    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assertTrue((lock.lockfileVersion || 0) >= 2,
      'package-lock.json lockfileVersion must be >= 2 (required by `npm ci`)');

    const want = {};
    Object.keys(pkg.dependencies || {}).forEach((k) => { want[k] = 1; });
    Object.keys(pkg.devDependencies || {}).forEach((k) => { want[k] = 1; });

    const rootEntry = lock.packages && lock.packages[''];
    const have = {};
    Object.keys((rootEntry && rootEntry.dependencies) || {}).forEach((k) => { have[k] = 1; });
    Object.keys((rootEntry && rootEntry.devDependencies) || {}).forEach((k) => { have[k] = 1; });

    const missing = Object.keys(want).filter((k) => !have[k]);
    assertTrue(missing.length === 0,
      'package-lock.json does not cover: ' + missing.join(', ') + '. Run `npm install --package-lock-only` and commit.');

    const entries = Object.keys(lock.packages || {});
    // jsdom 30's own dependency tree (verified against the committed lock):
    ['node_modules/jsdom', 'node_modules/whatwg-url', 'node_modules/parse5',
      'node_modules/symbol-tree', 'node_modules/saxes', 'node_modules/tough-cookie'].forEach((p) => {
      assertTrue(entries.indexOf(p) !== -1,
        'lockfile must pin ' + p + ' (jsdom dependency tree) — regenerate with `npm install`');
    });
  }
});

cases.push({
  name: 'preflight (mcq): JS is ES5-compatible (no =>, const, let, template literals, class, fill)',
  fn() {
    const bad = [];
    const patterns = [
      ['arrow', '=>'],
      ['const ', '\\bconst\\s+'],
      ['let ', '\\blet\\s+'],
      ['template-literal', '`'],
      ['class ', '\\bclass\\s+'],
      ['.fill(', '\\.fill\\('],
      ['spread', '\\.\\.\\.'],
      ['default-param', '=\\s*\\{[^}]*\\s*=\\s*\\}|function\\s*[A-Za-z0-9_]*\\s*\\([^)]*=\\s*[^)]*\\)']
    ];
    for (const f of MCQ_JS_FILES) {
      const src = stripComments(read(f));
      for (const [label, re] of patterns) {
        let m;
        const r = new RegExp(re, 'g');
        while ((m = r.exec(src)) !== null) bad.push(f + ': ' + label + ' @' + m.index);
      }
    }
    if (bad.length) throw new Error('mcq ES5 violations:\n  ' + bad.join('\n  '));
  }
});

cases.push({
  name: 'preflight (mcq): script load order is storage -> engine -> logic -> aurora (each exactly once)',
  fn() {
    ['mcq/Front.html', 'mcq/Back.html'].forEach((tpl) => {
      const srcs = scriptSrcs(read(tpl));
      const expected = ['_mcq_storage.js', '_mcq_engine.js', '_mcq_logic.js', '_mcq_aurora.js'];
      if (srcs.join('|') !== expected.join('|')) {
        throw new Error(tpl + ': script order/selection mismatch — ' + srcs.join(', '));
      }
      const inline = read(tpl).replace(/<!--[\s\S]*?-->/g, '');
      if (!/AnkiMCQ\.initFront|AnkiMCQ\.initBack/.test(inline)) {
        throw new Error(tpl + ': interactive init call missing after the script tags');
      }
    });
  }
});

cases.push({
  name: 'preflight (mcq): motion contract — no infinite, no will-change, no transition of filter, no filter in keyframes',
  fn() {
    const css = stripComments(read('mcq/_mcq_styles.css'));
    if (/\binfinite\b/.test(css)) throw new Error('"infinite" animation found');
    if (/will-change/.test(css)) throw new Error('"will-change" found');
    if (/transition[^;{]*filter/.test(css)) throw new Error('filter in a transition (layer churn)');
    const keyframes = css.match(/@keyframes\s+[^{]+\{[\s\S]*?\}\s*\}/g) || [];
    for (const kf of keyframes) {
      if (/filter\s*:/.test(kf)) throw new Error('keyframes must never animate filter: ' + kf.slice(0, 160));
    }
  }
});

cases.push({
  name: 'preflight (mcq): progressive-enhancement safety-backdoor contract',
  fn() {
    // The raw answer divs ARE the static fallback: they must carry no inline
    // display:none (the stylesheet owns the hiding), so they render whenever
    // html.mcq-ready is absent. The stylesheet hides them by default, reveals
    // them on html:not(.mcq-ready), and marks the correct slot on the back
    // face. _mcq_logic.js must add the marker only after a successful render.
    ['mcq/Front.html', 'mcq/Back.html'].forEach((tpl) => {
      const src = stripHtmlComments(read(tpl));
      if (/<div\s+id="mcq-raw-data"[^>]*style=/.test(src)) throw new Error(tpl + ': #mcq-raw-data carries an inline style (hiding must live in the stylesheet)');
      if (/class="mcq-raw-ans"[^>]*style=/.test(src)) throw new Error(tpl + ': .mcq-raw-ans carries an inline style (hiding must live in the stylesheet)');
      if (/<div\s+id="mcq-question-raw"[^>]*style=/.test(src)) throw new Error(tpl + ': #mcq-question-raw carries an inline style (hiding must live in the stylesheet)');
      if (!/class="mcq-raw-ans"[^>]+data-correct="true"/.test(src)) throw new Error(tpl + ': raw correct-answer slot missing');
    });
    const css = stripComments(read('mcq/_mcq_styles.css'));
    if (!/#mcq-question-raw\{display:none\}/.test(css)) throw new Error('mcq css: #mcq-question-raw must be hidden by the stylesheet');
    if (!/\.mcq-raw-ans\{display:none\}/.test(css)) throw new Error('mcq css: .mcq-raw-ans must be hidden by the stylesheet');
    if (!/html:not\(\.mcq-ready\)/.test(css)) throw new Error('mcq css: fallback reveal rule grounded on html:not(.mcq-ready) missing');
    if (!/\.card-front \.mcq-raw-ans/.test(css)) throw new Error('mcq css: front-face fallback rule missing');
    if (!/\.card-back \.mcq-raw-ans\[data-correct="true"\]/.test(css)) throw new Error('mcq css: back-face correct-slot marker rule missing');
    const js = stripComments(read('mcq/_mcq_logic.js'));
    if (!/classList\.add\(['"]mcq-ready['"]\)/.test(js)) throw new Error('mcq js: _mcq_logic.js must add html.mcq-ready after a successful interactive render');
  }
});

cases.push({
  name: 'preflight (mcq): no TODO/FIXME/HACK markers remain in shipped mcq files',
  fn() {
    const hits = [];
    const re = /\b(?:TODO|FIXME|HACK)\b/g;
    MCQ_SHIPPED_FILES.forEach((f) => {
      const src = read(f);
      let m;
      while ((m = re.exec(src)) !== null) hits.push(f + ': ' + m[0] + ' @' + m.index);
    });
    if (hits.length) throw new Error('stray markers in shipped mcq files:\n  ' + hits.join('\n  '));
  }
});

cases.push({
  name: 'preflight (mcq): mcq/preview/preview_mcq.html is not older than the working mcq sources',
  fn() {
    // The human-review gate must reflect the current mcq bundle.
    // mcq/preview/build-preview.js skips regeneration when the artifact is
    // already newer than every input; this test fails when a source has been
    // touched since the last build.
    const out = path.join(ROOT, 'mcq', 'preview', 'preview_mcq.html');
    assertTrue(fs.existsSync(out),
      'mcq/preview/preview_mcq.html missing — run `node mcq/preview/build-preview.js` to regenerate');
    const outM = fs.statSync(out).mtimeMs;
    const stale = [];
    MCQ_SHIPPED_FILES.forEach((n) => {
      const p = path.join(ROOT, n);
      if (fs.existsSync(p) && fs.statSync(p).mtimeMs > outM) stale.push(n);
    });
    const gen = path.join(ROOT, 'mcq', 'preview', 'build-preview.js');
    if (fs.existsSync(gen) && fs.statSync(gen).mtimeMs > outM) stale.push('mcq/preview/build-preview.js');
    assertTrue(stale.length === 0,
      'mcq/preview/preview_mcq.html is stale — newer than it: ' + stale.join(', ') +
      '. Regenerate with `node mcq/preview/build-preview.js`.');
  }
});

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg);
}

module.exports = cases;
