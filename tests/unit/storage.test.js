'use strict';
/* Unit tests for _hna_storage.js: local/session/cookie persistence with
   crash-safe fallbacks, and the typed-answer buffer lifecycle. */

const assert = require('assert');
const { createEnv, evalModules, frontCard, backCard, flip, typeInto } = require('../harness');

let env = null;

const cases = [];

cases.push({
  name: 'storage: env prepared, storage API installed on window',
  async: true,
  fn: async () => {
    env = await createEnv();
    evalModules(env.win);
    assert.strictEqual(typeof env.win.safeSet, 'function', 'safeSet missing');
    assert.strictEqual(typeof env.win.safeGet, 'function', 'safeGet missing');
    assert.strictEqual(typeof env.win.STORAGE_KEYS, 'object', 'STORAGE_KEYS missing');
  }
});

cases.push({
  name: 'storage: safeSet/safeGet round trip through localStorage',
  fn: () => {
    env.win.safeSet('__test_key', 'value-123');
    assert.strictEqual(env.win.safeGet('__test_key'), 'value-123');
    assert.ok(env.win.localStorage.getItem('__test_key'));
  }
});

cases.push({
  name: 'storage: typed answers use TTL-bound session storage only',
  fn: () => {
    const key = env.win.STORAGE_KEYS.TYPED_ANSWER;
    env.win.safeSetTransient(key, 'abc');
    assert.strictEqual(env.win.safeGetTransient(key), 'abc');
    assert.strictEqual(env.win.localStorage.getItem(key), null);
  }
});

cases.push({
  name: 'storage: expired or malformed transient answers are removed',
  fn: () => {
    const key = env.win.STORAGE_KEYS.TYPED_ANSWER;
    env.win.sessionStorage.setItem(key, '{bad json');
    assert.strictEqual(env.win.safeGetTransient(key), null);
    assert.strictEqual(env.win.sessionStorage.getItem(key), null);
    env.win.sessionStorage.setItem(key, JSON.stringify({ value: 'abc', expiresAt: Date.now() - 1 }));
    assert.strictEqual(env.win.safeGetTransient(key), null);
    assert.strictEqual(env.win.sessionStorage.getItem(key), null);
  }
});

cases.push({
  name: 'storage: safeGet returns null for missing key',
  fn: () => {
    assert.strictEqual(env.win.safeGet('__no_such_key'), null);
  }
});

cases.push({
  name: 'storage: JSON values survive (objects round-trip)',
  fn: () => {
    const key = env.win.STORAGE_KEYS.CONFIG;
    env.win.safeSet(key, JSON.stringify({ nightMode: true }));
    assert.strictEqual(JSON.parse(env.win.safeGet(key)).nightMode, true);
  }
});

cases.push({
  name: 'storage: broken localStorage falls back to cookies without throwing',
  fn: () => {
    const orig = env.win.localStorage.getItem;
    env.win.localStorage.getItem = function () { throw new Error('denied'); };
    env.win.localStorage.setItem = function () { throw new Error('denied'); };
    try {
      env.win.safeSet('__fbtest', 'c1');
      const got = env.win.safeGet('__fbtest');
      assert.strictEqual(got, 'c1');
      assert.ok(env.win.document.cookie.indexOf('__fbtest') !== -1);
    } finally {
      env.win.localStorage.getItem = orig;
      env.win.localStorage.removeItem('__fbtest');
    }
  }
});

cases.push({
  name: 'storage: corrupt stored JSON is swallowed by config load, defaults intact',
  fn: () => {
    const key = env.win.STORAGE_KEYS.CONFIG;
    env.win.safeSet(key, '{broken json!!!');
    assert.doesNotThrow(() => env.win.AnkiEngine.loadConfig());
    assert.strictEqual(env.win.AnkiEngine.config.nightMode, false, 'defaults must survive corrupt config');
    env.win.safeSet(key, JSON.stringify(env.win.AnkiEngine.config));
  }
});

cases.push({
  name: 'storage: typed-answer buffer writes on input and survives a card flip',
  fn: () => {
    flip(env.win, frontCard());
    typeInto(env.win, 'katt');
    const buffered = env.win.safeGetTransient(env.win.STORAGE_KEYS.TYPED_ANSWER);
    assert.notStrictEqual(buffered, 'katt', 'storage write is debounced until flush/flip');
    flip(env.win, backCard());
    assert.strictEqual(env.win.safeGetTransient(env.win.STORAGE_KEYS.TYPED_ANSWER), 'katt', 'flip must flush the pending write for the back face');
    assert.strictEqual(env.win.localStorage.getItem(env.win.STORAGE_KEYS.TYPED_ANSWER), null, 'typed answer must not persist durably');
  }
});

cases.push({
  name: 'storage: typed-answer buffer clears when a new front card loads',
  fn: () => {
    flip(env.win, frontCard());
    const cleared = env.win.safeGetTransient(env.win.STORAGE_KEYS.TYPED_ANSWER);
    assert.ok(cleared === '' || cleared === null, 'buffer must be cleared for the new card, got ' + JSON.stringify(cleared));
  }
});

cases.push({
  name: 'storage: buffer resets on the back face too (BUG-005 regression)',
  fn: () => {
    flip(env.win, frontCard());
    typeInto(env.win, 'xyz');
    flip(env.win, backCard());
    assert.strictEqual(env.win.__hnaTypedAnswerBuffer, 'xyz');
    flip(env.win, backCard());
    assert.strictEqual(env.win.__hnaTypedAnswerBuffer, 'xyz', 'buffer kept until next front card');
  }
});

module.exports = cases;
