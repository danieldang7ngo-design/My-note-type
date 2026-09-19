'use strict';
/* Unit tests for the Levenshtein diff engine (_hna_diff.js internals).
   Real API (from the shipped source):
     computeDiff(t, c) -> { t: [{char, type}], c: [{char, type}] }
       typed-side types:  correct | sub-wrong | extra | missing-gap
       correct-side types: correct | sub-correct | sub-error | missed
     levenshteinDistance(t, c) -> number
     levenshteinDiff(t, c, tLo, cLo) -> same shape as computeDiff
*/

const assert = require('assert');
const { createEnv, evalModules, backCard, flip } = require('../harness');

let internals = null;
let env = null;

const DIST_CASES = [
  ['', '', 0],
  ['a', '', 1],
  ['', 'a', 1],
  ['a', 'a', 0],
  ['ab', 'ba', 2],
  ['kitten', 'sitting', 3],
  ['flaw', 'lawn', 2],
  ['intention', 'execution', 5],
  ['katt', 'katt', 0],
  ['katt', 'katter', 2],
  ['lång', 'lang', 1]
];

const cases = [];

cases.push({
  name: 'diff: prepare env with diff internals exposed',
  async: true,
  fn: async () => {
    env = await createEnv();
    evalModules(env.win, { instrumentDiff: true });
    internals = env.win.__hnaDiffInternals;
    assert.ok(internals, 'internals not exposed');
    assert.strictEqual(typeof internals.levenshteinDistance, 'function');
    assert.strictEqual(typeof internals.levenshteinDiff, 'function');
    assert.strictEqual(typeof internals.computeDiff, 'function');
    assert.strictEqual(typeof internals.computeVerdict, 'function', 'semantic verdict model must be exposed');
  }
});

DIST_CASES.forEach(([a, b, expected]) => {
  cases.push({
    name: 'diff: levenshteinDistance("' + a + '", "' + b + '") === ' + expected,
    fn: () => {
      assert.strictEqual(internals.levenshteinDistance(a, b), expected);
      assert.strictEqual(internals.levenshteinDistance(b, a), expected, 'must be symmetric');
    }
  });
});

cases.push({
  name: 'diff: computeDiff identical strings — all correct, no errors',
  fn: () => {
    const d = internals.computeDiff('katt', 'katt');
    assert.strictEqual(d.t.length, 4);
    assert.ok(d.t.every((p) => p.type === 'correct'), 'typed side: ' + d.t.map((p) => p.type).join(','));
    assert.ok(d.c.every((p) => p.type === 'correct'), 'correct side: ' + d.c.map((p) => p.type).join(','));
  }
});

cases.push({
  name: 'diff: computeDiff spots a single substituted letter (katt vs kant)',
  fn: () => {
    const d = internals.computeDiff('katt', 'kant');
    assert.strictEqual(d.t.map((p) => p.type).join(','), 'correct,correct,sub-wrong,correct', 'typed side: ' + d.t.map((p) => p.type).join(','));
    assert.strictEqual(d.c.map((p) => p.type).join(','), 'correct,correct,sub-correct,correct', 'correct side: ' + d.c.map((p) => p.type).join(','));
  }
});

cases.push({
  name: 'diff: computeDiff flags an extra typed char at the end',
  fn: () => {
    const d = internals.computeDiff('kattx', 'katt');
    assert.strictEqual(d.t.length, 5);
    assert.strictEqual(d.t[4].char, 'x');
    assert.strictEqual(d.t[4].type, 'extra');
    assert.strictEqual(d.c[4].type, 'sub-error');
  }
});

cases.push({
  name: 'diff: computeDiff flags a missed letter (kat vs katt)',
  fn: () => {
    const d = internals.computeDiff('kat', 'katt');
    assert.strictEqual(d.c.filter((p) => p.type === 'missed').length, 1, 'one missed char on correct side');
    assert.strictEqual(d.t.filter((p) => p.type === 'missing-gap').length, 1, 'one gap on typed side');
    const gapIdx = d.t.findIndex((p) => p.type === 'missing-gap');
    assert.strictEqual(d.c[gapIdx].char, 't');
  }
});

cases.push({
  name: 'diff: computeDiff empty inputs',
  fn: () => {
    const empty = internals.computeDiff('', '');
    assert.strictEqual(empty.t.length, 0);
    assert.strictEqual(empty.c.length, 0);
    const a = internals.computeDiff('a', '');
    assert.strictEqual(a.t.length, 1);
    assert.strictEqual(a.t[0].type, 'extra');
    const b = internals.computeDiff('', 'a');
    assert.strictEqual(b.c.length, 1);
    assert.strictEqual(b.c[0].type, 'missed');
    assert.strictEqual(b.t[0].type, 'missing-gap');
  }
});

cases.push({
  name: 'diff: computeDiff unicode (ä) treated as one unit, not bytes',
  fn: () => {
    const d = internals.computeDiff('hänga', 'hänga');
    assert.strictEqual(d.t.length, 5);
    assert.ok(d.t.every((p) => p.type === 'correct'));
  }
});

cases.push({
  name: 'diff: computeDiff case-insensitive matching (Katt vs katt is exact)',
  fn: () => {
    const d = internals.computeDiff('Katt', 'katt');
    assert.strictEqual(d.t.length, 4);
    assert.ok(d.t.every((p) => p.type === 'correct'), 'backtrace matches on lowercase');
  }
});

cases.push({
  name: 'diff: levenshteinDiff returns the same shape as computeDiff',
  fn: () => {
    const d = internals.levenshteinDiff('katt', 'kant', 'katt', 'kant');
    assert.strictEqual(d.t.length, 4);
    assert.strictEqual(typeof d.c[0].type, 'string');
  }
});

cases.push({
  name: 'diff e2e: exact typed answer renders the correct verdict with typed row hidden',
  fn: () => {
    env.win.__hnaTypedAnswerBuffer = 'katt';
    flip(env.win, backCard(), { instrumentDiff: true });
    const container = env.win.document.getElementById('visual-diff-container');
    assert.ok(container.classList.contains('verdict-pop-correct'), 'expected verdict-pop-correct');
    const inputSec = env.win.document.getElementById('diff-section-input');
    assert.strictEqual(inputSec.style.display, 'none', 'typed row must be hidden on exact match');
    const rowC = env.win.document.getElementById('diff-correct-row');
    assert.strictEqual(rowC.className.indexOf('diff-tint-correct') !== -1, true);
    const labelC = env.win.document.querySelector('#diff-section-correct .diff-row-label');
    assert.strictEqual(labelC.textContent, 'Exakt!');
  }
});

cases.push({
  name: 'diff e2e: case-insensitive exact match ("Katt" typed vs "katt" correct) is CORRECT verdict + "Exakt!" + correct tone',
  fn: () => {
    const origTone = env.win.AnkiAudio.playTone;
    let lastTone = null;
    env.win.AnkiAudio.playTone = function (t) { lastTone = t; };
    try {
      env.win.__hnaTypedAnswerBuffer = 'Katt';
      flip(env.win, backCard(), { instrumentDiff: true });
      const container = env.win.document.getElementById('visual-diff-container');
      assert.strictEqual(lastTone, 'correct', 'the verdict tone must be "correct" for a case-insensitive exact match');
      assert.ok(container.classList.contains('verdict-pop-correct'), 'expected verdict-pop-correct for "Katt" vs "katt"');
      assert.strictEqual(env.win.document.getElementById('diff-section-input').style.display, 'none',
        'typed row must be hidden on exact match');
      const labelC = env.win.document.querySelector('#diff-section-correct .diff-row-label');
      assert.strictEqual(labelC.textContent, 'Exakt!', 'label must be "Exakt!"');
    } finally {
      env.win.AnkiAudio.playTone = origTone;
    }
  }
});

cases.push({
  name: 'diff e2e: short-answer omission gets near-miss ("kat" vs "katt" is never "Exakt!")',
  fn: () => {
    env.win.__hnaTypedAnswerBuffer = 'kat';
    flip(env.win, backCard(), { instrumentDiff: true });
    const container = env.win.document.getElementById('visual-diff-container');
    assert.ok(!container.classList.contains('verdict-pop-correct'), '"kat" must not be verdict-pop-correct');
    const labelC = env.win.document.querySelector('#diff-section-correct .diff-row-label');
    assert.notStrictEqual(labelC.textContent, 'Exakt!', 'a distance-1 miss must not claim an exact match');
    assert.ok(container.classList.contains('verdict-pop-near-miss'),
      'a one-character omission receives soft near-miss feedback (single edit, not a full error)');
  }
});

cases.push({
  name: 'diff e2e: wrong typed answer renders typed/correct diff rows with wrong verdict',
  fn: () => {
    env.win.__hnaTypedAnswerBuffer = 'hund';
    flip(env.win, backCard(), { instrumentDiff: true });
    const container = env.win.document.getElementById('visual-diff-container');
    assert.ok(container.classList.contains('verdict-pop-wrong'), 'expected verdict-pop-wrong for distance 4');
    const rowT = env.win.document.getElementById('diff-input-row');
    const rowC = env.win.document.getElementById('diff-correct-row');
    assert.ok(rowT.className.indexOf('diff-row-typed') !== -1, 'typed row class');
    assert.strictEqual(rowT.querySelectorAll('span.dt-wrong').length, 4, 'all 4 typed chars wrong');
    assert.strictEqual(rowC.querySelectorAll('span.dc-wrong').length, 4, 'all 4 correct chars highlighted');
    const labelC = env.win.document.querySelector('#diff-section-correct .diff-row-label');
    assert.strictEqual(labelC.textContent, 'Det korrekta svaret');
  }
});

cases.push({
  name: 'diff e2e: proportionate typo gets verdict-pop-near-miss',
  fn: () => {
    env.win.__hnaTypedAnswerBuffer = 'katt';
    flip(env.win, backCard(), { instrumentDiff: true });
    env.win.__hnaTypedAnswerBuffer = 'fagel'; /* one edit in a five-character answer */
    flip(env.win, backCard(Object.assign({}, { word: 'fågel' })), { instrumentDiff: true });
    const container = env.win.document.getElementById('visual-diff-container');
    assert.ok(container.classList.contains('verdict-pop-near-miss'), 'expected near-miss for a proportionate one-character typo');
  }
});

cases.push({
  name: 'diff e2e: empty typed answer is neutral and hides the typed row',
  fn: () => {
    const origTone = env.win.AnkiAudio.playTone;
    let toneCalls = 0;
    env.win.AnkiAudio.playTone = function () { toneCalls++; };
    try {
      env.win.__hnaTypedAnswerBuffer = '';
      flip(env.win, backCard(), { instrumentDiff: true });
      const container = env.win.document.getElementById('visual-diff-container');
      assert.ok(!container.classList.contains('verdict-pop-wrong'), 'no answer must not receive punitive feedback');
      assert.strictEqual(toneCalls, 0, 'no answer must not play a wrong-answer tone');
      assert.strictEqual(env.win.document.getElementById('diff-section-input').style.display, 'none');
    } finally {
      env.win.AnkiAudio.playTone = origTone;
    }
  }
});

// Real production scenario: a learner drops the diacritic on a Swedish word.
// One-char substitutions must align as exactly one sub-wrong/sub-correct pair
// — never a missed+extra cascade that would blame two characters for one typo.
const SWEDISH_NEAR_MISSES = [
  ['fågel', 'fagel'],
  ['lång', 'lang'],
  ['lätt', 'latt']
];

SWEDISH_NEAR_MISSES.forEach(([typed, correct]) => {
  cases.push({
    name: 'diff: backtrace alignment on Swedish near-miss (' + typed + ' vs ' + correct + ')',
    fn: () => {
      const d = internals.computeDiff(typed, correct);
      assert.strictEqual(d.t.length, d.c.length, 'typed and correct sides must align to equal length');
      assert.strictEqual(d.t.filter((p) => p.type === 'sub-wrong').length, 1,
        'typed side: exactly one sub-wrong for the diacritic substitution');
      assert.strictEqual(d.c.filter((p) => p.type === 'sub-correct').length, 1,
        'correct side: exactly one sub-correct');
      assert.strictEqual(d.t.filter((p) => p.type === 'extra').length, 0, 'no extra typed chars');
      assert.strictEqual(d.t.filter((p) => p.type === 'missing-gap').length, 0, 'no gaps on the typed side');
      assert.strictEqual(d.c.filter((p) => p.type === 'missed').length, 0, 'no missed chars on the correct side');
      assert.strictEqual(d.c.filter((p) => p.type === 'sub-error').length, 0, 'no sub-error fillers on the correct side');
      assert.strictEqual(d.distance, 1, 'a one-character diacritic substitution must cost exactly 1');
    }
  });
});

cases.push({
  name: 'diff: prefix alignment — "ett" typed against a phrase matches the leading word, not the tail',
  fn: () => {
    const d = internals.computeDiff('ett', 'ett kontakt två kontakt');
    // The forward backtrace must align the typed string to the START of the
    // correct answer: "ett" correct, everything after missed. A backward walk
    // used to match the trailing "t" of "kontakt" and flagged only "e" +
    // late "t"s as correct.
    const typedOk = d.t.map((p) => p.type);
    const correctOk = d.c.map((p) => p.type);
    assert.strictEqual(typedOk[0], 'correct', 'first typed char aligns to the leading word');
    assert.strictEqual(typedOk[1], 'correct', 'second typed char aligns to the leading word');
    assert.strictEqual(typedOk[2], 'correct', 'third typed char aligns to the leading word');
    assert.strictEqual(d.t.filter((p) => p.type === 'correct').length, 3,
      'exactly the 3 chars of "ett" match');
    assert.strictEqual(d.c.filter((p) => p.type === 'correct').length, 3,
      'the correct side matches exactly "ett"');
    assert.strictEqual(d.c.filter((p) => p.type === 'missed').length, 20,
      'the remaining 20 phrase chars are missed, not wrongly matched');
    assert.strictEqual(d.t.filter((p) => p.type === 'extra').length, 0,
      'no extra typed chars');
    assert.strictEqual(d.t.filter((p) => p.type === 'sub-wrong').length, 0,
      'no substitutions');
  }
});

cases.push({
  name: 'diff: computeDiff distance field is always a number >= 0',
  fn: () => {
    const pairs = [
      ['', ''], ['a', 'a'], ['', 'a'], ['a', ''],
      ['katt', 'katt'], ['katt', 'kant'], ['katt', 'katter'],
      ['hänga', 'hänga'], ['fågel', 'fagel'], ['kitten', 'sitting']
    ];
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i][0], b = pairs[i][1];
      const d = internals.computeDiff(a, b);
      const label = JSON.stringify([a, b]);
      assert.strictEqual(typeof d.distance, 'number', 'distance must be a number for ' + label);
      assert.ok(d.distance >= 0, 'distance must be >= 0 for ' + label + ', got ' + d.distance);
      assert.strictEqual(d.distance, internals.levenshteinDistance(a, b),
        'distance field must equal levenshteinDistance for ' + label);
    }
  }
});

// ---- Phase 2: semantic verdict model -------------------------------------
// Differential cases: every (typed, correct) pair must map to a unique,
// well-formed verdict and the status must agree with the true Levenshtein
// distance. These pin the disclosure contract (which rows show), so a future
// copy/UX change cannot silently change what the Back face reveals.

const VERDICT_CASES = [
  {
    typed: 'katt', correct: 'katt',
    status: 'correct', exact: true, distance: 0, messageKey: 'label-exact',
    showTypedAnswer: false, showDiff: false
  },
  {
    typed: 'Katt', correct: 'katt',
    status: 'correct', exact: true, distance: 0, messageKey: 'label-exact',
    showTypedAnswer: false, showDiff: false,
    note: 'case-insensitive exact match (BUG-027): the overlay paints "Katt" all-correct, so the verdict must too'
  },
  {
    typed: '', correct: 'katt',
    status: 'unanswered', exact: false, distance: 4, messageKey: 'label-answer',
    showTypedAnswer: false, showDiff: false
  },
  {
    typed: '', correct: '',
    status: 'unanswered', exact: false, distance: 0, messageKey: 'label-answer',
    showTypedAnswer: false, showDiff: false,
    note: 'empty answer dominates; an empty card still reads unanswered, not correct'
  },
  {
    typed: 'kat', correct: 'katt',
    status: 'near-miss', exact: false, distance: 1, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true
  },
  {
    typed: 'katter', correct: 'katt',
    status: 'wrong', exact: false, distance: 2, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true,
    note: 'two edits on a short answer are a meaningful error, not a near-miss'
  },
  {
    typed: 'sprak', correct: 'språk',
    status: 'near-miss', exact: false, distance: 1, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true,
    note: 'a one-character typo remains a near-miss'
  },
  {
    typed: 'ab', correct: 'abcd',
    status: 'wrong', exact: false, distance: 2, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true,
    note: 'a 50% error rate must not receive near-miss feedback'
  },
  {
    typed: 'abcdefghijklmnopqrst', correct: 'abcdefghijklmnopqrzz',
    status: 'near-miss', exact: false, distance: 2, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true,
    note: 'two edits across a long answer are a small typo'
  },
  {
    typed: 'fagel', correct: 'fågel',
    status: 'near-miss', exact: false, distance: 1, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true,
    note: 'a dropped Swedish diacritic is one edit, not a cascade'
  },
  {
    typed: 'hund', correct: 'katt',
    status: 'wrong', exact: false, distance: 4, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true
  },
  {
    typed: 'x', correct: 'katt',
    status: 'wrong', exact: false, distance: 4, messageKey: 'label-answer',
    showTypedAnswer: true, showDiff: true
  }
];

VERDICT_CASES.forEach((tc) => {
  cases.push({
    name: 'diff: computeVerdict(' + JSON.stringify(tc.typed) + ' vs ' + JSON.stringify(tc.correct) + ') -> ' + tc.status,
    fn: () => {
      const v = internals.computeVerdict(tc.typed, tc.correct);
      assert.strictEqual(v.status, tc.status, 'status for ' + JSON.stringify([tc.typed, tc.correct]));
      assert.strictEqual(v.exact, tc.exact, 'exact for ' + tc.note || '');
      assert.strictEqual(v.distance, tc.distance, 'distance (Levenshtein) for ' + JSON.stringify([tc.typed, tc.correct]));
      assert.strictEqual(v.messageKey, tc.messageKey, 'messageKey');
      assert.strictEqual(v.showTypedAnswer, tc.showTypedAnswer, 'showTypedAnswer disclosure');
      assert.strictEqual(v.showDiff, tc.showDiff, 'showDiff disclosure');
    }
  });
});

cases.push({
  name: 'diff: verdict status is consistent with the true edit distance (differential)',
  fn: () => {
    const pairs = [
      ['', ''], ['a', ''], ['', 'a'],
      ['katt', 'katt'], ['Katt', 'katt'], ['kat', 'katt'], ['katt', 'katter'],
      ['fågel', 'fagel'], ['lång', 'lang'], ['lätt', 'latt'],
      ['hund', 'katt'], ['ett', 'ett kontakt två kontakt'],
      ['kitten', 'sitting'], ['intention', 'execution'], ['flaw', 'lawn']
    ];
    for (let i = 0; i < pairs.length; i++) {
      const typed = pairs[i][0], correct = pairs[i][1];
      const v = internals.computeVerdict(typed, correct);
      const d = internals.levenshteinDistance(typed.toLowerCase(), correct.toLowerCase());
      assert.strictEqual(v.distance, d, 'distance must equal levenshteinDistance for ' + JSON.stringify([typed, correct]));
      if (v.status === 'correct' || v.status === 'unanswered') {
        assert.strictEqual(v.showTypedAnswer, false, 'correct/unanswered never reveal the typed row');
        assert.strictEqual(v.showDiff, false, 'correct/unanswered never render a granular diff');
      } else if (v.status === 'near-miss') {
        assert.ok(d >= 1 && d <= 2, 'near-miss must be exactly distance 1..2, got ' + d);
        assert.strictEqual(v.showTypedAnswer, true);
        assert.strictEqual(v.showDiff, true);
      } else if (v.status === 'wrong') {
        assert.ok(d >= 2, 'wrong needs at least two hits: a single edit is always a near-miss, got ' + d);
        assert.strictEqual(v.showTypedAnswer, true);
        assert.strictEqual(v.showDiff, true);
      } else {
        assert.fail('unknown status "' + v.status + '" for ' + JSON.stringify([typed, correct]));
      }
      assert.strictEqual(v.exact, typed.length > 0 && typed.toLowerCase() === correct.toLowerCase(),
        'exact means the typed answer matches; an empty answer is never exact (unanswered dominates)');
      assert.strictEqual(typeof v.messageKey, 'string', 'messageKey must always present');
    }
  }
});

cases.push({
  name: 'diff: mobile clamp — long rows collapse with a working .diff-toggle, short rows do not',
  fn: () => {
    const doc = env.win.document;
    const wrap = doc.createElement('div');
    wrap.innerHTML =
      '<div id="diff-correct-row" class="diff-row diff-row-correct"></div>' +
      '<div id="diff-input-row" class="diff-row diff-row-typed"></div>';
    doc.body.appendChild(wrap);
    const long = doc.getElementById('diff-correct-row');
    const short = doc.getElementById('diff-input-row');
    Object.defineProperty(long, 'scrollHeight', { value: 120, configurable: true });
    Object.defineProperty(short, 'scrollHeight', { value: 30, configurable: true });

    const origMatchMedia = env.win.matchMedia;
    const origGCS = env.win.getComputedStyle;
    env.win.matchMedia = () => ({ matches: true });
    env.win.getComputedStyle = () => ({ lineHeight: '20px' });

    internals.applyDiffClamp();

    assert.ok(long.classList.contains('diff-clamped'), 'long row must clamp to two lines');
    const toggle = long.nextElementSibling;
    assert.ok(toggle && toggle.classList.contains('diff-toggle'), 'clamped row must gain a .diff-toggle');
    assert.strictEqual(toggle.textContent, 'Visa mer');
    toggle.click();
    assert.ok(long.classList.contains('diff-expanded'), 'tapping the toggle must expand the row');
    assert.strictEqual(toggle.textContent, 'Visa mindre');
    toggle.click();
    assert.ok(!long.classList.contains('diff-expanded'), 'tapping again must collapse the row');

    assert.ok(!short.classList.contains('diff-clamped'), 'a short row must not clamp');
    assert.ok(!short.nextElementSibling || !short.nextElementSibling.classList.contains('diff-toggle'),
      'a short row must not gain a toggle');

    // Desktop (no match) leaves the diff untouched.
    env.win.matchMedia = () => ({ matches: false });
    long.classList.remove('diff-clamped', 'diff-expanded');
    internals.applyDiffClamp();
    assert.ok(!long.classList.contains('diff-clamped'), 'desktop must not clamp');

    env.win.matchMedia = origMatchMedia;
    env.win.getComputedStyle = origGCS;
    wrap.parentNode.removeChild(wrap);
  }
});

module.exports = cases;
