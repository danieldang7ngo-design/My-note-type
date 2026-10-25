'use strict';
/* TF integration tests — True-False note type contract:
     1. initFront builds four statement rows (badge = de number, two
        DUNG/SAI radio halves) and marks html.tf-ready only after render.
     2. shuffleChoices=false preserves de order; shuffle is a permutation.
     3. Answering drives progress + KIEM TRA gating; re-click keeps,
        opposite side switches; submit stores state and flips exactly once.
     4. Back re-renders the stored order, flags correct/wrong/dimmed,
        verdict + x/N, miss list in de order, tone.
     5. Back with no state: BỎ TRỐNG verdict, all is-skipped, answers shown.
     6. Unknown truth token fails closed (no marker, console.warn).
     7. Keyboard: T/F answer, 1-4 focus, arrows move, modifiers/inputs/
        composing ignored, Space unbound; destroyFront leaks nothing.
   Real tf modules (storage/engine/logic) run in a hermetic vm context.
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { minifyCss } = require('../minify-css');

const ROOT = process.env.HNA_ROOT || path.resolve(__dirname, '..', '..');
const TF_DIR = path.join(ROOT, 'tf');
const MODULE_ORDER = ['_tf_storage.js', '_tf_engine.js', '_tf_logic.js'];

/* Four statements: truths T, F, T, F (matches SAMPLE T/T/F/T shape). */
const RAW_STATEMENTS = [
  { text: 'Nuoc soi o 100 do C', truth: 'T' },
  { text: 'Nuoc co cong thuc CO2', truth: 'F' },
  { text: 'Nuoc da noi tren nuoc', truth: 'T' },
  { text: 'Nuoc tinh khiet dan dien tot', truth: 'F' }
];

function baseHtml(face, statements, answers) {
  const list = statements || RAW_STATEMENTS;
  const raws = list.map((a) =>
    '<div class="tf-raw-item" data-tf="' + (answers ? answers : a.truth) + '">' + a.text + '</div>'
  ).join('');
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="tf-question-raw">Danh gia cac phat bieu</div>' +
    '<div class="card-wrapper"><div class="aurora-card card-' + face + '">' +
    '<div class="card-content">' +
    '<div id="tf-progress" role="status" aria-live="polite"></div>' +
    '<div id="tf-rows-container" class="tf-rows"></div>' +
    '<button id="tf-submit" disabled>KIEM TRA</button>' +
    '<div id="tf-verdict-container"></div>' +
    '<div id="tf-miss-list"></div>' +
    '</div>' +
    '<div id="tf-raw-data">' + raws + '</div>' +
    '</div></div>' +
    '<div id="settingsMenu"></div><button id="btnSettings"></button>' +
    '</body></html>';
}

function invalidRawHtml() {
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="tf-question-raw">Q</div>' +
    '<div id="tf-rows-container"></div><div id="tf-verdict-container"></div>' +
    '<div id="tf-miss-list"></div><div id="tf-progress"></div>' +
    '<button id="tf-submit" disabled>KIEM TRA</button>' +
    '<div id="tf-raw-data">' +
    '<div class="tf-raw-item" data-tf="T">ok one</div>' +
    '<div class="tf-raw-item" data-tf="MAYBE">bad token</div>' +
    '</div></body></html>';
}

function emptyRawHtml() {
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="tf-question-raw">Q</div>' +
    '<div id="tf-rows-container"></div><div id="tf-verdict-container"></div>' +
    '<div id="tf-miss-list"></div><div id="tf-progress"></div>' +
    '<button id="tf-submit" disabled>KIEM TRA</button>' +
    '<div id="tf-raw-data">' +
    '<div class="tf-raw-item" data-tf=""></div>' +
    '<div class="tf-raw-item" data-tf=""></div>' +
    '</div></body></html>';
}

function audioFrontHtml(soundInner) {
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div class="card-wrapper"><div class="aurora-card card-front">' +
    '<div class="card-content">' +
    '<span class="sound">' + soundInner + '</span>' +
    '<div id="tf-rows-container"></div>' +
    '<div id="tf-verdict-container"></div>' +
    '</div>' +
    '<div id="tf-raw-data"></div>' +
    '</div></div>' +
    '<div id="settingsMenu"></div><button id="btnSettings"></button>' +
    '</body></html>';
}

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
    Object.defineProperty(win, name, { configurable: true, value: wrapper });
  };
  stub('setTimeout', function (fn) { queue.push({ id: ++seq, fn: fn }); return seq; });
  stub('clearTimeout', remove);
  stub('setInterval', function (fn) { queue.push({ id: ++seq, fn: fn }); return seq; });
  stub('clearInterval', remove);
  stub('requestAnimationFrame', function (fn) { queue.push({ id: ++seq, fn: function () { fn(Date.now()); } }); return seq; });
  stub('cancelAnimationFrame', remove);

  const env = {
    win: win, dom: dom, tones: [], flipArgs: [], warns: [],
    __flush: function () { while (queue.length) queue.shift().fn(); }
  };
  win.__flush = env.__flush;
  win.pycmd = function (arg) { env.flipArgs.push(arg); };
  win.AnkiAudio = win.AnkiAudio || {};
  win.AnkiAudio.playTone = function (type) { env.tones.push(type); };
  const origWarn = win.console && win.console.warn;
  if (win.console) {
    win.console.warn = function (m) { env.warns.push(String(m)); if (origWarn) return origWarn.apply(this, arguments); };
  }

  const ctx = vm.createContext(win);
  MODULE_ORDER.forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(TF_DIR, name), 'utf8'), ctx);
  });
  env.__flush();
  return env;
}

function rowBadges(win) {
  const out = [];
  const badges = win.document.querySelectorAll('.tf-badge');
  for (let i = 0; i < badges.length; i++) out.push(badges[i].textContent);
  return out;
}

function rowTexts(win) {
  const out = [];
  const els = win.document.querySelectorAll('.tf-text');
  for (let i = 0; i < els.length; i++) out.push(els[i].textContent);
  return out;
}

function clickHalf(win, rowIdx, val) {
  const rows = win.document.querySelectorAll('.tf-row');
  if (rowIdx >= rows.length) throw new Error('no tf row at index ' + rowIdx);
  const btn = rows[rowIdx].querySelector(val ? '.tf-true' : '.tf-false');
  if (!btn) throw new Error('no half button for val=' + val);
  btn.click();
}

function flipToBack(win) {
  const card = win.document.querySelector('.aurora-card');
  card.className = card.className.replace('card-front', 'card-back');
  win.AnkiTF.initBack();
}

function progressText(win) {
  const el = win.document.getElementById('tf-progress');
  return el ? el.textContent : '';
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
  name: 'tf integration: initFront builds four rows and marks html.tf-ready',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    assertTrue(win.document.documentElement.classList.contains('tf-ready') === false,
      'precondition: marker must start OFF so the static fallback is visible');
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    assertEq(win.document.querySelectorAll('.tf-row').length, 4,
      'interactive area must contain one row per statement');
    assertTrue(win.document.documentElement.classList.contains('tf-ready'),
      'html.tf-ready must be added after the rows rendered');
    assertEq(win.document.querySelectorAll('.tf-raw-item').length, 4,
      'raw statement divs must stay in the DOM (they are the fallback source)');
    // Badge = de number (origIndex+1), position-independent.
    assertEq(rowBadges(win).join('|'), '1|2|3|4', 'badges must be the de numbers');
    // Two halves per row, radio roles, unchecked.
    const halves = win.document.querySelectorAll('.tf-half');
    assertEq(halves.length, 8, 'each row must have a DUNG half and a SAI half');
    for (let i = 0; i < halves.length; i++) {
      assertEq(halves[i].getAttribute('role'), 'radio', 'halves are radio buttons');
      assertEq(halves[i].getAttribute('aria-checked'), 'false', 'halves start unchecked');
    }
    assertEq(progressText(win), 'Đã trả lời 0/4', 'progress starts at 0/4');
    const btn = win.document.getElementById('tf-submit');
    assertTrue(btn.hasAttribute('disabled'), 'KIEM TRA stays disabled until all rows answered');
  }
});

cases.push({
  name: 'tf integration: shuffleChoices=false preserves de order; shuffle is a permutation',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    assertEq(rowTexts(win).join('|'),
      'Nuoc soi o 100 do C|Nuoc co cong thuc CO2|Nuoc da noi tren nuoc|Nuoc tinh khiet dan dien tot',
      'disabled shuffle must mirror the raw de order');
    const env2 = makeEnv(baseHtml('front'));
    const win2 = env2.win;
    const realRandom = win2.Math.random;
    win2.Math.random = function () { return 0; };
    try {
      win2.AnkiEngine.config.shuffleChoices = true;
      win2.AnkiTF.initFront();
      win2.__flush();
      // Fisher-Yates with random=0 on [0,1,2,3]: i=3 j=0 -> [3,1,2,0];
      // i=2 j=0 -> [2,1,3,0]; i=1 j=0 -> [1,2,3,0]. Badges follow the row.
      assertEq(rowBadges(win2).join('|'), '2|3|4|1',
        'seeded shuffle must permute whole rows (badges travel with their statement)');
      assertEq(rowTexts(win2)[3], 'Nuoc soi o 100 do C',
        'statement text must travel with its badge');
    } finally {
      win2.Math.random = realRandom;
    }
    const texts = rowTexts(win2).slice().sort();
    assertEq(texts.join('|'),
      'Nuoc co cong thuc CO2|Nuoc da noi tren nuoc|Nuoc soi o 100 do C|Nuoc tinh khiet dan dien tot',
      'shuffled rows must be a permutation of the same set');
  }
});

cases.push({
  name: 'tf integration: halves record answers; same-side re-click keeps, other side switches',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    clickHalf(win, 0, true);
    win.__flush();
    assertEq(progressText(win), 'Đã trả lời 1/4', 'progress counts the answer');
    let rows = win.document.querySelectorAll('.tf-row');
    let halves = rows[0].querySelectorAll('.tf-half');
    assertEq(halves[0].getAttribute('aria-checked'), 'true', 'DUNG half checked');
    assertTrue(halves[0].classList.contains('is-true'), 'DUNG half carries is-true');
    assertEq(halves[1].getAttribute('aria-checked'), 'false', 'SAI half unchecked');
    // Re-click same side: answer kept, still counted once.
    clickHalf(win, 0, true);
    win.__flush();
    assertEq(progressText(win), 'Đã trả lời 1/4', 'same-side re-click must not unselect');
    assertEq(halves[0].getAttribute('aria-checked'), 'true', 'answer survives re-click');
    // Opposite side switches.
    clickHalf(win, 0, false);
    win.__flush();
    halves = win.document.querySelectorAll('.tf-row')[0].querySelectorAll('.tf-half');
    assertEq(halves[1].getAttribute('aria-checked'), 'true', 'SAI half checked after switch');
    assertTrue(halves[1].classList.contains('is-false'), 'SAI half carries is-false');
    assertEq(progressText(win), 'Đã trả lời 1/4', 'switch keeps the row answered');
  }
});

cases.push({
  name: 'tf integration: KIEM TRA gates on completeness, stores state, flips exactly once',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    const btn = win.document.getElementById('tf-submit');
    btn.click();
    win.__flush();
    assertEq(env.flipArgs.length, 0, 'incomplete answers must not flip');
    clickHalf(win, 0, true);
    clickHalf(win, 1, false);
    clickHalf(win, 2, true);
    win.__flush();
    assertTrue(btn.hasAttribute('disabled'), '3/4 answered keeps KIEM TRA disabled');
    assertEq(progressText(win), 'Đã trả lời 3/4', 'progress tracks 3/4');
    clickHalf(win, 3, false);
    win.__flush();
    assertTrue(!btn.hasAttribute('disabled'), '4/4 answered enables KIEM TRA');
    btn.click();
    win.__flush();
    assertEq(env.flipArgs.join(','), 'ans', 'submit must flip via pycmd("ans")');
    const st = win.__hnaTFState;
    assertTrue(!!st, 'submit must persist the state');
    assertEq(st.v, 1, 'state version must be 1');
    assertTrue(!!st.sig && st.sig.indexOf('Nuoc soi') !== -1, 'signature derives from the card');
    assertTrue(st.expiresAt - st.submittedAt === 5 * 60 * 1000, 'state TTL must be 5 minutes');
    assertEq(JSON.stringify(st.answers), JSON.stringify({ 0: true, 1: false, 2: true, 3: false }),
      'answers keyed by de index');
    btn.click();
    win.__flush();
    assertEq(env.flipArgs.join(','), 'ans', 'double submit must flip exactly once (answered latch)');
  }
});

cases.push({
  name: 'tf integration: back re-renders stored order with correct/wrong/dimmed flags, verdict, miss list, tone',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.Math.random = function () { return 0; }; // order [1,2,3,0]
    win.AnkiEngine.config.shuffleChoices = true;
    win.AnkiTF.initFront();
    win.__flush();
    // Displayed rows: [1(F),2(T),3(F),0(T)]. Answer: row0 TRUE (wrong),
    // row1 TRUE (correct), row2 unanswered, row3 FALSE (wrong).
    clickHalf(win, 0, true);
    clickHalf(win, 1, true);
    clickHalf(win, 3, false);
    win.__flush();
    // Complete the set so submit is allowed, then blank row2 again is
    // impossible via UI; instead answer row2 wrongly then check grading of a
    // mixed card: use a fresh env for the canonical mixed assertions below.
    const env2 = makeEnv(baseHtml('front'));
    const w2 = env2.win;
    w2.AnkiEngine.config.shuffleChoices = false;
    w2.AnkiTF.initFront();
    w2.__flush();
    // truths T,F,T,F — answer row0 T (correct), row1 T (wrong),
    // row3 F (correct), leave row2 blank.
    clickHalf(w2, 0, true);
    clickHalf(w2, 1, true);
    clickHalf(w2, 3, false);
    w2.__flush();
    // Force-complete via answering row2 then verify submit path separately;
    // here grade directly through the back by completing row2 as skipped is
    // impossible, so answer row2 correctly and assert the 3/4 + verdict.
    clickHalf(w2, 2, true);
    w2.__flush();
    w2.document.getElementById('tf-submit').click();
    w2.__flush();
    flipToBack(w2);
    w2.__flush();
    assertTrue(w2.document.documentElement.classList.contains('tf-ready'),
      'back must mark html.tf-ready after rendering its static rows');
    assertEq(rowBadges(w2).join('|'), '1|2|3|4', 'back must re-render the STORED order');
    const rows = w2.document.querySelectorAll('.tf-row');
    assertEq(rows.length, 4, 'back renders all four rows');
    // Row1 (truth F, chose T): DUNG half is-wrong + ✗, SAI half is-correct + ✓.
    const r1 = rows[1].querySelectorAll('.tf-half');
    assertTrue(r1[0].classList.contains('is-wrong'), 'wrongly chosen side carries is-wrong');
    assertTrue(r1[0].textContent.indexOf('✗') !== -1, 'wrong side shows ✗');
    assertTrue(r1[1].classList.contains('is-correct'), 'true side carries is-correct');
    assertTrue(r1[1].textContent.indexOf('✓') !== -1, 'correct side shows ✓');
    // Row0 (truth T, chose T): DUNG half is-correct, SAI half is-dimmed.
    const r0 = rows[0].querySelectorAll('.tf-half');
    assertTrue(r0[0].classList.contains('is-correct'), 'correct pick carries is-correct');
    assertTrue(r0[1].classList.contains('is-dimmed'), 'uninvolved side is dimmed');
    const verdict = w2.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('wrong') !== -1,
      'one wrong pick must show the CHƯA CHÍNH XÁC banner');
    assertTrue(verdict.textContent.indexOf('3/4') !== -1, 'verdict carries the partial score x/N');
    assertEq(env2.tones.join(','), 'wrong', 'partial card must play the wrong tone');
    const miss = w2.document.getElementById('tf-miss-list').textContent;
    assertTrue(miss.indexOf('CÁC CÂU SAI') !== -1, 'miss list header present');
    assertTrue(miss.indexOf('Câu 2: đáp án SAI — bạn chọn ĐÚNG') !== -1,
      'miss line names de number, true answer and the wrong pick, got: ' + miss);
  }
});

cases.push({
  name: 'tf integration: all-correct back shows the correct banner, tone and empty-of-wrong miss list',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    clickHalf(win, 0, true);
    clickHalf(win, 1, false);
    clickHalf(win, 2, true);
    clickHalf(win, 3, false);
    win.__flush();
    win.document.getElementById('tf-submit').click();
    win.__flush();
    flipToBack(win);
    win.__flush();
    const verdict = win.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('correct') !== -1,
      'perfect card must show the CHÍNH XÁC banner');
    assertTrue(verdict.textContent.indexOf('4/4') !== -1, 'perfect verdict shows 4/4');
    assertEq(env.tones.join(','), 'correct', 'perfect card must play the correct tone');
    const missItems = win.document.querySelectorAll('.tf-miss-item');
    assertEq(missItems.length, 0, 'perfect card has no miss lines');
  }
});

cases.push({
  name: 'tf integration: back with no state shows BỎ TRỐNG, all is-skipped, answers still revealed',
  fn() {
    const env = makeEnv(baseHtml('back'));
    const win = env.win;
    win.AnkiTF.initBack();
    win.__flush();
    const verdict = win.document.querySelector('.verdict-banner');
    assertTrue(!!verdict && verdict.className.indexOf('wrong') !== -1,
      'no-state back must show the wrong banner (skipped counts as wrong)');
    assertTrue(verdict.textContent.indexOf('BỎ TRỐNG') !== -1,
      'no-state verdict must say BỎ TRỐNG — TÍNH LÀ SAI');
    assertTrue(verdict.textContent.indexOf('0/4') !== -1, 'no-state score is 0/4');
    assertEq(env.tones.join(','), 'wrong', 'no state must play the wrong tone');
    assertTrue(win.document.documentElement.classList.contains('tf-ready'),
      'back must still mark ready so the static fallback hides behind the rows');
    const rows = win.document.querySelectorAll('.tf-row');
    assertEq(rows.length, 4, 'back renders a static row per statement');
    for (let i = 0; i < rows.length; i++) {
      assertTrue(rows[i].classList.contains('is-skipped'), 'row ' + i + ' must be is-skipped');
    }
    // Correct answers still revealed: rows 0,2 (truth T) flag DUNG; 1,3 flag SAI.
    assertTrue(rows[0].querySelector('.tf-true').classList.contains('is-correct'),
      'truth-T row must still reveal the DUNG side');
    assertTrue(rows[1].querySelector('.tf-false').classList.contains('is-correct'),
      'truth-F row must still reveal the SAI side');
    const miss = win.document.getElementById('tf-miss-list').textContent;
    [1, 2, 3, 4].forEach((n) => {
      assertTrue(miss.indexOf('Câu ' + n + ':') !== -1, 'miss list covers Câu ' + n);
      assertTrue(miss.indexOf('chưa trả lời') !== -1, 'no-state miss lines say chưa trả lời');
    });
  }
});

cases.push({
  name: 'tf integration: unknown truth token fails closed on front and back (no marker, warn)',
  fn() {
    const env = makeEnv(invalidRawHtml());
    const win = env.win;
    win.AnkiTF.initFront();
    win.__flush();
    assertEq(win.document.querySelectorAll('.tf-row').length, 0,
      'invalid token must build no interactive rows');
    assertTrue(win.document.documentElement.classList.contains('tf-ready') === false,
      'marker must stay OFF so html:not(.tf-ready) keeps the raw list readable');
    assertTrue(env.warns.join(' ').indexOf('static fallback') !== -1,
      'invalid token must console.warn, got: ' + env.warns.join('|'));
    const env2 = makeEnv(invalidRawHtml());
    const win2 = env2.win;
    win2.AnkiTF.initBack();
    win2.__flush();
    assertTrue(win2.document.documentElement.classList.contains('tf-ready') === false,
      'back with an invalid token must also stay unmarked (fail-closed)');
    assertEq(win2.document.querySelectorAll('.tf-row').length, 0,
      'back with an invalid token renders no graded rows');
  }
});

cases.push({
  name: 'tf integration: empty raw statements leave html.tf-ready OFF (static fallback stays)',
  fn() {
    const env = makeEnv(emptyRawHtml());
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    assertEq(win.document.querySelectorAll('.tf-row').length, 0,
      'no statements -> no interactive rows may be built');
    assertTrue(win.document.documentElement.classList.contains('tf-ready') === false,
      'marker must stay OFF so html:not(.tf-ready) keeps the raw list readable');
  }
});

cases.push({
  name: 'tf integration: keyboard T/F answer, 1-4 focus, arrows move; destroyFront removes the listener',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
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
    win.AnkiTF.initFront();
    win.__flush();
    assertEq(keydownCaptureAdds, 1, 'initFront must install one capture keydown listener');
    // Focus row 3 (display index 2), answer it with T.
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
    win.__flush();
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'T', bubbles: true, cancelable: true }));
    win.__flush();
    assertEq(progressText(win), 'Đã trả lời 1/4', 'T must answer the focused row');
    let rows = win.document.querySelectorAll('.tf-row');
    assertTrue(rows[2].querySelector('.tf-true').classList.contains('is-true'),
      'row 3 (focused via "3") must carry the T answer');
    // F on the same focused row switches it.
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'F', bubbles: true, cancelable: true }));
    win.__flush();
    rows = win.document.querySelectorAll('.tf-row');
    assertTrue(rows[2].querySelector('.tf-false').classList.contains('is-false'),
      'F must switch the focused row to SAI');
    assertEq(progressText(win), 'Đã trả lời 1/4', 'switch keeps the answered count');
    // ArrowDown moves focus to row 4; T answers it.
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    win.__flush();
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
    win.__flush();
    rows = win.document.querySelectorAll('.tf-row');
    assertTrue(rows[3].querySelector('.tf-true').classList.contains('is-true'),
      'ArrowDown + T must answer the next row');
    win.AnkiTF.destroyFront();
    assertTrue(win.__hnaTFKeydown === null, 'destroyFront must clear the logic keydown handle');
    assertEq(keydownCaptureRemoves, 1, 'destroyFront must deregister exactly the logic keydown listener');
  }
});

cases.push({
  name: 'tf integration: modified keys, editable targets, composing and Space never answer',
  fn() {
    [{ key: 'T', ctrlKey: true }, { key: 'F', altKey: true }, { key: 't', metaKey: true }].forEach(function (cfg) {
      const env = makeEnv(baseHtml('front'));
      const win = env.win;
      win.AnkiEngine.config.shuffleChoices = false;
      win.AnkiTF.initFront();
      win.__flush();
      cfg.bubbles = true;
      cfg.cancelable = true;
      const evt = new win.KeyboardEvent('keydown', cfg);
      win.document.dispatchEvent(evt);
      win.__flush();
      assertEq(progressText(win), 'Đã trả lời 0/4', 'modified key must not answer');
      assertEq(env.flipArgs.length, 0, 'modified key must not flip');
      assertTrue(!evt.defaultPrevented, 'modified key must not be defaultPrevented');
    });
    // Composing (IME) is ignored.
    const envC = makeEnv(baseHtml('front'));
    const winC = envC.win;
    winC.AnkiTF.initFront();
    winC.__flush();
    winC.document.dispatchEvent(new winC.KeyboardEvent('keydown', { key: 'T', bubbles: true, cancelable: true, isComposing: true }));
    winC.__flush();
    assertEq(progressText(winC), 'Đã trả lời 0/4', 'composing key must not answer');
    // Editable targets pass through.
    const env2 = makeEnv(baseHtml('front'));
    const win2 = env2.win;
    win2.AnkiTF.initFront();
    win2.__flush();
    const input = win2.document.createElement('input');
    win2.document.body.appendChild(input);
    input.dispatchEvent(new win2.KeyboardEvent('keydown', { key: 'T', bubbles: true, cancelable: true }));
    win2.__flush();
    assertEq(progressText(win2), 'Đã trả lời 0/4', 'key in an editable field must not answer');
    // Space is never bound (no answer, no flip, not prevented).
    const evt2 = new win2.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    win2.document.dispatchEvent(evt2);
    win2.__flush();
    assertEq(progressText(win2), 'Đã trả lời 0/4', 'Space must not answer');
    assertTrue(!evt2.defaultPrevented, 'Space must not be defaultPrevented');
  }
});

cases.push({
  name: 'tf integration: reshown question drops the stored answers (no stale state after refresh/undo)',
  fn() {
    const env = makeEnv(baseHtml('front'));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    clickHalf(win, 0, true);
    clickHalf(win, 1, true);
    clickHalf(win, 2, true);
    clickHalf(win, 3, true);
    win.__flush();
    win.document.getElementById('tf-submit').click();
    win.__flush();
    assertTrue(!!win.__hnaTFState, 'setup: the answers must be stored');
    win.AnkiTF.initFront();
    win.__flush();
    assertTrue(!win.__hnaTFState, 'reshow must clear the in-memory state');
    let stored = null;
    try { stored = win.sessionStorage.getItem('hna-tf-state'); } catch (e) {}
    assertTrue(!stored, 'reshow must clear sessionStorage so a blank flip stays blank');
    assertEq(progressText(win), 'Đã trả lời 0/4', 'reshow resets progress');
  }
});

cases.push({
  name: 'tf integration: BACK face ignores T/F/arrows/1-4 (no answer, no flip, no new listener)',
  fn() {
    const env = makeEnv(baseHtml('back'));
    const win = env.win;
    let keydownCaptureAdds = 0;
    const realAdd = win.document.addEventListener.bind(win.document);
    win.document.addEventListener = function (type, fn, capture) {
      if (type === 'keydown' && capture === true) keydownCaptureAdds++;
      return realAdd(type, fn, capture);
    };
    win.AnkiTF.initBack();
    win.__flush();
    assertEq(keydownCaptureAdds, 0, 'initBack must NOT install a capture keydown listener');
    ['1', '2', 'T', 'F', 't', 'f', 'ArrowDown', 'ArrowUp', ' '].forEach(function (key) {
      const evt = new win.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
      win.document.dispatchEvent(evt);
      win.__flush();
      assertTrue(!evt.defaultPrevented, 'back: key "' + key + '" must not be defaultPrevented');
    });
    assertEq(env.flipArgs.length, 0, 'back: keydown must never flip via pycmd("ans")');
    assertTrue(win.document.documentElement.classList.contains('tf-ready'),
      'back: static rows still render and mark ready');
  }
});

cases.push({
  name: 'tf audio: Front/Back templates wrap Audio_Question in .sound (same as typing/mcq audio)',
  fn() {
    ['Front.html', 'Back.html'].forEach(function (name) {
      const tpl = fs.readFileSync(path.join(TF_DIR, name), 'utf8');
      const m = tpl.match(/\{\{#Audio_Question\}\}\s*<span class="sound"[\s\S]*?\{\{Audio_Question\}\}[\s\S]*?\{\{\/Audio_Question\}\}/);
      assertTrue(!!m, name + ' must wrap {{Audio_Question}} inside a .sound span');
    });
  }
});

cases.push({
  name: 'tf audio: preview converts [sound:] tokens into replay-button soundLink anchors',
  fn() {
    const buildSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tf', 'preview', 'build-preview.js'), 'utf8');
    assertTrue(buildSrc.indexOf('replay-button soundLink') !== -1,
      'tf preview builder must synthesize Anki replay-button markup');
    assertTrue(buildSrc.indexOf("Audio_Question: '[sound:tf-question.mp3]'") !== -1,
      'tf preview SAMPLE must include an Audio_Question [sound:] value');
    const previewPath = path.resolve(__dirname, '..', '..', 'tf', 'preview', 'preview_tf.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const renderM = source.match(/(function render\(tpl, data\) \{[\s\S]*?\n\})\n\nfunction splitTemplate/);
    const replayM = source.match(/(function toReplayButtons\(html\) \{[\s\S]*?\n\})\n\nfunction buildDoc/);
    const tplM = source.match(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK/);
    assertTrue(!!renderM && !!replayM && !!tplM,
      'preview must embed render(), toReplayButtons() and TPL_FRONT');
    const render = vm.runInNewContext('(' + renderM[1] + ')', {});
    const toReplayButtons = vm.runInNewContext('(' + replayM[1] + ')', {});
    const out = toReplayButtons(
      render(JSON.parse(tplM[1]), { Question: 'Q', Audio_Question: '[sound:tf-question.mp3]' })
    );
    assertTrue(out.indexOf('<span class="sound"') !== -1,
      'Audio_Question must stay inside its .sound wrapper');
    assertTrue(out.indexOf('<a class="replay-button soundLink" href="#" onclick="return false" aria-label="replay">[sound:tf-question.mp3]</a>') !== -1,
      'Audio_Question must render as the Anki replay-button anchor');
  }
});

cases.push({
  name: 'tf audio: shared CSS defines the Anki replay-button and soundLink rules',
  fn() {
    const css = fs.readFileSync(path.join(TF_DIR, '_tf_styles.css'), 'utf8');
    assertTrue(css.indexOf('.replay-button') !== -1, 'tf css must style plain .replay-button');
    assertTrue(css.indexOf('a.replay-button.soundLink') !== -1, 'tf css must style a.replay-button.soundLink');
    const m = css.match(/\.hna-audio-source\s*\{([^}]*)\}/);
    assertTrue(!!m, 'tf css must define the .hna-audio-source collapse rule');
    assertTrue(/position:\s*absolute/.test(m[1]), '.hna-audio-source must pin position: absolute');
    assertTrue(/pointer-events:\s*none/.test(m[1]), '.hna-audio-source must carry pointer-events: none');
    assertTrue(/clip-path/.test(m[1]), '.hna-audio-source must carry clip-path');
  }
});

cases.push({
  name: 'tf audio: AnkiWeb native <audio> gets the styled replay button (icon parity)',
  fn() {
    const env = makeEnv(audioFrontHtml('<audio controls src="q.mp3"></audio>'));
    const win = env.win;
    win.__flush();
    const audio = win.document.querySelector('.sound audio');
    assertTrue(!!audio, 'the native player AnkiWeb emits must stay in the DOM as the audio source');
    assertTrue(audio.classList.contains('hna-audio-source'), 'native controls must be hidden once skinned');
    assertEq(audio.getAttribute('data-hna-audio'), '1', 'skinned audio must carry the data-hna-audio marker');
    const btns = win.document.querySelectorAll('.sound button.replay-button');
    assertEq(btns.length, 1, 'exactly one styled replay button per sound');
    let played = 0;
    audio.play = function () { played++; };
    btns[0].click();
    assertEq(played, 1, 'clicking the button must play the native element once');
    for (let i = 0; i < 20; i++) { win.AnkiEngine.init(); }
    win.__flush();
    win.document.body.click();
    win.__flush();
    assertEq(win.document.querySelectorAll('.sound button.replay-button').length, 1,
      'exactly one replay button per sound after 20 re-inits and a rescan click');
    assertTrue(win.__tfAudioSkinRAF == null, 'the audio-skin rAF handle must be null after the frame flush');
  }
});

cases.push({
  name: 'tf audio: desktop cards (Anki replay anchor) get no extra button',
  fn() {
    const envAnchor = makeEnv(audioFrontHtml(
      '<a class="replay-button soundLink" href="#" onclick="return false">[sound:q.mp3]</a>'));
    envAnchor.__flush();
    assertEq(envAnchor.win.document.querySelectorAll('.sound button.replay-button').length, 0,
      'anchor-only desktop sound must get no extra button');
    const envBoth = makeEnv(audioFrontHtml(
      '<a class="replay-button soundLink" href="#" onclick="return false">[sound:q.mp3]</a>' +
      '<audio controls src="q.mp3"></audio>'));
    envBoth.__flush();
    assertEq(envBoth.win.document.querySelectorAll('.sound button.replay-button').length, 0,
      'anchor+audio desktop sound must get no extra button');
  }
});

cases.push({
  name: 'tf audio: <audio> inside a half button gets no nested button',
  fn() {
    const env = makeEnv('<!DOCTYPE html><html><head></head><body>' +
      '<div class="card-wrapper"><div class="aurora-card card-front">' +
      '<div class="card-content">' +
      '<div class="tf-row"><button class="tf-half tf-true" data-val="true">DUNG' +
      '<span class="sound"><audio controls src="q.mp3"></audio></span></button></div>' +
      '<div id="tf-rows-container"></div>' +
      '<div id="tf-verdict-container"></div>' +
      '</div>' +
      '<div id="tf-raw-data"></div>' +
      '</div></div>' +
      '<div id="settingsMenu"></div><button id="btnSettings"></button>' +
      '</body></html>');
    env.__flush();
    assertEq(env.win.document.querySelectorAll('button.replay-button').length, 0,
      'audio nested in a half <button> must not gain a nested button');
    assertEq(env.win.document.querySelectorAll('.sound audio').length, 1,
      'the nested audio element itself must stay in the DOM');
  }
});

cases.push({
  name: 'tf security: statement text that contains markup stays literal text — no innerHTML injection on front or back',
  fn() {
    const P_BOLD = '<b>bold payload</b>';
    const env = makeEnv(baseHtml('front', [
      { text: '&lt;b&gt;bold payload&lt;/b&gt;', truth: 'T' },
      { text: '&lt;img src=x onerror="window.__pwned=true"&gt;', truth: 'F' },
      { text: 'plain statement', truth: 'T' },
      { text: 'fourth statement', truth: 'F' }
    ]));
    const win = env.win;
    win.AnkiEngine.config.shuffleChoices = false;
    win.AnkiTF.initFront();
    win.__flush();
    let contents = win.document.querySelectorAll('.tf-text');
    assertTrue(win.document.querySelector('.tf-text b') === null,
      'front: <b> literal must not become a DOM node');
    assertTrue(win.document.querySelector('.tf-text img') === null,
      'front: <img> literal must not become a DOM node');
    assertEq(contents[0].textContent, P_BOLD, 'front: payload must surface as plain text');
    clickHalf(win, 0, true);
    clickHalf(win, 1, false);
    clickHalf(win, 2, true);
    clickHalf(win, 3, false);
    win.__flush();
    win.document.getElementById('tf-submit').click();
    win.__flush();
    flipToBack(win);
    win.__flush();
    contents = win.document.querySelectorAll('.tf-text');
    assertTrue(win.document.querySelector('.tf-text b') === null,
      'back: <b> literal must not become a DOM node (innerHTML sink)');
    assertTrue(win.document.querySelector('.tf-text img') === null,
      'back: <img> literal must not become a DOM node');
    assertTrue(win.document.querySelector('.tf-text script') === null,
      'back: <script> literal must not become a DOM node');
    assertEq(contents[0].textContent, P_BOLD, 'back: payload must surface as plain text');
    assertTrue(win.__pwned === undefined, 'back: payload must never execute');
    assertEq(env.tones.join(','), 'correct', 'back: the all-correct pick must still play its tone');
  }
});

cases.push({
  name: 'tf integration: preview builder resolves every template field (hyphenated fields included)',
  fn() {
    const previewPath = path.resolve(__dirname, '..', '..', 'tf', 'preview', 'preview_tf.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const tplM = source.match(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK = ("[\s\S]*?");/);
    const renderM = source.match(/(function render\(tpl, data\) \{[\s\S]*?\n\})\n\nfunction splitTemplate/);
    assertTrue(!!tplM, 'preview_tf.html must embed TPL_FRONT and TPL_BACK');
    assertTrue(!!renderM, 'preview_tf.html must embed its render() helper');
    const render = vm.runInNewContext('(' + renderM[1] + ')', {});
    const SAMPLE = {
      Question: 'Q', Audio_Question: '[audio]',
      'Statement-1': 's1', 'Answer-1': 'T',
      'Statement-2': 's2', 'Answer-2': 'F',
      'Statement-3': 's3', 'Answer-3': 'T',
      'Statement-4': 's4', 'Answer-4': 'F',
      Explanation: 'why', ID: 'ID-1', Tags_Custom: 'tag one'
    };
    [['Front', JSON.parse(tplM[1])], ['Back', JSON.parse(tplM[2])]].forEach(function (pair) {
      const out = render(pair[1], SAMPLE);
      const leftover = out.match(/\{\{[^}]+\}\}/g) || [];
      assertEq(leftover.length, 0,
        pair[0] + ' preview render must substitute every field; unresolved: ' + leftover.join(', '));
    });
  }
});

cases.push({
  name: 'tf integration: preview embeds the shipped CSS/templates/modules byte-for-byte',
  fn() {
    const previewPath = path.resolve(__dirname, '..', '..', 'tf', 'preview', 'preview_tf.html');
    const source = fs.readFileSync(previewPath, 'utf8');
    const grab = function (re, group, label) {
      const m = source.match(re);
      assertTrue(!!m, 'preview_tf.html must embed ' + label);
      return JSON.parse(m[group]);
    };
    const embedded = [
      ['Front.html', grab(/var TPL_FRONT = ("[\s\S]*?");\nvar TPL_BACK/, 1, 'TPL_FRONT')],
      ['Back.html', grab(/var TPL_BACK = ("[\s\S]*?");\nvar HNA_MODS/, 1, 'TPL_BACK')],
      ['_tf_storage.js', grab(/"storage": ("[\s\S]*?"),\n  "engine":/, 1, 'storage')],
      ['_tf_engine.js', grab(/"engine": ("[\s\S]*?"),\n  "logic":/, 1, 'engine')],
      ['_tf_logic.js', grab(/"logic": ("[\s\S]*?"),\n  "aurora":/, 1, 'logic')],
      ['_tf_aurora.js', grab(/"aurora": ("[\s\S]*?")\n\};/, 1, 'aurora')]
    ];
    const tfDir = path.resolve(__dirname, '..', '..', 'tf');
    embedded.forEach(function (pair) {
      const shipped = fs.readFileSync(path.join(tfDir, pair[0]), 'utf8');
      assertEq(pair[1], shipped,
        'preview payload for ' + pair[0] + ' must equal the shipped file byte-for-byte');
    });
    const embeddedCss = grab(/var HNA_CSS = ("[\s\S]*?");\nvar TPL_FRONT/, 1, 'HNA_CSS');
    const shippedCss = fs.readFileSync(path.join(tfDir, '_tf_styles.css'), 'utf8');
    assertTrue([shippedCss, minifyCss(shippedCss)].indexOf(embeddedCss) !== -1,
      'preview HNA_CSS must be the readable shipped sheet or its minified build');
  }
});

cases.push({
  name: 'tf integration: template injection fallback probes AnkiTF with a boot-token abort',
  fn() {
    ['Front.html', 'Back.html'].forEach(function (name) {
      const tpl = fs.readFileSync(path.join(TF_DIR, name), 'utf8');
      assertTrue(tpl.indexOf('window.__tfScriptMode') !== -1,
        name + ': no script-injection fallback (window.__tfScriptMode missing)');
      assertTrue(tpl.indexOf("typeof window.AnkiTF !== 'undefined'") !== -1,
        name + ': fallback must probe window.AnkiTF before injecting');
      assertTrue(tpl.indexOf('createElement') !== -1,
        name + ': fallback must create script nodes dynamically');
      assertTrue(tpl.indexOf("['_tf_storage.js', '_tf_engine.js', '_tf_logic.js', '_tf_aurora.js']") !== -1,
        name + ': injected file list/order must stay the tf bundle');
      assertTrue(/token !== window\.__\w*BootToken/.test(tpl),
        name + ': injection chain needs the boot-token abort');
      // Backdoor guard: init runs only when AnkiTF exists.
      assertTrue(/window\.AnkiTF && typeof AnkiTF\.init(Front|Back) === 'function'/.test(tpl),
        name + ': init call must be guarded on window.AnkiTF existing');
    });
  }
});

module.exports = cases;
