/* ============================================================
   UNIT TESTS FOR MCQ LOGIC
   Zero-framework runner compatible: must export [{name, fn}]
   ============================================================ */

var assert = require('assert');

// Mock window and document for Node environment
global.window = global.window || { AnkiMCQ: {} };

global.document = global.document || {
  querySelectorAll: function () { return []; },
  getElementById: function () { return null; }
};

require('../../mcq/_mcq_logic.js');
var AnkiMCQ = global.window.AnkiMCQ;

module.exports = [
  {
    name: 'mcqLogic: answer fields use three distractions plus correct answer',
    fn: function () {
      var fs = require('fs');
      ['Front.html', 'Back.html'].forEach(function (file) {
        var template = fs.readFileSync(require('path').join(__dirname, '../../mcq', file), 'utf8');
        assert(template.indexOf('{{Distraction-1}}') !== -1);
        assert(template.indexOf('{{Distraction-2}}') !== -1);
        assert(template.indexOf('{{Distraction-3}}') !== -1);
        assert(template.indexOf('{{Correct-answer}}') !== -1);
        assert(template.indexOf('data-correct="true">{{Correct-answer}}') !== -1);
      });
    }
  },
  {
    name: 'mcqLogic: shuffleChoices returns same length',
    fn: function () {
      var choices = [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
        { text: 'C', isCorrect: false },
        { text: 'D', isCorrect: false }
      ];
      var shuffled = AnkiMCQ.shuffleChoices(choices);
      assert.strictEqual(shuffled.length, 4);
    }
  },
  {
    name: 'mcqLogic: shuffleChoices contains all original elements',
    fn: function () {
      var choices = [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
        { text: 'C', isCorrect: false }
      ];
      var shuffled = AnkiMCQ.shuffleChoices(choices);
      var texts = shuffled.map(function (c) { return c.text; }).sort();
      assert.deepStrictEqual(texts, ['A', 'B', 'C']);
    }
  },
  {
    name: 'mcqLogic: shuffleChoices works with 2 choices',
    fn: function () {
      var choices = [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false }
      ];
      var shuffled = AnkiMCQ.shuffleChoices(choices);
      assert.strictEqual(shuffled.length, 2);
      var texts = shuffled.map(function (c) { return c.text; }).sort();
      assert.deepStrictEqual(texts, ['A', 'B']);
    }
  }
];
