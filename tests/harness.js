'use strict';
/* HNA test harness: jsdom environment that mimics Anki's webview.
   - #qa innerHTML swap (card flip) with re-evaluation of the 5 modules
   - controllable setTimeout/requestAnimationFrame queues (deterministic)
   - document/window listener registry (leak counting)
   - stubs: ResizeObserver, AudioContext (with creation counter)
   - mini-mustache renderer for the Anki templates
   - diff-module instrumentation to expose internals for unit tests */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ROOT must NOT be captured at module load: run-all.js may set
// process.env.HNA_ROOT (--publish stages a bundle and re-runs the buckets
// against it) AFTER this module was first required — the require cache keeps
// the module around, so a load-time const would pin the source root and the
// staged run would silently read the working files. Resolve at access time.
function getRoot() {
  return process.env.HNA_ROOT || path.resolve(__dirname, '..');
}

const readFile = (name) => fs.readFileSync(path.join(getRoot(), name), 'utf8');

// Flush failures used to be swallowed (`try { fn(); } catch (e) {}`) so a
// timer/rAF callback that threw in a flip was invisible to the test that
// triggered it. Run every callback (collect all errors), then throw one
// aggregated error so the failure surfaces in the case that did the flush.
function reportFlushErrors(kind, errs) {
  if (errs.length === 0) return;
  const e = new Error(kind + ' threw inside ' + errs.length + ' callback(s): ' +
    errs.map((x) => (x && (x.stack || x.message)) || String(x)).join('\n  | '));
  e.callbackErrors = errs;
  throw e;
}

const MODULE_NAMES = [
  '_hna_storage.js',
  '_hna_engine.js',
  '_hna_diff.js',
  '_hna_typing.js',
  '_hna_aurora.js'
];

/* ------------------------------------------------------------
   Mini-mustache: {{#section}}...{{/section}} + {{field}}.
   {{type:word}} becomes Anki's center-wrapped input.
------------------------------------------------------------ */
function render(tpl, data) {
  tpl = tpl.replace(/\{\{type:word\}\}/g, '<center><input type="text" id="typeans" value=""></center>');
  let prev;
  do {
    prev = tpl;
    tpl = tpl.replace(/\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, k, inner) => {
      const v = data[k];
      return (v !== undefined && v !== null && v !== '') ? render(inner, data) : '';
    });
  } while (tpl !== prev);
  tpl = tpl.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k) => (data[k] !== undefined ? String(data[k]) : ''));
  return tpl;
}

const SAMPLE = {
  word: 'katt',
  meaning: 'katt — ett vanligt svenskt husdjur',
  pos: 'substantiv',
  transliteration: 'kat',
  example: 'Katten sover på soffan.',
  example_translated: 'The cat is sleeping on the sofa.',
  explain: 'Ett av de vanligaste husdjuren i Sverige.',
  forms: 'katt, katten, katter, katterna',
  synonym: 'kisse, kattdjur',
  antonym: 'hund',
  tag_1: 'djur', tag_2: 'husdjur', tag_3: '', tag_4: '',
  Tags: '',
  ID: '42',
  image: '',
  audio_word: '', audio_meaning: '', audio_example: ''
};

function frontCard(data) {
  return render(readFile('Front.html'), data || SAMPLE);
}
function backCard(data) {
  return render(readFile('Back.html'), data || SAMPLE);
}

/* ------------------------------------------------------------
   Environment
------------------------------------------------------------ */
function createEnv(initialCardHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="qa">' +
    (initialCardHtml || '') + '</div></body></html>',
    {
      url: 'http://localhost/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      beforeParse(win) {
        win.console = console;

        let tId = 1;
        const timers = new Map();
        win.setTimeout = (fn, ms) => { const id = tId++; timers.set(id, fn); return id; };
        win.clearTimeout = (id) => { timers.delete(id); };
        win.setInterval = (fn, ms) => { const id = tId++; timers.set(id, fn); return id; };
        win.clearInterval = (id) => { timers.delete(id); };
        win.__flushTimers = () => {
          const fns = Array.from(timers.values());
          timers.clear();
          const errs = [];
          fns.forEach((fn) => { try { fn(); } catch (e) { errs.push(e); } });
          reportFlushErrors('timer flush', errs);
        };
        win.__pendingTimerCount = () => timers.size;

        let rId = 1;
        const rafs = new Map();
        win.requestAnimationFrame = (fn) => { const id = rId++; rafs.set(id, fn); return id; };
        win.cancelAnimationFrame = (id) => { rafs.delete(id); };
        win.__flushRAF = () => {
          const errs = [];
          for (let i = 0; i < 30; i++) {
            if (rafs.size === 0) break;
            const fns = Array.from(rafs.values());
            rafs.clear();
            fns.forEach((fn) => { try { fn(); } catch (e) { errs.push(e); } });
          }
          reportFlushErrors('rAF flush', errs);
        };
        win.__pendingRAFCount = () => rafs.size;

        win.ResizeObserver = class {
          constructor(cb) { this.cb = cb; this.observed = []; }
          observe(el) { this.observed.push(el); }
          unobserve() {}
          disconnect() { this.observed = []; }
        };

        win.__audioCtxCount = 0;
        win.AudioContext = class {
          constructor() {
            this.state = 'suspended';
            this.currentTime = 0;
            this.destination = {};
            win.__audioCtxCount++;
          }
          resume() { this.state = 'running'; }
          createOscillator() {
            return {
              type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
              start() {}, stop() {}, connect() {}, disconnect() {}, onended: null
            };
          }
          createGain() {
            return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
          }
        };
        win.webkitAudioContext = win.AudioContext;
      }
    }
  );

  return new Promise((resolve) => {
    const finish = () => {
      const win = dom.window;
      const registry = [];

      const wrapListenerApi = (target, tag) => {
        const origAdd = target.addEventListener;
        const origRemove = target.removeEventListener;
        target.addEventListener = function (type, fn, capture) {
          registry.push({ tag, type, fn });
          return origAdd.call(target, type, fn, capture);
        };
        target.removeEventListener = function (type, fn, capture) {
          for (let i = registry.length - 1; i >= 0; i--) {
            if (registry[i].tag === tag && registry[i].type === type && registry[i].fn === fn) registry.splice(i, 1);
          }
          return origRemove.call(target, type, fn, capture);
        };
      };

      wrapListenerApi(win.document, 'document');
      wrapListenerApi(win, 'window');

      win.__listenerCount = (tag) => registry.filter((l) => l.tag === tag).length;
      win.__listenerBreakdown = () => {
        const out = {};
        registry.forEach((l) => { out[l.tag + ':' + l.type] = (out[l.tag + ':' + l.type] || 0) + 1; });
        return out;
      };

      win.__ev = (tag, type) => {
        const m = registry.find((l) => l.tag === tag && l.type === type);
        return m ? m.fn : null;
      };

      resolve({ dom, win });
    };

    if (dom.window.document.readyState === 'complete') finish();
    else dom.window.addEventListener('load', finish);
  });
}

/* Instrument _hna_diff.js to expose its internal algorithm for unit tests.
   This rewrites only the in-memory copy; the shipped file is untouched. */
function instrumentDiff(src) {
  const idx = src.lastIndexOf('})();');
  if (idx === -1) throw new Error('cannot instrument _hna_diff.js');
  const exportStmt = 'window.__hnaDiffInternals = {' +
    'levenshteinDistance: levenshteinDistance,' +
    'levenshteinDiff: levenshteinDiff,' +
    'computeDiff: computeDiff,' +
    'computeVerdict: computeVerdict };';
  return src.slice(0, idx) + exportStmt + src.slice(idx);
}

function evalModules(win, opts) {
  MODULE_NAMES.forEach((name) => {
    let src = readFile(name);
    if (opts && opts.instrumentDiff && name === '_hna_diff.js') src = instrumentDiff(src);
    win.eval(src);
  });
}

/* Simulate one card flip: replace #qa innerHTML, re-evaluate modules,
   flush queued timers and animation frames. */
function flip(win, cardHtml, opts) {
  const qa = win.document.getElementById('qa');
  qa.innerHTML = cardHtml;
  evalModules(win, opts);
  win.__flushTimers();
  win.__flushRAF();
}

/* Type into the (front) answer input, dispatch input, flush rAF. */
function typeInto(win, text) {
  const input = win.document.getElementById('typeans');
  input.value = text;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  win.__flushRAF();
}

function overlayStats(win) {
  const overlay = win.document.getElementById('typeans-overlay');
  const q = (sel) => (overlay ? overlay.querySelectorAll(sel).length : 0);
  return {
    // Per-character verdicts (realtime checker): every typed position is
    // judged immediately (case-insensitive) and painted green/red on the spot.
    correct: q('span.char-correct'),
    wrong: q('span.char-wrong'),
    correctSpace: q('span.char-correct-space'),
    wrongSpace: q('span.char-wrong-space'),
    extra: q('span.char-extra'),
    wordExtra: q('span.word-group.word-extra'),
    placeholder: q('span.char-placeholder'),
    wordTotal: q('span.word-group'),
    all: q('span[class^="char-"]')
  };
}

module.exports = {
  // ROOT as an accessor so callers read the CURRENT root (see getRoot above);
  // the historical property name is kept for backward compatibility.
  get ROOT() { return getRoot(); },
  getRoot, readFile, render, SAMPLE,
  frontCard, backCard, createEnv, evalModules, flip, typeInto, overlayStats
};
