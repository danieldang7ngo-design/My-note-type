/* ============================================================
   UNIT TESTS FOR TF LOGIC (True-False note type)
   Zero-framework runner compatible: must export [{name, fn}]
   Covers: normalizeTruth, grade mapping, shuffle, state TTL/sig.
   ============================================================ */

var assert = require('assert');

// Minimal browser globals for module load (functions touch the DOM lazily).
global.window = global.window || {};
global.document = global.document || {
  querySelectorAll: function () { return []; },
  getElementById: function () { return null; },
  addEventListener: function () {},
  removeEventListener: function () {},
  documentElement: { classList: { add: function () {} } },
  createElement: function () { throw new Error('no DOM in unit test'); }
};

// sessionStorage + storage helpers for state round-trip tests.
var __store = {};
global.sessionStorage = {
  getItem: function (k) { return __store.hasOwnProperty(k) ? __store[k] : null; },
  setItem: function (k, v) { __store[k] = String(v); },
  removeItem: function (k) { delete __store[k]; }
};
global.safeSet = function (k, v) { __store[k] = String(v); return true; };
global.safeGet = function (k) { return __store.hasOwnProperty(k) ? __store[k] : null; };
global.pycmd = function () {};

require('../../tf/_tf_logic.js');
var AnkiTF = global.window.AnkiTF;

function clearStore() {
  Object.keys(__store).forEach(function (k) { delete __store[k]; });
  global.window.__hnaTFState = null;
}

function sampleItems() {
  return [
    { origIndex: 0, text: 'Mot', truth: true },
    { origIndex: 1, text: 'Hai', truth: false },
    { origIndex: 2, text: 'Ba', truth: true },
    { origIndex: 3, text: 'Bon', truth: false }
  ];
}

module.exports = [
  {
    name: 'tfLogic: templates carry the four Statement/Answer slots',
    fn: function () {
      var fs = require('fs');
      ['Front.html', 'Back.html'].forEach(function (file) {
        var template = fs.readFileSync(require('path').join(__dirname, '../../tf', file), 'utf8');
        ['Statement-1', 'Statement-2', 'Statement-3', 'Statement-4',
         'Answer-1', 'Answer-2', 'Answer-3', 'Answer-4'].forEach(function (f) {
          assert(template.indexOf('{{' + f + '}}') !== -1, file + ' must reference {{' + f + '}}');
        });
        assert(template.indexOf('class="tf-raw-item"') !== -1, file + ' must have .tf-raw-item fallback nodes');
        assert(template.indexOf("data-tf=\"{{Answer-1}}\"") !== -1, file + ' raw item 1 must bind Answer-1 via data-tf');
      });
    }
  },
  {
    name: 'tfLogic: normalizeTruth maps every documented true token',
    fn: function () {
      ['T', 'TRUE', '1', 'D', 'Đ', 'ĐÚNG', 'Y', 'YES', '+',
       't', 'true', 'd', 'đúng', 'y', 'yes', '  T  '].forEach(function (tok) {
        assert.strictEqual(AnkiTF.normalizeTruth(tok), true, JSON.stringify(tok) + ' must be true');
      });
    }
  },
  {
    name: 'tfLogic: normalizeTruth maps every documented false token',
    fn: function () {
      ['F', 'FALSE', '0', 'S', 'SAI', 'N', 'NO', '-',
       'f', 'false', 'sai', 'n', 'no', '  F  '].forEach(function (tok) {
        assert.strictEqual(AnkiTF.normalizeTruth(tok), false, JSON.stringify(tok) + ' must be false');
      });
    }
  },
  {
    name: 'tfLogic: normalizeTruth returns null for empty, invalid for unknown',
    fn: function () {
      assert.strictEqual(AnkiTF.normalizeTruth(''), null, 'empty must be null (slot bo qua)');
      assert.strictEqual(AnkiTF.normalizeTruth('   '), null, 'blank must be null');
      assert.strictEqual(AnkiTF.normalizeTruth(null), null, 'null must be null');
      assert.strictEqual(AnkiTF.normalizeTruth(undefined), null, 'undefined must be null');
      ['X', 'maybe', '2', 'TRUEE', 'DUNG?'].forEach(function (tok) {
        assert.strictEqual(AnkiTF.normalizeTruth(tok), 'invalid', JSON.stringify(tok) + ' must be invalid (fail-closed)');
      });
    }
  },
  {
    name: 'tfLogic: grade maps correct/wrong/skipped per statement',
    fn: function () {
      var g = AnkiTF.grade(sampleItems(), { 0: true, 1: true, 3: false });
      assert.strictEqual(g.results[0].state, 'correct');
      assert.strictEqual(g.results[0].chosen, true);
      assert.strictEqual(g.results[1].state, 'wrong', 'truth false, chose true -> wrong');
      assert.strictEqual(g.results[1].chosen, true);
      assert.strictEqual(g.results[2].state, 'skipped', 'no answer -> skipped');
      assert.strictEqual(g.results[2].chosen, null);
      assert.strictEqual(g.results[3].state, 'correct');
      assert.strictEqual(g.total, 4);
      assert.strictEqual(g.correct, 2);
      assert.strictEqual(g.wrong, 1);
      assert.strictEqual(g.skipped, 1);
      assert.strictEqual(g.overall, false, 'partial answer is never overall');
    }
  },
  {
    name: 'tfLogic: overall is true only when every statement is correct',
    fn: function () {
      var full = AnkiTF.grade(sampleItems(), { 0: true, 1: false, 2: true, 3: false });
      assert.strictEqual(full.overall, true, 'all correct must be overall');
      assert.strictEqual(full.wrong, 0);
      assert.strictEqual(full.skipped, 0);
      var oneWrong = AnkiTF.grade(sampleItems(), { 0: true, 1: true, 2: true, 3: false });
      assert.strictEqual(oneWrong.overall, false, 'one wrong kills overall');
      var oneBlank = AnkiTF.grade(sampleItems(), { 0: true, 1: false, 2: true });
      assert.strictEqual(oneBlank.overall, false, 'one skipped kills overall');
    }
  },
  {
    name: 'tfLogic: wrongList is sorted by origIndex (de order)',
    fn: function () {
      var g = AnkiTF.grade(sampleItems(), { 3: true, 0: false });
      var order = g.wrongList.map(function (w) { return w.origIndex; });
      assert.deepStrictEqual(order, [0, 1, 2, 3], 'wrongList must follow de order, got ' + order.join(','));
    }
  },
  {
    name: 'tfLogic: shuffleOrder is a permutation; shuffleChoices=false keeps order',
    fn: function () {
      var seen = {};
      for (var i = 0; i < 50; i++) {
        var o = AnkiTF.shuffleOrder(4);
        assert.strictEqual(o.length, 4);
        var sorted = o.slice().sort();
        assert.deepStrictEqual(sorted, [0, 1, 2, 3], 'shuffle must be a permutation');
        seen[o.join(',')] = true;
      }
      // Default config (no engine) shuffles: over 50 draws more than one
      // distinct order should appear (probability of all-identical ~ 4!/4!^50).
      // (No hard assertion on randomness shape; permutation is the contract.)
      global.window.AnkiEngine = { config: { shuffleChoices: false } };
      try {
        assert.deepStrictEqual(AnkiTF.shuffleOrder(4), [0, 1, 2, 3],
          'shuffleChoices=false must preserve the de order');
      } finally {
        delete global.window.AnkiEngine;
      }
    }
  },
  {
    name: 'tfLogic: state round-trips through save/load',
    fn: function () {
      clearStore();
      var items = sampleItems();
      var sig = AnkiTF.computationSig('Q?', items);
      var now = Date.now();
      AnkiTF.saveState({
        v: 1, sig: sig, order: [2, 0, 3, 1],
        answers: { 0: true, 2: false },
        submittedAt: now, expiresAt: now + 5 * 60 * 1000
      });
      var st = AnkiTF.loadState('Q?', items);
      assert(st, 'valid state must load');
      assert.deepStrictEqual(st.order, [2, 0, 3, 1]);
      assert.deepStrictEqual(st.answers, { 0: true, 2: false });
      clearStore();
    }
  },
  {
    name: 'tfLogic: invalid sig / expired / non-permutation states are rejected',
    fn: function () {
      clearStore();
      var items = sampleItems();
      var now = Date.now();
      function save(st) {
        AnkiTF.saveState({
          v: 1, sig: AnkiTF.computationSig('Q?', items),
          order: [0, 1, 2, 3], answers: {},
          submittedAt: now, expiresAt: now + 5 * 60 * 1000
        });
        var cur = global.window.__hnaTFState;
        Object.keys(st).forEach(function (k) { cur[k] = st[k]; });
        global.safeSet('hna-tf-state', JSON.stringify(cur));
      }
      save({ sig: 'tampered' });
      assert.strictEqual(AnkiTF.loadState('Q?', items), null, 'tampered sig must be rejected');
      save({ sig: AnkiTF.computationSig('Q?', items), expiresAt: now - 1 });
      assert.strictEqual(AnkiTF.loadState('Q?', items), null, 'expired state must be rejected');
      save({ expiresAt: now + 60000, order: [0, 1, 1, 3] });
      assert.strictEqual(AnkiTF.loadState('Q?', items), null, 'non-permutation order must be rejected');
      save({ expiresAt: now + 60000, order: [0, 1, 2] });
      assert.strictEqual(AnkiTF.loadState('Q?', items), null, 'short order must be rejected');
      save({ expiresAt: now + 60000, order: [0, 1, 2, 3], v: 2 });
      assert.strictEqual(AnkiTF.loadState('Q?', items), null, 'unknown version must be rejected');
      clearStore();
    }
  },
  {
    name: 'tfLogic: initFront clears the previous state (no stale verdict after refresh)',
    fn: function () {
      clearStore();
      // Simulate jsdom-less initFront guard: with no #tf-rows-container the
      // function must still clear state first and return without throwing.
      global.sessionStorage.setItem('hna-tf-state', JSON.stringify({ v: 1 }));
      global.window.__hnaTFState = { v: 1 };
      var threw = null;
      try { AnkiTF.initFront(); } catch (e) { threw = e; }
      assert.strictEqual(threw, null, 'initFront without a container must not throw');
      assert.strictEqual(global.window.__hnaTFState, null, 'initFront must clear in-memory state');
      assert.strictEqual(global.sessionStorage.getItem('hna-tf-state'), null,
        'initFront must clear sessionStorage state');
    }
  }
];
