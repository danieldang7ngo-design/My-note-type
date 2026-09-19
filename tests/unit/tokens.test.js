'use strict';
/* Unit tests for AnkiEngine.tokenizeAnswer — the single word-feedback
   tokenizer shared by the typing overlay, hints and the diff. Zero-framework:
   exports an array of {name, fn}. */

const assert = require('assert');
const { createEnv, evalModules } = require('../harness');

let win = null;

const cases = [];

cases.push({
  name: 'tokens: env prepared',
  async: true,
  fn: async () => {
    const env = await createEnv();
    win = env.win;
    evalModules(win);
  }
});

function tokenize(str) {
  return win.AnkiEngine.tokenizeAnswer(str);
}

cases.push({
  name: 'tokens: basic word',
  fn: () => {
    const t = tokenize('katt');
    assert.strictEqual(t.length, 1);
    assert.deepStrictEqual(t[0], { text: 'katt', normalized: 'katt', start: 0, end: 4, type: 'word' });
  }
});

cases.push({
  name: 'tokens: Swedish characters (å å ä ö) survive as one word',
  fn: () => {
    const t = tokenize('fågel');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].text, 'fågel');
    assert.strictEqual(t[0].normalized, 'fågel');
    assert.strictEqual(t[0].end - t[0].start, 5);
    const t2 = tokenize('möte');
    assert.strictEqual(t2.length, 1);
    assert.strictEqual(t2[0].text, 'möte');
  }
});

cases.push({
  name: 'tokens: case-insensitive normalization is lowercased',
  fn: () => {
    const t = tokenize('Katt');
    assert.strictEqual(t[0].normalized, 'katt');
    assert.strictEqual(t[0].text, 'Katt');
  }
});

cases.push({
  name: 'tokens: phrase — words and separators',
  fn: () => {
    const t = tokenize('en blå fågel');
    assert.strictEqual(t.length, 5);
    assert.deepStrictEqual(
      t.map((x) => x.type),
      ['word', 'separator', 'word', 'separator', 'word']
    );
    assert.deepStrictEqual(
      t.map((x) => x.text),
      ['en', ' ', 'blå', ' ', 'fågel']
    );
    assert.deepStrictEqual(
      t.map((x) => x.start),
      [0, 2, 3, 6, 7]
    );
  }
});

cases.push({
  name: 'tokens: punctuation attaches to the preceding word (Hej! is one unit)',
  fn: () => {
    const t = tokenize('Hej!');
    assert.strictEqual(t.length, 1);
    assert.deepStrictEqual(t[0], { text: 'Hej!', normalized: 'hej!', start: 0, end: 4, type: 'word' });
  }
});

cases.push({
  name: 'tokens: newline is a standalone type and does not fuse words',
  fn: () => {
    const t = tokenize('katt\nhund');
    assert.deepStrictEqual(
      t.map((x) => x.type),
      ['word', 'newline', 'word']
    );
    assert.strictEqual(t[0].text, 'katt');
    assert.strictEqual(t[2].text, 'hund');
    assert.strictEqual(t[1].start, 4);
  }
});

cases.push({
  name: 'tokens: numbers are word characters',
  fn: () => {
    const t = tokenize('2026');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].type, 'word');
    assert.strictEqual(t[0].text, '2026');
  }
});

cases.push({
  name: 'tokens: empty and null input yield no tokens',
  fn: () => {
    assert.strictEqual(tokenize('').length, 0);
    assert.strictEqual(tokenize(null).length, 0);
    assert.strictEqual(tokenize(undefined).length, 0);
  }
});

module.exports = cases;