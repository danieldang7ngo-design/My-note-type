'use strict';
/* Unit tests for the typing overlay (_hna_typing.js): initialization,
   live positional feedback, hint completion, persistence, shortcuts. */

const assert = require('assert');
const { createEnv, evalModules, frontCard, backCard, flip, typeInto, overlayStats, SAMPLE } = require('../harness');

let env = null;
let win = null;

const cases = [];

cases.push({
  name: 'typing: env prepared',
  async: true,
  fn: async () => {
    env = await createEnv();
    win = env.win;
    evalModules(win);
  }
});

cases.push({
  name: 'typing: front card builds the overlay with placeholder spans for the answer',
  fn: () => {
    flip(win, frontCard());
    const input = win.document.getElementById('typeans');
    assert.ok(input, 'typeans input missing');
    assert.ok(win.document.getElementById('typeans-overlay'), 'overlay missing');
    const stats = overlayStats(win);
    assert.strictEqual(stats.placeholder, 4, 'expected 4 placeholder chars for katt, got ' + stats.placeholder);
  }
});

cases.push({
  name: 'typing: center wrapper is unwrapped and the input made invisible-but-active',
  fn: () => {
    const input = win.document.getElementById('typeans');
    assert.ok(input.parentElement.className.indexOf('type-input-wrapper') !== -1, 'input must live directly in .type-input-wrapper');
    assert.strictEqual(input.style.position, 'absolute');
    assert.strictEqual(input.style.opacity, '0');
    assert.strictEqual(input.style.pointerEvents, 'auto');
    assert.strictEqual(input.style.zIndex, '1');
    assert.strictEqual(input.getAttribute('autocapitalize'), 'off');
    assert.strictEqual(input.getAttribute('spellcheck'), 'false');
  }
});

cases.push({
  name: 'typing: a fully correct word is painted green per character',
  fn: () => {
    typeInto(win, 'katt');
    const stats = overlayStats(win);
    assert.strictEqual(stats.correct, 4, 'the single word must be 4 .char-correct spans');
    assert.strictEqual(stats.wrong, 0);
    assert.strictEqual(stats.extra, 0);
    assert.strictEqual(stats.placeholder, 0);
    assert.strictEqual(stats.all, 4);
  }
});

cases.push({
  name: 'typing: a typed letter that misses the mark is red on the spot, the rest stay green',
  fn: () => {
    typeInto(win, 'kant');
    const stats = overlayStats(win);
    assert.strictEqual(stats.wrong, 1, 'the misplaced \'n\' must be the only .char-wrong');
    assert.strictEqual(stats.correct, 3, '"kat" align and stay green');
    assert.strictEqual(stats.all, 4);
  }
});

cases.push({
  name: 'typing: a partial word is judged as it lands — no premature placeholders stay wrong',
  fn: () => {
    typeInto(win, 'ka');
    const stats = overlayStats(win);
    assert.strictEqual(stats.correct, 2, 'the two typed letters are green immediately');
    assert.strictEqual(stats.wrong, 0);
    assert.strictEqual(stats.placeholder, 2, 'the untyped letters still show as placeholders');
  }
});

cases.push({
  name: 'typing: comparing characters is case-insensitive like the Back-face diff',
  fn: () => {
    typeInto(win, 'KATT');
    const stats = overlayStats(win);
    assert.strictEqual(stats.correct, 4, 'uppercase must pass the per-char comparison');
    assert.strictEqual(stats.wrong, 0);
  }
});

cases.push({
  name: 'typing: extra typed letters collect as one word-extra group',
  fn: () => {
    typeInto(win, 'kattx');
    const stats = overlayStats(win);
    assert.strictEqual(stats.extra, 1);
    assert.strictEqual(stats.all, 5);
    assert.strictEqual(stats.wordExtra, 1, 'past-the-answer chars must form one .word-extra unit');
  }
});

cases.push({
  name: 'typing: removing the extra letter shrinks the overlay back (BUG-004 keepLen regression)',
  fn: () => {
    typeInto(win, 'katt');
    const stats = overlayStats(win);
    assert.strictEqual(stats.extra, 0);
    assert.strictEqual(stats.wordExtra, 0, 'the .word-extra group must be removed when it empties');
    assert.strictEqual(stats.all, 4);
  }
});

cases.push({
  name: 'typing: spaces are preserved as one unit each and judged as separators',
  fn: () => {
    typeInto(win, 'ett katt');
    const stats = overlayStats(win);
    assert.strictEqual(stats.all, 8, 'every typed char incl. the space gets a span');
    assert.strictEqual(stats.extra, 4, 'the 4 chars past the answer are extras');
    assert.strictEqual(stats.correct, 1, '"t" (slot 2) is the only aligned letter');
    assert.strictEqual(stats.wrong, 2, '"e" and "t" misalign against "ka"');
    assert.strictEqual(stats.wrongSpace, 1, 'the typed space lands on a letter slot -> wrong separator');
  }
});

cases.push({
  name: 'typing: phrase — typed letters are judged per character across all words',
  fn: () => {
    const phrase = Object.assign({}, SAMPLE, { word: 'en blå fågel' });
    flip(win, frontCard(phrase));
    typeInto(win, 'en blå');
    const stats = overlayStats(win);
    assert.strictEqual(stats.correct, 5, '"en blå" letters all align');
    assert.strictEqual(stats.correctSpace, 1, 'the separator between "en" and "blå" correct');
    assert.strictEqual(stats.wrong, 0);
    assert.strictEqual(stats.placeholder, 5, '"fågel" (5 letters) is not reached yet');
    assert.strictEqual(stats.correct + stats.correctSpace, 6, 'every typed char incl. the separator gets a verdict span (positional 1:1)');
    assert.strictEqual(stats.all, 12, '6 typed verdict spans + 6 untouched placeholders');
  }
});

cases.push({
  name: 'typing: phrase — a wrong letter is marked red even mid-word',
  fn: () => {
    const phrase = Object.assign({}, SAMPLE, { word: 'en blå fågel' });
    flip(win, frontCard(phrase));
    typeInto(win, 'en baa');
    const stats = overlayStats(win);
    assert.strictEqual(stats.correct, 3, '"en b" keep aligning');
    assert.strictEqual(stats.correctSpace, 1);
    assert.strictEqual(stats.wrong, 2, '"aa" fails against "lå"');
    assert.strictEqual(stats.placeholder, 5, '"fågel" is untouched');
    assert.strictEqual(stats.correct + stats.correctSpace + stats.wrong, 6);
  }
});

cases.push({
  name: 'typing: buffer is synchronous, transient storage persists on debounce flush',
  fn: () => {
    typeInto(win, 'katt');
    assert.strictEqual(win.__hnaTypedAnswerBuffer, 'katt', 'buffer must be written synchronously');
    assert.notStrictEqual(win.safeGetTransient(win.STORAGE_KEYS.TYPED_ANSWER), 'katt',
      'storage is trailing-debounced and must NOT be written before the timer fires');
    win.__flushTimers();
    assert.strictEqual(win.safeGetTransient(win.STORAGE_KEYS.TYPED_ANSWER), 'katt', 'flush must persist the transient value');
    assert.strictEqual(win.localStorage.getItem(win.STORAGE_KEYS.TYPED_ANSWER), null, 'learner answer must not become durable');
  }
});

cases.push({
  name: 'typing: back face does not build the typing overlay',
  fn: () => {
    flip(win, backCard());
    assert.strictEqual(win.document.getElementById('typeans-overlay'), null);
    assert.strictEqual(win.document.querySelector('input#typeans'), null);
  }
});

cases.push({
  name: 'typing: shortcut Alt+S opens the settings menu, Escape closes it',
  fn: () => {
    flip(win, frontCard());
    const menu = win.document.getElementById('settingsMenu');
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', altKey: true, bubbles: true }));
    assert.strictEqual(menu.classList.contains('active'), true, 'menu should be open after Alt+S');
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(menu.classList.contains('active'), false, 'Escape should close the menu');
  }
});

cases.push({
  name: 'typing: shortcut Alt+D toggles night mode',
  fn: () => {
    const before = win.AnkiEngine.config.nightMode;
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true }));
    assert.strictEqual(win.AnkiEngine.config.nightMode, !before);
    win.AnkiEngine.toggleConfig('nightMode');
    assert.strictEqual(win.AnkiEngine.config.nightMode, before);
  }
});

cases.push({
  name: 'typing: shortcut Ctrl+J focuses the answer input and only preventDefaults when the target exists',
  fn: () => {
    flip(win, frontCard());
    const input = win.document.getElementById('typeans');
    win.document.getElementById('btnSettings').focus();
    assert.notStrictEqual(win.document.activeElement, input, 'precondition: typeans must not be focused yet');
    const evt = new win.KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true });
    win.document.dispatchEvent(evt);
    assert.strictEqual(win.document.activeElement, input, 'Ctrl+J must focus the typeans input');
    assert.strictEqual(evt.defaultPrevented, true, 'Ctrl+J with a live target must be preventDefaulted');

    // Back face: #typeans does not exist, so the engine must NOT swallow the
    // key (preventDefault only fires inside the action branch — Ctrl+J must
    // fall through to Anki's own shortcuts).
    flip(win, backCard());
    const evtBack = new win.KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true });
    win.document.dispatchEvent(evtBack);
    assert.strictEqual(evtBack.defaultPrevented, false,
      'Ctrl+J on the Back face (no #typeans) must not be preventDefaulted');
  }
});

cases.push({
  name: 'typing: card-type selector removed — meaning cue card is the only one and stays visible',
  fn: () => {
    assert.strictEqual(win.document.querySelectorAll('.card-type-btn').length, 0, 'no card-type buttons may exist');
    flip(win, frontCard());
    assert.strictEqual(win.document.querySelectorAll('.card-type-btn').length, 0, 'still no card-type buttons after flip');
    const cues = win.document.querySelectorAll('.cue-card');
    assert.strictEqual(cues.length, 1, 'exactly one cue card (meaning)');
    assert.ok(cues[0].classList.contains('cue-card--meaning'), 'cue card must be the meaning one');
    assert.strictEqual(cues[0].style.display, '', 'meaning cue card must be visible');
  }
});

cases.push({
  name: 'typing: ArrowLeft/Home/End re-sync the overlay caret to selectionStart',
  fn: () => {
    flip(win, frontCard());
    typeInto(win, 'katt');
    const input = win.document.getElementById('typeans');
    const overlay = win.document.getElementById('typeans-overlay');
    const cursorIndex = () => {
      const spans = overlay.querySelectorAll('span[class^="char-"]');
      const cursor = overlay.querySelector('.active-cursor');
      return cursor ? Array.prototype.indexOf.call(spans, cursor) : -1;
    };

    // jsdom never moves the caret on arrow keys, so the selectionStart we set
    // is the position the key WOULD have produced in a real webview.
    input.selectionStart = 3;
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    win.__flushRAF();
    assert.strictEqual(cursorIndex(), 3, 'ArrowLeft must re-sync the caret to selectionStart');

    input.selectionStart = 0;
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    win.__flushRAF();
    assert.strictEqual(cursorIndex(), 0, 'Home must re-sync the caret to selectionStart');

    input.value = 'ka';
    input.selectionStart = 2;
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    win.__flushRAF();
    assert.strictEqual(cursorIndex(), 2, 'End must re-sync the caret to the end-of-typed position (next placeholder)');
  }
});

cases.push({
  name: 'typing: Enter blurs the input',
  fn: () => {
    flip(win, frontCard());
    const input = win.document.getElementById('typeans');
    input.focus();
    assert.strictEqual(win.document.activeElement, input, 'precondition: typeans must be focused');
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.notStrictEqual(win.document.activeElement, input, 'Enter must blur the typeans input');
  }
});

cases.push({
  name: 'typing: repeated identical input+keyup writes storage only once after flush',
  fn: () => {
    flip(win, frontCard());
    const input = win.document.getElementById('typeans');
    const origSafeSetTransient = win.safeSetTransient;
    let storageWrites = 0;
    win.safeSetTransient = function (k, v) {
      if (k === win.STORAGE_KEYS.TYPED_ANSWER) storageWrites++;
      return origSafeSetTransient.call(this, k, v);
    };
    try {
      input.value = 'katt';
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      input.dispatchEvent(new win.Event('keyup', { bubbles: true }));
      win.__flushTimers();
    } finally {
      win.safeSetTransient = origSafeSetTransient;
    }
    assert.strictEqual(storageWrites, 1,
      'one physical keystroke fires input+keyup; the dedupe must persist the typed answer once, got ' + storageWrites);
    assert.strictEqual(win.safeGetTransient(win.STORAGE_KEYS.TYPED_ANSWER), 'katt', 'flush must persist the transient value');
    assert.strictEqual(win.localStorage.getItem(win.STORAGE_KEYS.TYPED_ANSWER), null, 'typed answer must not persist durably');
  }
});

cases.push({
  name: 'typing: BUG-030 — when the property-escape RegExp constructor throws (old QtWebEngine), the ASCII fallback still letters ASCII + À-ɏ chars and degrades Cyrillic to a punctuation hint',
  fn: () => {
    // Simulate an engine that predates Unicode property escapes (Chromium < 64):
    // make `new RegExp('[\\p{L}\\p{N}]', 'u')` throw inside the module's
    // try/catch, so PLACEHOLDER_LETTER_RE falls back to null and
    // getPlaceholderState must use the ASCII `[a-zA-Z0-9À-ɏ]` branch.
    const RealRegExp = win.RegExp;
    function NoPropertyEscapes(pattern, flags) {
      if (typeof pattern === 'string' && pattern.indexOf('\\p{') !== -1 && flags && flags.indexOf('u') !== -1) {
        throw new SyntaxError('\\p{...} is not supported on this engine');
      }
      return new RealRegExp(pattern, flags);
    }
    NoPropertyEscapes.prototype = RealRegExp.prototype;
    win.RegExp = NoPropertyEscapes;
    try {
      // 'café' + Cyrillic 'я': é (U+00E9) is inside the ASCII fallback range
      // À-ɏ and must still get an underscore placeholder; я (U+044F) is a
      // \p{L} letter NOT reachable by the fallback, so it degrades to the
      // visible punctuation-hint rather than vanishing.
      flip(win, frontCard(Object.assign({}, SAMPLE, { word: 'caféя' })));
      const stats = overlayStats(win);
      assert.strictEqual(stats.placeholder, 4,
        'ASCII fallback must still map ASCII + À-ɏ letters to placeholder spans; got ' + stats.placeholder);
      assert.strictEqual(stats.all, 5,
        'the Cyrillic letter must render as a visible hint span, not be dropped; got ' + stats.all);
      assert.strictEqual(stats.all - stats.placeholder, 1,
        'exactly the Cyrillic char must fall to the punctuation hint');
    } finally {
      win.RegExp = RealRegExp;
      flip(win, frontCard()); // rebuild the overlay on the modern regex path for the rest of the suite
    }
  }
});

module.exports = cases;
