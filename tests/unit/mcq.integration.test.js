'use strict';
/* MCQ integration tests — the progressive-enhancement safety backdoor.
   Phase 3 contract under test:
     1. The interactive option grid is built from the raw answer divs, and
        html.mcq-ready is added to the document element ONLY AFTER that grid
        has rendered (a card is never left with zero answer options).
     2. shuffleChoices=false preserves template order; shuffle (default) is a
        permutation of the same set.
     3. Choosing an option stores the state (sig, shuffled order, index) and
        flips to Anki via pycmd('ans'); the back face re-renders the stored
        order and flags the chosen slot / plays the matching tone.
     4. The back with no state shows a neutral banner (no verdict leak) and
        still marks ready.
     5. Empty raw options keep the marker OFF so the static fallback stays.
     6. destroyFront removes the logic module's keydown listener.

   These run the REAL anki-browser script bundle (storage/engine/logic) inside
   a jsdom Window wrapped in its own vm context — zero Node-global pollution,
   fully hermetic per case.
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { minifyCss } = require('../minify-css');

const ROOT = process.env.HNA_ROOT || path.resolve(__dirname, '..', '..');
const MCQ_DIR = path.join(ROOT, 'mcq');
const MODULE_ORDER = ['_mcq_storage.js', '_mcq_engine.js', '_mcq_logic.js'];

const RAW_ANSWERS = [
  { text: 'katt', correct: true },
  { text: 'hund', correct: false },
  { text: 'fisk', correct: false },
  { text: 'fågel', correct: false }
];

function baseHtml(face, answers) {
  const list = answers || RAW_ANSWERS;
  const raws = list.map((a) =>
    '<div class="mcq-raw-ans" data-correct="' + a.correct + '">' + a.text + '</div>'
  ).join('');
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="mcq-question-raw">Đâu là "katt"?</div>' +
    '<div class="card-wrapper"><div class="aurora-card card-' + face + '">' +
    '<div class="card-content">' +
    '<div id="mcq-options-container" class="mcq-option-grid"></div>' +
    '<div id="mcq-verdict-container"></div>' +
    '</div>' +
    '<div id="mcq-raw-data">' + raws + '</div>' +
    '</div></div>' +
    '<div id="settingsMenu"></div><button id="btnSettings"></button>' +
    '</body></html>';
}

function emptyRawHtml() {
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="mcq-options-container"></div><div id="mcq-verdict-container"></div>' +
    '<div id="mcq-raw-data">' +
    '<div class="mcq-raw-ans" data-correct="true"></div>' +
    '<div class="mcq-raw-ans" data-correct="false"></div>' +
    '</div></body></html>';
}

/* Hermetic environment: stub window timers/raf into a drained queue and run
   the real mcq modules inside a vm context bound to this jsdom Window. */
function makeEnv(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://anki.local/' });
  const win = dom.window;
  let seq = 0;
  const queue = [];
  const remove = (id) => {
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].id === id) { queue.splice(i, 1); return; }
    }
  };
  const stub = (name, wrapper) => {
    Object.defineProperty(win, name, {
      configurable: true,
      value: wrapper
    });
  };
  stub('setTimeout', function (fn) { queue.push({ id: ++seq, fn: fn }); return seq; });
  stub('clearTimeout', remove);
  stub('setInterval', function (fn) { queue.push({ id: ++seq, fn: fn }); return seq; });
  stub('clearInterval', remove);
  stub('requestAnimationFrame', function (fn) { queue.push({ id: ++seq, fn: function () { fn(Date.now()); } }); return seq; });
  stub('cancelAnimationFrame', remove);

  const env = {
    win: win,
    dom: dom,
    tones: [],
    flipArgs: [],
    __flush: function () {
      while (queue.length) queue.shift().fn();
    }
  };
  win.__flush = env.__flush;

  win.pycmd = function (arg) { env.flipArgs.push(arg); };
  win.AnkiAudio = win.AnkiAudio || {};
  win.AnkiAudio.playTone = function (type) { env.tones.push(type); };

  const ctx = vm.createContext(win);
  MODULE_ORDER.forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(MCQ_DIR, name), 'utf8'), ctx);
  });

  // Settle engine init (config load + raf-driven class toggling).
  env.__flush();
  return env;
}

function optionTexts(win) {
  const out = [];
  const btns = win.document.querySelectorAll('.mcq-option-btn');
  for (let i = 0; i < btns.length; i++) {
    const el = btns[i].querySelector('.option-content');
    out.push(el ? el.textContent : '');
  }
  return out;
}

function flipToBack(win) {
  const card = win.document.querySelector('.aurora-card');
  card.className = card.className.replace('card-front', 'card-back');
  win.AnkiMCQ.initBack();
}

function clickSlot(win, idx) {
  const btn = win.document.querySelectorAll('.mcq-option-btn')[idx];
  if (!btn) throw new Error('no option button at slot ' + idx);
  btn.click();
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEq') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

const cases = [];

cases.push({
  name: 'mcq integration: initFront builds the interactive grid and marks html.mcq-ready',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    assertTrue(win.document.documentElement.classList.contains('mcq-ready') === false,
      'precondition: marker must start OFF so the static fallback is visible');
    win.AnkiMCQ.initFront();
    win.__flush();
    assertEq(win.document.querySelectorAll('.mcq-option-btn').length, 4,
      'interactive grid must contain one button per raw option');
    assertTrue(win.document.documentElement.classList.contains('mcq-ready'),
      'html.mcq-ready must be added after the grid rendered');
    assertEq(win.document.querySelectorAll('.mcq-raw-ans').length, 4,
      'raw answer divs must stay in the DOM (they are the fallback source)');
  }
});

cases.push({
  name: 'mcq integration: shuffleChoices=false preserves the template order',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiMCQ.initFront();
    win.__flush();
    assertEq(optionTexts(win).join('|'), 'katt|hund|fisk|fågel',
      'with shuffle disabled the grid must mirror the raw template order');
    const correctSlot = win.document.querySelector('.mcq-option-btn[data-slot="0"]');
    assertTrue(!!correctSlot && correctSlot.textContent.indexOf('katt') !== -1,
      'correct option must stay at slot 0 (position A)');
    assertTrue(win.document.documentElement.classList.contains('mcq-ready'),
      'marker must still be set when the grid renders');
  }
});

cases.push({
  name: 'mcq integration: shuffleChoices=true yields a permutation, deterministic under Math.random=0',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    const realRandom = win.Math.random;
    win.Math.random = function () { return 0; };
    try {
      win.AnkiEngine.config.shuffleChoices = true;
      win.AnkiMCQ.initFront();
      win.__flush();
      assertEq(optionTexts(win).join('|'), 'hund|fisk|fågel|katt',
        'seeded shuffle must rotate the whole set (a permutation, not a drop)');
    } finally {
      win.Math.random = realRandom;
    }
    const texts = optionTexts(win);
    RAW_ANSWERS.forEach((a, i) => {
      assertTrue(texts.indexOf(a.text) !== -1, 'option set must contain "' + a.text + '" exactly once (got ' + texts.join(',') + ')');
    });
  }
});

cases.push({
  name: 'mcq integration: clicking an option stores state and flips to Anki via pycmd("ans")',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiMCQ.initFront();
    win.__flush();
    clickSlot(win, 1);
    win.__flush();
    const state = win.__hnaMCQState;
    assertTrue(!!state, 'selectAndFlip must persist the choice state');
    assertEq(state.chosenIndex, 1, 'chosen index must be recorded');
    assertEq(state.shuffledOrder.length, 4, 'shuffled order must match the grid');
    assertTrue(!!state.sig && state.sig.indexOf('katt') !== -1,
      'signature must derive from the rendered card fields');
    assertTrue(win.__hnaMCQAnswered === true, 'answered latch must be set (blocks double flips)');
    assertEq(env.flipArgs.join(','), 'ans', 'flip bridge must call pycmd("ans")');
    const stored = win.document.querySelectorAll('.mcq-option-btn.is-pressed').length;
    assertEq(stored, 1, 'the chosen slot must get the is-pressed visual cue');
  }
});

cases.push({
  name: 'mcq integration: back re-renders the stored shuffle and flags the chosen slot + verdict/tone',
  fn() {
    // Deterministic: Math.random=0 => order [hund, fisk, fågel, katt]; slot 1 (fisk) is WRONG.
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.Math.random = function () { return 0; };
    win.AnkiEngine.config.shuffleChoices = true;
    win.AnkiMCQ.initFront();
    win.__flush();
    clickSlot(win, 1);
    win.__flush();
    flipToBack(win);
    win.__flush();
    assertTrue(win.document.documentElement.classList.contains('mcq-ready'),
      'back must mark html.mcq-ready after rendering its (static) grid');
    assertEq(optionTexts(win).join('|'), 'hund|fisk|fågel|katt',
      'back must re-render the STORED shuffle order');
    const clicked = win.document.querySelectorAll('.mcq-option-btn.is-static')[1];
    assertTrue(!!clicked && clicked.classList.contains('is-wrong'),
      'the wrongly chosen slot must carry is-wrong');
    const verdict = win.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('wrong') !== -1,
      'verdict banner must be CHƯA CHÍNH XÁC for a wrong pick');
    assertEq(env.tones.join(','), 'wrong', 'wrong pick must play the wrong tone');
    const correct = win.document.querySelector('.mcq-option-btn.is-correct');
    assertTrue(!!correct && correct.textContent.indexOf('katt') !== -1,
      'the correct option must be flagged with is-correct');
  }
});

cases.push({
  name: 'mcq integration: back with a correct pick plays the correct tone and banner',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiMCQ.initFront();
    win.__flush();
    clickSlot(win, 0);
    win.__flush();
    flipToBack(win);
    win.__flush();
    const verdict = win.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('correct') !== -1,
      'verdict banner must be CHÍNH XÁC for a correct pick');
    assertEq(env.tones.join(','), 'correct', 'correct pick must play the correct tone');
    const clicked = win.document.querySelectorAll('.mcq-option-btn.is-static')[0];
    assertTrue(!!clicked && clicked.classList.contains('is-correct'),
      'the chosen correct slot must carry is-correct');
  }
});

cases.push({
  name: 'mcq integration: back with no stored state renders a neutral verdict and still marks ready',
  fn() {
    const env = makeEnv(baseHtml('back'));
    const win = env.win;
    win.AnkiMCQ.initBack();
    win.__flush();
    const verdict = win.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('neutral') !== -1,
      'no-state back must show the neutral banner (no correct/wrong verdict leak)');
    assertEq(env.tones.length, 0, 'no state means no verdict tone');
    assertTrue(win.document.documentElement.classList.contains('mcq-ready'),
      'back must still mark ready so the static fallback hides behind the grid');
    assertEq(win.document.querySelectorAll('.mcq-option-btn.is-static').length, 4,
      'back must render a static grid of all raw options');
  }
});

cases.push({
  name: 'mcq integration: empty raw options leave html.mcq-ready OFF (static fallback stays)',
  fn() {
    const env = makeEnv(emptyRawHtml());
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiMCQ.initFront();
    win.__flush();
    assertEq(win.document.querySelectorAll('.mcq-option-btn').length, 0,
      'no options -> no interactive grid may be built');
    assertTrue(win.document.documentElement.classList.contains('mcq-ready') === false,
      'marker must stay OFF so html:not(.mcq-ready) keeps the raw list readable');
  }
});

cases.push({
  name: 'mcq integration: keydown shortcut selects an option; destroyFront removes the logic keydown listener',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;

    // Instrument document event listeners to count keydown capture wiring.
    const originalDoc = win.document;
    let keydownCaptureAdds = 0;
    let keydownCaptureRemoves = 0;
    const realAdd = originalDoc.addEventListener.bind(originalDoc);
    const realRemove = originalDoc.removeEventListener.bind(originalDoc);
    win.document.addEventListener = function (type, fn, capture) {
      if (type === 'keydown' && capture === true) keydownCaptureAdds++;
      return realAdd(type, fn, capture);
    };
    win.document.removeEventListener = function (type, fn, capture) {
      if (type === 'keydown' && capture === true) keydownCaptureRemoves++;
      return realRemove(type, fn, capture);
    };

    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiMCQ.initFront();
    win.__flush();
    // initFront installs the LOGIC module's capture keydown handler fresh each
    // call (the engine's own handler was already bound at module load, before
    // the instrumentation below).
    assertEq(keydownCaptureAdds, 1, 'initFront must install one capture keydown listener');

    const evt = new win.KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true });
    win.document.dispatchEvent(evt);
    win.__flush();
    assertTrue(!!win.__hnaMCQState && win.__hnaMCQState.chosenIndex === 2,
      'pressing "3" must select slot 2');

    win.AnkiMCQ.destroyFront();
    assertTrue(win.__hnaMCQKeydown === null, 'destroyFront must clear the logic keydown handle');
    assertEq(keydownCaptureRemoves, 1, 'destroyFront must deregister exactly the logic keydown listener');
  }
});

cases.push({
  name: 'mcq integration: keydown 1-4 and a-d each select the right slot and flip on the FRONT (prevent+stop)',
  fn() {
    // The front face owns the shortcuts; each key run needs a fresh env because
    // the answered latch blocks a second flip on the same card instance.
    const pairs = [
      ['1', 0], ['2', 1], ['3', 2], ['4', 3],
      ['a', 0], ['b', 1], ['c', 2], ['d', 3]
    ];
    pairs.forEach(function (pair) {
      const env = makeEnv(baseHtml('front'));
      const win = env.win;
      win.AnkiEngine.config.shuffleChoices = false;
      win.AnkiMCQ.initFront();
      win.__flush();
      const evt = new win.KeyboardEvent('keydown', { key: pair[0], bubbles: true, cancelable: true });
      win.document.dispatchEvent(evt);
      win.__flush();
      assertTrue(!!win.__hnaMCQState, 'key "' + pair[0] + '" must select an option');
      assertEq(win.__hnaMCQState.chosenIndex, pair[1], 'key "' + pair[0] + '" must select slot ' + pair[1]);
      assertTrue(evt.defaultPrevented, 'key "' + pair[0] + '" must be defaultPrevented');
      assertEq(env.flipArgs.join(','), 'ans', 'key "' + pair[0] + '" must flip via pycmd("ans")');
      assertEq(win.document.querySelectorAll('.mcq-option-btn.is-pressed').length, 1,
        'key "' + pair[0] + '" must mark exactly one slot is-pressed');
      assertTrue(win.__hnaMCQAnswered === true, 'answered latch must be set after key selection');
    });
  }
});

cases.push({
  name: 'mcq integration: BACK face must ignore 1-4/a-d keydowns (no select, no flip, no new listener)',
  fn() {
    const env = makeEnv(baseHtml('back'));
    const win = env.win;
    let keydownCaptureAdds = 0;
    const realAdd = win.document.addEventListener.bind(win.document);
    win.document.addEventListener = function (type, fn, capture) {
      if (type === 'keydown' && capture === true) keydownCaptureAdds++;
      return realAdd(type, fn, capture);
    };
    win.AnkiMCQ.initBack();
    win.__flush();
    assertEq(keydownCaptureAdds, 0, 'initBack must NOT install a capture keydown listener');
    ['1', '2', '3', '4', 'a', 'b', 'c', 'd'].forEach(function (key) {
      const evt = new win.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
      win.document.dispatchEvent(evt);
      win.__flush();
    });
    assertEq(env.flipArgs.length, 0, 'back: keydown must never flip via pycmd("ans")');
    assertEq(win.document.querySelectorAll('.mcq-option-btn.is-pressed').length, 0,
      'back: keydown must never apply is-pressed');
    assertTrue(win.__hnaMCQAnswered !== true, 'back: answered latch must stay off');
    assertTrue(win.document.documentElement.classList.contains('mcq-ready'),
      'back: static grid still renders and marks ready');
  }
});

cases.push({
  name: 'mcq audio: Front/Back templates wrap Audio_Question in .sound (same as typing audio meaning)',
  fn() {
    ['Front.html', 'Back.html'].forEach(function (name) {
      const tpl = fs.readFileSync(path.join(MCQ_DIR, name), 'utf8');
      const m = tpl.match(/\{\{#Audio_Question\}\}\s*<span class="sound"[\s\S]*?\{\{Audio_Question\}\}[\s\S]*?\{\{\/Audio_Question\}\}/);
      assertTrue(!!m, name + ' must wrap {{Audio_Question}} inside a .sound span');
    });
    const rootFront = fs.readFileSync(path.join(ROOT, 'Front.html'), 'utf8');
    assertTrue(rootFront.indexOf('audio_meaning') !== -1 && rootFront.indexOf('class="sound"') !== -1,
      'typing front must keep the audio_meaning .sound wrapper (the pattern D follows)');
  }
});

cases.push({
  name: 'mcq audio: preview converts [sound:] tokens into replay-button soundLink anchors',
  fn() {
    const buildSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'mcq', 'preview', 'build-preview.js'), 'utf8');
    assertTrue(buildSrc.indexOf('replay-button soundLink') !== -1,
      'mcq preview builder must synthesize Anki replay-button markup');
    assertTrue(buildSrc.indexOf("Audio_Question: '[sound:mcq-question.mp3]'") !== -1,
      'mcq preview SAMPLE must include an Audio_Question [sound:] value');
    // Prove the shipped template really renders the field through the artifact's
    // OWN render()+toReplayButtons(), not a copy of the logic.
    const previewPath = path.resolve(__dirname, '..', '..', 'mcq', 'preview', 'preview_mcq.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const renderM = source.match(/(function render\(tpl, data\) \{[\s\S]*?\n\})\n\nfunction splitTemplate/);
    const replayM = source.match(/(function toReplayButtons\(html\) \{[\s\S]*?\n\})\n\nfunction buildDoc/);
    const tplM = source.match(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK/);
    assertTrue(!!renderM && !!replayM && !!tplM,
      'preview must embed render(), toReplayButtons() and TPL_FRONT');
    const render = vm.runInNewContext('(' + renderM[1] + ')', {});
    const toReplayButtons = vm.runInNewContext('(' + replayM[1] + ')', {});
    const out = toReplayButtons(
      render(JSON.parse(tplM[1]), { Question: 'Q', Audio_Question: '[sound:mcq-question.mp3]' })
    );
    assertTrue(out.indexOf('<span class="sound"') !== -1,
      'Audio_Question must stay inside its .sound wrapper');
    assertTrue(out.indexOf('<a class="replay-button soundLink" href="#" onclick="return false" aria-label="replay">[sound:mcq-question.mp3]</a>') !== -1,
      'Audio_Question must render as the Anki replay-button anchor');
  }
});

cases.push({
  name: 'mcq audio: shared CSS defines the Anki replay-button and soundLink rules',
  fn() {
    const css = fs.readFileSync(path.join(MCQ_DIR, '_mcq_styles.css'), 'utf8');
    assertTrue(css.indexOf('.replay-button') !== -1, 'mcq css must style plain .replay-button');
    assertTrue(css.indexOf('a.replay-button.soundLink') !== -1, 'mcq css must style a.replay-button.soundLink');
  }
});

cases.push({
  name: 'mcq security: option text that contains markup stays literal text — no innerHTML injection on front or back',
  fn() {
    // The MCQ module extracts option text from the DOM and rebuilds the grid.
    // A field like &lt;b&gt;...&lt;/b&gt; renders as the literal string
    // "<b>...</b>" in textContent; if that string is pushed back through
    // innerHTML it becomes a REAL <b> (or <img>/<script>) element. The build
    // must bind option text with textContent only (BUG-034).
    const P_BOLD = '<b>bold payload</b>';
    const env = makeEnv(baseHtml('front', [
      { text: '&lt;b&gt;bold payload&lt;/b&gt;', correct: true },
      { text: '&lt;img src=x onerror="window.__pwned=true"&gt;', correct: false },
      { text: 'plain option', correct: false },
      { text: 'katt', correct: false }
    ]));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;

    win.AnkiMCQ.initFront();
    win.__flush();
    let contents = win.document.querySelectorAll('.option-content');
    assertTrue(win.document.querySelector('.option-content b') === null,
      'front: <b> literal must not become a DOM node');
    assertTrue(win.document.querySelector('.option-content img') === null,
      'front: <img> literal must not become a DOM node');
    assertEq(contents[0].textContent, P_BOLD, 'front: payload must surface as plain text');

    clickSlot(win, 0);
    win.__flush();
    flipToBack(win);
    win.__flush();
    contents = win.document.querySelectorAll('.option-content');
    assertTrue(win.document.querySelector('.option-content b') === null,
      'back: <b> literal must not become a DOM node (innerHTML sink)');
    assertTrue(win.document.querySelector('.option-content img') === null,
      'back: <img> literal must not become a DOM node');
    assertTrue(win.document.querySelector('.option-content script') === null,
      'back: <script> literal must not become a DOM node');
    assertEq(contents[0].textContent, P_BOLD, 'back: payload must surface as plain text');
    assertTrue(win.__pwned === undefined,
      'back: payload must never execute');
    assertEq(env.tones.join(','), 'correct', 'back: the correct pick must still play its tone');
    assertEq(win.document.querySelectorAll('.mcq-option-btn.is-static').length, 4,
      'back: all options must still render');
  }
});

cases.push({
  name: 'mcq integration: preview builder resolves every template field (hyphenated fields included)',
  fn() {
    // The human-review artifact is generated in the SOURCE tree (mcq/preview/),
    // even when the rest of the suite runs against the staged publish bundle,
    // so resolve it from __dirname rather than ROOT.
    const previewPath = path.resolve(__dirname, '..', '..', 'mcq', 'preview', 'preview_mcq.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const tplM = source.match(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK = ("[\s\S]*?");/);
    const renderM = source.match(/(function render\(tpl, data\) \{[\s\S]*?\n\})\n\nfunction splitTemplate/);
    assertTrue(!!tplM, 'preview_mcq.html must embed TPL_FRONT and TPL_BACK');
    assertTrue(!!renderM, 'preview_mcq.html must embed its render() helper');
    // Run the preview's OWN render helper so the test pins the artifact, not a
    // copy of the regex. A hyphen in a field name (Correct-answer, Distraction-1)
    // must be part of the field-name class or the braces survive into the DOM,
    // getRawChoicesFromDOM() filters them out, and the safety backdoor shows
    // the raw answers below the footer instead of the interactive grid.
    const render = vm.runInNewContext('(' + renderM[1] + ')', {});
    const SAMPLE = {
      Question: 'Q', Audio_Question: '[audio]',
      'Correct-answer': 'the correct option',
      'Distraction-1': 'distractor one',
      'Distraction-2': 'distractor two',
      'Distraction-3': 'distractor three',
      Explanation: 'why', ID: 'ID-1', Tags_Custom: 'tag one'
    };
    [['Front', JSON.parse(tplM[1])], ['Back', JSON.parse(tplM[2])]].forEach(function (pair) {
      const out = render(pair[1], SAMPLE);
      const leftover = out.match(/\{\{[^}]*\}\}/g) || [];
      assertEq(leftover.length, 0,
        pair[0] + ' preview render must substitute every field; unresolved: ' + leftover.join(', '));
    });
  }
});

cases.push({
  name: 'mcq integration: preview embeds the shipped CSS/templates/modules byte-for-byte',
  fn() {
    // Freshness (pre-flight) only proves the artifact is NEWER than the sources;
    // this pins that its embedded payload is IDENTICAL to the shipped files, so
    // a hand-edit or an embed() regression can never silently desync the preview
    // from the release bundle.
    const previewPath = path.resolve(__dirname, '..', '..', 'mcq', 'preview', 'preview_mcq.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const grab = function (re, group, label) {
      const m = source.match(re);
      assertTrue(!!m, 'preview_mcq.html must embed ' + label);
      return JSON.parse(m[group]);
    };
    const embedded = [
      ['Front.html', grab(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK/, 1, 'TPL_FRONT')],
      ['Back.html', grab(/var TPL_BACK = ("[\s\S]*?");\nvar HNA_MODS/, 1, 'TPL_BACK')],
      ['_mcq_storage.js', grab(/"storage": ("[\s\S]*?"),\n  "engine":/, 1, 'storage')],
      ['_mcq_engine.js', grab(/"engine": ("[\s\S]*?"),\n  "logic":/, 1, 'engine')],
      ['_mcq_logic.js', grab(/"logic": ("[\s\S]*?"),\n  "aurora":/, 1, 'logic')],
      ['_mcq_aurora.js', grab(/"aurora": ("[\s\S]*?")\n\};/, 1, 'aurora')]
    ];
    const mcqDir = path.resolve(__dirname, '..', '..', 'mcq');
    embedded.forEach(function (pair) {
      const shipped = fs.readFileSync(path.join(mcqDir, pair[0]), 'utf8');
      assertEq(pair[1], shipped,
        'preview payload for ' + pair[0] + ' must equal the shipped file byte-for-byte');
    });
    // CSS ships minified (publish stages minifyCss(readable)), while a preview
    // built from the source tree embeds the readable copy. Accept either exact
    // form; anything else means the preview drifted from the shipped sheet.
    const embeddedCss = grab(/var HNA_CSS = ("[\s\S]*?");\nvar TPL_FRONT/, 1, 'HNA_CSS');
    const shippedCss = fs.readFileSync(path.join(mcqDir, '_mcq_styles.css'), 'utf8');
    assertTrue([shippedCss, minifyCss(shippedCss)].indexOf(embeddedCss) !== -1,
      'preview HNA_CSS must be the readable shipped sheet or its minified build');
  }
});

cases.push({
  name: 'mcq integration: preview render() accepts any field name (no character whitelist)',
  fn() {
    // Guards BUG-045 from recurring: the field-name pattern must stay generic
    // ({{...}} / {{#...}}) rather than a hand-maintained character class that
    // can silently exclude a valid character (the bug was a missing hyphen).
    const previewPath = path.resolve(__dirname, '..', '..', 'mcq', 'preview', 'preview_mcq.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const renderM = source.match(/(function render\(tpl, data\) \{[\s\S]*?\n\})\n\nfunction splitTemplate/);
    assertTrue(!!renderM, 'preview_mcq.html must embed its render() helper');
    const render = vm.runInNewContext('(' + renderM[1] + ')', {});
    const data = {
      'Custom-Field.1': 'A',
      'Field With Space': 'B',
      'weird_Char$': 'C'
    };
    const tpl = '{{Custom-Field.1}}|{{Field With Space}}|{{weird_Char$}}|' +
      '{{#Custom-Field.1}}Y{{/Custom-Field.1}}{{#Missing}}N{{/Missing}}';
    assertEq(render(tpl, data), 'A|B|C|Y',
      'render() must substitute any field name and treat unknown #sections as empty');
  }
});

module.exports = cases;