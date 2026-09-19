'use strict';
/* RAM-leak regression tests: simulate 20 card flips in one jsdom session
   and assert the resource invariants from docs/RAM_LEAK_ANALYSIS.md:
   stable listener counts, single global handles, one aurora host,
   shared decoder, lazy menu, single AudioContext, no detached refs. */

const assert = require('assert');
const { createEnv, evalModules, frontCard, backCard, flip, typeInto } = require('../harness');

const FLIPS = 20;
let env = null;
let win = null;

const cases = [];

cases.push({
  name: 'ram: env prepared',
  async: true,
  fn: async () => {
    env = await createEnv();
    win = env.win;
    evalModules(win, { instrumentDiff: true });
  }
});

cases.push({
  name: 'ram: document listener count is stable over ' + FLIPS + ' flips (keydown+click+selectionchange)',
  fn: () => {
    const counts = [];
    for (let i = 0; i < FLIPS; i++) {
      flip(win, i % 2 === 0 ? frontCard() : backCard(), { instrumentDiff: true });
      counts.push(win.__listenerCount('document'));
    }
    assert.strictEqual(new Set(counts).size, 1, 'document listener count drifted: ' + counts.join(','));
    assert.strictEqual(counts[0], 4, 'expected 4 document listeners, got ' + counts[0] + ' -> ' + JSON.stringify(win.__listenerBreakdown()));
  }
});

cases.push({
  name: 'ram: window listener count is stable over ' + FLIPS + ' flips (1 resize handler)',
  fn: () => {
    const counts = [];
    for (let i = 0; i < FLIPS; i++) {
      flip(win, i % 2 === 0 ? frontCard() : backCard(), { instrumentDiff: true });
      counts.push(win.__listenerCount('window'));
    }
    assert.strictEqual(new Set(counts).size, 1, 'window listener count drifted: ' + counts.join(','));
    const breakdown = win.__listenerBreakdown();
    // jsdom has no visualViewport, so aurora falls back to window.addEventListener('resize', scheduleSync)
    // engine no longer registers a separate window resize handler
    assert.strictEqual(breakdown['window:resize'], 1,
      'expected exactly 1 window resize handler (aurora scheduleSync), got ' + breakdown['window:resize']);
  }
});

cases.push({
  name: 'ram: no pending timers or rAF callbacks accumulate between flips',
  fn: () => {
    const timers = [];
    const rafs = [];
    for (let i = 0; i < FLIPS; i++) {
      flip(win, i % 2 === 0 ? frontCard() : backCard(), { instrumentDiff: true });
      timers.push(win.__pendingTimerCount());
      rafs.push(win.__pendingRAFCount());
    }
    assert.strictEqual(new Set(timers).size, 1, 'timer backlog grew: ' + timers.join(','));
    assert.strictEqual(new Set(rafs).size, 1, 'rAF backlog grew: ' + rafs.join(','));
  }
});

cases.push({
  name: 'ram: exactly one #hna-aurora-host, always the first child of body',
  fn: () => {
    const hosts = win.document.querySelectorAll('#hna-aurora-host');
    assert.strictEqual(hosts.length, 1, 'aurora host count: ' + hosts.length);
    assert.strictEqual(win.document.body.firstElementChild.id, 'hna-aurora-host');
  }
});

cases.push({
  name: 'ram: aurora host is repositioned per flip and not recreated by re-evaluation',
  fn: () => {
    const host = win.document.getElementById('hna-aurora-host');
    flip(win, frontCard(), { instrumentDiff: true });
    assert.strictEqual(win.document.getElementById('hna-aurora-host'), host, 'host must be the same node');
  }
});

cases.push({
  name: 'ram: aurora host syncs to the card rect (animationend re-measure)',
  fn: () => {
    const card = win.document.querySelector('.aurora-card');
    assert.ok(card, 'aurora-card missing');
    card.getBoundingClientRect = () => ({ left: 12, top: 34, width: 700, height: 500, right: 712, bottom: 534 });
    const evt = new win.Event('animationend', { bubbles: true });
    evt.animationName = 'hna-card-appear';
    card.dispatchEvent(evt);
    const host = win.document.getElementById('hna-aurora-host');
    assert.strictEqual(host.style.left, '12px');
    assert.strictEqual(host.style.top, '34px');
    assert.strictEqual(host.style.width, '700px');
    assert.strictEqual(host.style.height, '500px');
    assert.ok(host.classList.contains('hna-aurora-visible'));
  }
});

cases.push({
  name: 'ram: aurora host translates the rect into body content coords (body is the scroll container)',
  fn: () => {
    flip(win, frontCard(), { instrumentDiff: true });
    const card = win.document.querySelector('.aurora-card');
    assert.ok(card, 'aurora-card missing');
    const body = win.document.body;
    const origBodyRect = body.getBoundingClientRect;
    card.getBoundingClientRect = () => ({ left: 10, top: 130, width: 500, height: 700, right: 510, bottom: 830 });
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 });
    body.scrollTop = 100;
    const evt = new win.Event('animationend', { bubbles: true });
    evt.animationName = 'hna-card-appear';
    card.dispatchEvent(evt);
    const host = win.document.getElementById('hna-aurora-host');
    assert.strictEqual(host.style.left, '10px');
    assert.strictEqual(host.style.top, '230px',
      'viewport rect must become body content coords: rect.top - bodyRect.top + body.scrollTop');
    assert.strictEqual(host.style.width, '500px');
    assert.strictEqual(host.style.height, '700px');
    body.scrollTop = 0;
    body.getBoundingClientRect = origBodyRect;
  }
});

cases.push({
  name: 'ram: typed-answer buffer and storage handles reset per flip (BUG-005 regression)',
  fn: () => {
    flip(win, frontCard(), { instrumentDiff: true });
    typeInto(win, 'katt');
    assert.strictEqual(win.__hnaTypedAnswerBuffer, 'katt');
    flip(win, backCard(), { instrumentDiff: true });
    assert.strictEqual(win.__hnaPrevCardRoot, null, 'teardown must null the previous root');
    assert.strictEqual(win.__hnaActiveTypeansInput, null, 'active input must reset on back face');
    assert.strictEqual(win.__hnaScheduleTypeansUpdate, null, 'schedule handle must reset per flip');
  }
});

cases.push({
  name: 'ram: decoder textarea is created once and stays detached (no per-flip DOM growth)',
  fn: () => {
    const decoder = win.AnkiEngine.__decoder;
    assert.ok(decoder && decoder.tagName === 'TEXTAREA', 'shared decoder missing');
    for (let i = 0; i < 10; i++) {
      win.AnkiEngine.decodeHTML('&auml;');
      flip(win, i % 2 === 0 ? frontCard() : backCard(), { instrumentDiff: true });
      win.AnkiEngine.decodeHTML('&ouml;');
    }
    assert.strictEqual(win.AnkiEngine.__decoder, decoder, 'decoder node must be reused across flips');
    assert.strictEqual(win.document.querySelectorAll('textarea').length, 0,
      'decoder must never leak into the DOM (RAM regression)');
  }
});

cases.push({
  name: 'ram: settings menu stays empty until first open, single build afterwards',
  fn: () => {
    const menu = win.document.getElementById('settingsMenu');
    assert.ok(menu);
    assert.strictEqual(menu.children.length, 0, 'menu must stay empty (lazy)');
    win.AnkiEngine.toggleSettings();
    const once = menu.querySelectorAll('.menu-item').length;
    assert.strictEqual(once, win.AnkiEngine.MENU_SPEC.length);
    flip(win, frontCard(), { instrumentDiff: true });
    assert.strictEqual(menu.querySelectorAll('.menu-item').length, once, 're-flip must not rebuild menu');
  }
});

cases.push({
  name: 'ram: single AudioContext across all flips and tone plays (no close/recreate)',
  fn: () => {
    win.AnkiAudio.playTone('correct');
    win.AnkiAudio.playTone('wrong');
    assert.strictEqual(win.__audioCtxCount, 1, 'AudioContext must be created once per session');
    assert.ok(win.AnkiAudio.ctx, 'session context missing');
  }
});

cases.push({
  name: 'ram: resize guards use single handles (no multiply-bound observers)',
  fn: () => {
    win.dispatchEvent(new win.Event('resize'));
    win.__flushTimers();
    win.__flushRAF();
    const breakdown = win.__listenerBreakdown();
    assert.strictEqual(breakdown['window:resize'], 1, 'resize must not re-bind');
    const ro = win.__hnaAuroraRO;
    assert.ok(ro, 'aurora ResizeObserver handle missing');
    assert.strictEqual(ro.observed.length, 1, 'observer must watch exactly the current card');
  }
});

cases.push({
  name: 'ram: flip churn — 20 flips leave no detached node refs in globals',
  fn: () => {
    for (let i = 0; i < FLIPS; i++) {
      flip(win, i % 2 === 0 ? frontCard() : backCard(), { instrumentDiff: true });
    }
    assert.strictEqual(win.__hnaPrevCardRoot, null);
    assert.strictEqual(win.__hnaActiveTypeansInput, null);
    assert.ok(!win.__hnaTeardownObserver, 'teardown observer handle must be released');
    assert.strictEqual(win.document.querySelectorAll('#hna-aurora-host').length, 1);
    assert.strictEqual(win.document.querySelectorAll('textarea').length, 0, 'decoder must stay detached');
  }
});

cases.push({
  name: 'ram: window resize re-syncs the aurora host to the card rect',
  fn: () => {
    flip(win, frontCard(), { instrumentDiff: true });
    const card = win.document.querySelector('.aurora-card');
    assert.ok(card, 'aurora-card missing');
    card.getBoundingClientRect = () => ({ left: 5, top: 60, width: 640, height: 480, right: 645, bottom: 540 });
    win.dispatchEvent(new win.Event('resize'));
    win.__flushTimers();
    win.__flushRAF();
    const host = win.document.getElementById('hna-aurora-host');
    assert.strictEqual(host.style.left, '5px');
    assert.strictEqual(host.style.top, '60px');
    assert.strictEqual(host.style.width, '640px');
    assert.strictEqual(host.style.height, '480px');
    assert.strictEqual(win.document.querySelectorAll('#hna-aurora-host').length, 1,
      'resize must never recreate the aurora host');
  }
});

cases.push({
  name: 'ram: engine applyConfig collapses multiple rapid calls into one rAF pass',
  fn: () => {
    flip(win, frontCard(), { instrumentDiff: true });
    const origApplyMap = win.AnkiEngine._applyToggleMap;
    let calls = 0;
    win.AnkiEngine._applyToggleMap = function () { calls++; return origApplyMap.apply(this, arguments); };
    try {
      for (let i = 0; i < 5; i++) win.AnkiEngine.applyConfig();
      win.__flushRAF();
      assert.strictEqual(calls, 1, '5 rapid applyConfig calls must collapse into 1 _applyToggleMap via rAF, got ' + calls);
    } finally {
      win.AnkiEngine._applyToggleMap = origApplyMap;
    }
  }
});

cases.push({
  name: 'ram: front card DOM node count stays under budget after 250 typed chars',
  fn: () => {
    flip(win, frontCard(), { instrumentDiff: true });
    typeInto(win, 'x'.repeat(250));
    const qa = win.document.getElementById('qa');
    const totalNodes = qa.querySelectorAll('*').length;
    const overlaySpans = qa.querySelectorAll('#typeans-overlay span[class^="char-"]').length;
    assert.ok(totalNodes < 1500, 'total nodes in #qa must stay under 1500 after 250 typed chars, got ' + totalNodes);
    assert.ok(overlaySpans >= 250, 'overlay must keep one span per typed char, got ' + overlaySpans);
    assert.ok(overlaySpans <= 250 + 16, 'overlay must not balloon past ~1 span per char + slack, got ' + overlaySpans);
  }
});

cases.push({
  name: 'ram: typing churn across 8 flips keeps listeners/timers/rAF stable',
  fn: () => {
    const timers = [];
    const rafs = [];
    const docs = [];
    for (let i = 0; i < 8; i++) {
      flip(win, frontCard(), { instrumentDiff: true });
      typeInto(win, 'kat');
      win.__flushTimers();
      win.__flushRAF();
      typeInto(win, 'katt');
      win.__flushTimers();
      win.__flushRAF();
      timers.push(win.__pendingTimerCount());
      rafs.push(win.__pendingRAFCount());
      docs.push(win.__listenerCount('document'));
    }
    assert.strictEqual(new Set(timers).size, 1, 'timer backlog grew with typing: ' + timers.join(','));
    assert.strictEqual(new Set(rafs).size, 1, 'rAF backlog grew with typing: ' + rafs.join(','));
    assert.strictEqual(new Set(docs).size, 1, 'document listeners grew with typing: ' + docs.join(','));
  }
});

module.exports = cases;
