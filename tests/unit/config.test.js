'use strict';
/* Unit tests for AnkiEngine config layering, toggles, and the settings menu spec. */

const assert = require('assert');
const { createEnv, evalModules, frontCard, flip } = require('../harness');

let env = null;
let win = null;

const cases = [];

cases.push({
  name: 'config: env prepared and AnkiEngine available',
  async: true,
  fn: async () => {
    env = await createEnv();
    win = env.win;
    evalModules(win);
    assert.ok(win.AnkiEngine, 'AnkiEngine missing');
    assert.strictEqual(typeof win.AnkiEngine.toggleConfig, 'function');
    assert.strictEqual(typeof win.AnkiEngine.toggleSettings, 'function');
  }
});

cases.push({
  name: 'config: defaults present and typed correctly',
  fn: () => {
    const c = win.AnkiEngine.config;
    assert.strictEqual(typeof c.nightMode, 'boolean');
    assert.strictEqual(typeof c.playSound, 'boolean');
    assert.strictEqual(c.nightMode, false, 'nightMode must default off');
  }
});

cases.push({
  name: 'config: MENU_SPEC has 10 entries and every key maps to a real config key',
  fn: () => {
    const spec = win.AnkiEngine.MENU_SPEC;
    assert.strictEqual(spec.length, 12, 'MENU_SPEC must have 12 entries');
    spec.forEach((item) => {
      assert.ok(item.key, 'menu item missing key: ' + JSON.stringify(item));
      assert.ok(win.AnkiEngine.config[item.key] !== undefined, 'toggle key not in config: ' + item.key);
      assert.ok(item.label, 'menu item missing label: ' + item.key);
      assert.ok(item.d, 'menu item missing SVG path: ' + item.key);
    });
    assert.strictEqual(spec.filter((i) => i.extra).length, 7, 'expected 7 extras in the Mer section');
  }
});

cases.push({
  name: 'config: MENU_SPEC has no duplicate keys (BUG-007 regression)',
  fn: () => {
    const keys = win.AnkiEngine.MENU_SPEC.map((i) => i.key);
    assert.strictEqual(new Set(keys).size, keys.length, 'duplicate keys: ' + keys);
  }
});

cases.push({
  name: 'config: toggleConfig flips value and persists to localStorage',
  fn: () => {
    const before = win.AnkiEngine.config.nightMode;
    win.AnkiEngine.toggleConfig('nightMode');
    assert.strictEqual(win.AnkiEngine.config.nightMode, !before);
    const stored = JSON.parse(win.safeGet(win.STORAGE_KEYS.CONFIG));
    assert.strictEqual(stored.nightMode, !before);
    win.AnkiEngine.toggleConfig('nightMode');
    assert.strictEqual(win.AnkiEngine.config.nightMode, before);
  }
});

cases.push({
  name: 'config: night mode classes applied to documentElement and body',
  fn: () => {
    win.AnkiEngine.toggleConfig('nightMode');
    win.__flushRAF();
    assert.ok(win.document.documentElement.classList.contains('night-mode'));
    assert.ok(win.document.body.classList.contains('night-mode'));
    win.AnkiEngine.toggleConfig('nightMode');
    win.__flushRAF();
    assert.ok(!win.document.documentElement.classList.contains('night-mode'));
  }
});

cases.push({
  name: 'config: layering — window.ANKI_PERSISTENT_CONFIG overrides defaults',
  fn: () => {
    win.safeSet(win.STORAGE_KEYS.CONFIG, '');
    win.eval('window.ANKI_PERSISTENT_CONFIG = { nightMode: true }; window.AnkiEngine = undefined;');
    evalModules(win);
    assert.strictEqual(win.AnkiEngine.config.nightMode, true, 'ANKI_PERSISTENT_CONFIG must win over defaults');
    win.AnkiEngine.toggleConfig('nightMode');
    win.eval('window.ANKI_PERSISTENT_CONFIG = undefined; window.AnkiEngine = undefined;');
    evalModules(win);
  }
});

cases.push({
  name: 'config: layering — localStorage beats ANKI_PERSISTENT_CONFIG',
  fn: () => {
    win.safeSet(win.STORAGE_KEYS.CONFIG, JSON.stringify({ nightMode: false }));
    win.eval('window.ANKI_PERSISTENT_CONFIG = { nightMode: true }; window.AnkiEngine = undefined;');
    evalModules(win);
    assert.strictEqual(win.AnkiEngine.config.nightMode, false, 'localStorage must win over ANKI_PERSISTENT_CONFIG');
    win.eval('window.ANKI_PERSISTENT_CONFIG = undefined; window.AnkiEngine = undefined;');
    evalModules(win);
  }
});

cases.push({
  name: 'config: loadConfig coerces string "false"/"true" for known boolean keys and ignores unknown keys',
  fn: () => {
    const snapshot = win.safeGet(win.STORAGE_KEYS.CONFIG);
    try {
      win.safeSet(win.STORAGE_KEYS.CONFIG, JSON.stringify({
        nightMode: 'false',   // known MENU_SPEC boolean key, string form -> must coerce to boolean false
        playSound: 'true',    // known MENU_SPEC boolean key, string form -> must coerce to boolean true
        settings: { nightMode: 'true' }, // unknown envelope key -> ignored, never merged into config
        bogusToggle: true     // unknown key -> ignored, never added to config
      }));
      win.AnkiEngine.loadConfig();
      assert.strictEqual(win.AnkiEngine.config.nightMode, false,
        'string "false" must coerce to boolean false, got ' + JSON.stringify(win.AnkiEngine.config.nightMode));
      assert.strictEqual(win.AnkiEngine.config.playSound, true,
        'string "true" must coerce to boolean true, got ' + JSON.stringify(win.AnkiEngine.config.playSound));
      assert.strictEqual(win.AnkiEngine.config.settings, undefined,
        'unknown key "settings" must be ignored by loadConfig');
      assert.strictEqual(win.AnkiEngine.config.bogusToggle, undefined,
        'unknown key must not leak into config');
    } finally {
      if (snapshot === null) win.safeSet(win.STORAGE_KEYS.CONFIG, '');
      else win.safeSet(win.STORAGE_KEYS.CONFIG, snapshot);
      win.AnkiEngine.loadConfig();
    }
  }
});

cases.push({
  name: 'config: settings menu builds lazily with exactly the MENU_SPEC entries',
  fn: () => {
    flip(win, frontCard());
    const menu = win.document.getElementById('settingsMenu');
    assert.ok(menu, 'settingsMenu missing from front template');
    assert.strictEqual(menu.children.length, 0, 'menu must be empty until first open (BUG-007 lazy build)');
    win.AnkiEngine.toggleSettings();
    assert.strictEqual(menu.querySelectorAll('.menu-item').length, win.AnkiEngine.MENU_SPEC.length);
    assert.strictEqual(menu.querySelectorAll('[role="switch"]').length, win.AnkiEngine.MENU_SPEC.length);
    assert.strictEqual(menu.classList.contains('active'), true, 'menu must be active after toggleSettings');
  }
});

cases.push({
  name: 'config: built menu does not duplicate on second open (BUG-007 regression)',
  fn: () => {
    const menu = win.document.getElementById('settingsMenu');
    const count = () => menu.querySelectorAll('.menu-item').length;
    const before = count();
    win.AnkiEngine.toggleSettings();
    win.AnkiEngine.toggleSettings();
    assert.strictEqual(count(), before, 'menu must not duplicate');
  }
});

cases.push({
  name: 'config: extras dropdown has the 6 extra toggles and the Facebook link',
  fn: () => {
    const menu = win.document.getElementById('settingsMenu');
    const dropdown = menu.querySelector('.extras-dropdown');
    assert.ok(dropdown, 'extras dropdown missing');
    assert.strictEqual(dropdown.querySelectorAll('.menu-item').length, 7, 'expected 7 extras');
    const links = menu.querySelectorAll('a.menu-link');
    assert.strictEqual(links.length, 1, 'expected exactly one menu-link (Facebook)');
    assert.ok(links[0].getAttribute('href').indexOf('facebook') !== -1);
    assert.strictEqual(links[0].getAttribute('target'), '_blank');
  }
});

cases.push({
  name: 'config: switch click from the menu flips the live config and updates aria-checked',
  fn: () => {
    const sw = win.document.getElementById('sw_nightMode');
    assert.ok(sw, 'nightMode switch missing');
    const before = win.AnkiEngine.config.nightMode;
    sw.click();
    assert.strictEqual(win.AnkiEngine.config.nightMode, !before);
    assert.strictEqual(sw.getAttribute('aria-checked'), String(!before));
    sw.click();
    assert.strictEqual(win.AnkiEngine.config.nightMode, before);
  }
});

cases.push({
  name: 'config: decoding uses a shared decoder element (detached, no per-call DOM nodes)',
  fn: () => {
    win.AnkiEngine.decodeHTML('&auml;'); // creates the shared decoder once
    const decoder = win.AnkiEngine.__decoder;
    assert.ok(decoder && decoder.tagName === 'TEXTAREA', 'shared decoder textarea missing');
    assert.strictEqual(win.document.querySelectorAll('textarea').length, 0,
      'decoder must stay detached — no textarea may leak into the DOM (RAM regression)');
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(win.AnkiEngine.decodeHTML('&auml;&ouml;'), 'äö');
    }
    assert.strictEqual(win.AnkiEngine.__decoder, decoder, 'decoder node must be reused, not recreated');
    assert.strictEqual(win.document.querySelectorAll('textarea').length, 0, 'decodeHTML must not touch the DOM');
  }
});

module.exports = cases;
