'use strict';
/* UI/DOM contract tests: template structure, settings menu build, shortcuts,
   typing overlay classes, diff verdict UI, empty-field sections. */

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { createEnv, evalModules, frontCard, backCard, flip, typeInto, overlayStats, SAMPLE } = require('../harness');

let env = null;
let win = null;

const cases = [];

/* jsdom refuses to execute <script> injected via innerHTML (the way the
   harness flips cards), so the templates' inline hide-empty scripts are
   tested here with a fresh runScripts:'dangerously' document: the inline
   bodies are extracted from the rendered template and appended as real
   <script> nodes, which jsdom DOES execute. */
function inlineScriptDoc(tplHtml) {
  const bodies = [];
  const stripped = tplHtml.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => {
    bodies.push(body);
    return '';
  });
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="qa">' + stripped + '</div></body></html>',
    { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true }
  );
  bodies.forEach((body) => {
    const s = dom.window.document.createElement('script');
    s.textContent = body;
    dom.window.document.body.appendChild(s);
  });
  return dom.window.document;
}

cases.push({
  name: 'ui: env prepared',
  async: true,
  fn: async () => {
    env = await createEnv();
    win = env.win;
    evalModules(win);
  }
});

cases.push({
  name: 'ui: front template structure (settings, selector, cue cards, typing area)',
  fn: () => {
    flip(win, frontCard());
    ['btnSettings', 'settingsMenu', 'typeans', 'typeans-overlay', 'smooth-caret', 'correct-answer'].forEach((id) => {
      assert.ok(win.document.getElementById(id), 'front missing #' + id);
    });
    assert.ok(win.document.querySelector('.aurora-card.card-front'), '.aurora-card.card-front missing');
    assert.ok(win.document.querySelector('.type-input-wrapper'), '.type-input-wrapper missing');
    assert.ok(win.document.querySelector('.hint-reveal'), '.hint-reveal (details) missing');
    assert.strictEqual(win.document.querySelectorAll('.card-type-btn').length, 0, 'card-type selector must be removed');
    assert.strictEqual(win.document.querySelectorAll('.cue-card').length, 1, 'exactly one cue card (meaning) after selector removal');
  }
});

cases.push({
  name: 'ui: back template structure (hero word, recall card, diff rows, anchored headword)',
  fn: () => {
    flip(win, backCard());
    ['correct-answer', 'btnSettings', 'settingsMenu', 'visual-diff-container',
      'diff-correct-row', 'diff-input-row', 'diff-section-correct', 'diff-section-input'].forEach((id) => {
      assert.ok(win.document.getElementById(id), 'back missing #' + id);
    });
    assert.ok(win.document.querySelector('.aurora-card.card-back'), '.aurora-card.card-back missing');
    assert.ok(win.document.querySelector('.recall-card'), '.recall-card missing');
    assert.ok(win.document.querySelector('.swedish-word'), '.swedish-word missing');
    assert.strictEqual(win.document.querySelector('.swedish-word').textContent, 'katt');
    assert.strictEqual(win.document.querySelectorAll('.study-ribbon').length, 0, 'decorative ribbon removed (coherence)');
    assert.ok(win.document.querySelector('.word-meta'), '.word-meta (pos/ipa/audio anchor) missing');
    const meta = win.document.querySelector('.back-section--word .word-meta');
    const word = win.document.querySelector('.back-section--word .swedish-word');
    assert.ok(meta && word, 'headword needs both .word-meta and .swedish-word');
    assert.ok(word.compareDocumentPosition(meta) & win.Node.DOCUMENT_POSITION_FOLLOWING,
      'the word must precede the metadata row so a long word/phrase cannot displace the pos-badge');
    assert.strictEqual(win.document.querySelectorAll('.row-info').length, 3, 'forms/synonym/antonym rows');
    assert.strictEqual(win.document.querySelectorAll('.tag-badge').length, 3, 'tag_1 + tag_2 + ID badges');
  }
});

cases.push({
  name: 'ui: both templates carry the 5 scripts and the stylesheet',
  fn: () => {
    flip(win, frontCard());
    const srcs = Array.from(win.document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'));
    assert.deepStrictEqual(srcs, ['_hna_storage.js', '_hna_engine.js', '_hna_diff.js', '_hna_typing.js', '_hna_aurora.js']);
    assert.strictEqual(win.document.querySelector('link[rel="stylesheet"]').getAttribute('href'), '_hna_styles_v7.css');
  }
});

cases.push({
  name: 'ui: empty optional fields drop their sections (explain, example, tags)',
  fn: () => {
    const noExtra = Object.assign({}, SAMPLE, { explain: '', example: '', example_translated: '' });
    flip(win, frontCard(noExtra));
    assert.strictEqual(win.document.querySelector('.giaithich'), null, 'empty explain must not render');
    flip(win, backCard(noExtra));
    assert.strictEqual(win.document.querySelector('.example-box'), null, 'empty example must not render');
    const emptyTags = Object.assign({}, SAMPLE, { tag_1: '', tag_2: '', tag_3: '', tag_4: '', Tags: '', ID: '' });
    flip(win, backCard(emptyTags));
    assert.strictEqual(win.document.querySelector('.card-tags').querySelector('.tag-badge'), null, 'empty tags must not render');
  }
});

cases.push({
  name: 'ui: settings menu builds MENU_SPEC-length toggles with role=switch and correct initial state',
  fn: () => {
    flip(win, frontCard());
    win.AnkiEngine.toggleSettings();
    const switches = win.document.querySelectorAll('#settingsMenu [role="switch"]');
    assert.strictEqual(switches.length, win.AnkiEngine.MENU_SPEC.length);
    const nightSw = win.document.getElementById('sw_nightMode');
    assert.ok(nightSw, 'nightMode switch missing');
    assert.strictEqual(nightSw.getAttribute('aria-checked'), String(win.AnkiEngine.config.nightMode));
  }
});

cases.push({
  name: 'ui: toggling a switch from the menu flips the live config',
  fn: () => {
    const nightSw = win.document.getElementById('sw_nightMode');
    const before = win.AnkiEngine.config.nightMode;
    nightSw.click();
    assert.strictEqual(win.AnkiEngine.config.nightMode, !before);
    assert.strictEqual(nightSw.getAttribute('aria-checked'), String(!before));
    nightSw.click();
    assert.strictEqual(win.AnkiEngine.config.nightMode, before);
  }
});

cases.push({
  name: 'ui: Space and Enter activate a settings toggle (ARIA switch contract)',
  fn: () => {
    flip(win, frontCard());
    win.AnkiEngine.toggleSettings();
    const sw = win.document.getElementById('sw_nightMode');
    assert.ok(sw, 'nightMode switch missing');
    const before = win.AnkiEngine.config.nightMode;
    const press = (key) => {
      const evt = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      sw.dispatchEvent(evt);
      return evt;
    };

    const spaceEvt = press(' ');
    assert.strictEqual(win.AnkiEngine.config.nightMode, !before, 'Space must flip the toggle');
    assert.strictEqual(sw.getAttribute('aria-checked'), String(!before), 'aria-checked must track the flipped state');
    assert.strictEqual(spaceEvt.defaultPrevented, true, 'Space must be preventDefaulted so the page cannot scroll');

    const enterEvt = press('Enter');
    assert.strictEqual(win.AnkiEngine.config.nightMode, before, 'Enter must flip the toggle back');
    assert.strictEqual(sw.getAttribute('aria-checked'), String(before));
    assert.strictEqual(enterEvt.defaultPrevented, true, 'Enter must be preventDefaulted');

    const otherEvt = press('x');
    assert.strictEqual(win.AnkiEngine.config.nightMode, before, 'a non-Space/Enter key must not flip the toggle');
    assert.strictEqual(otherEvt.defaultPrevented, false, 'non-activation keys must not be swallowed');
  }
});

cases.push({
  name: 'ui: keyboard shortcuts — Alt+S menu, Escape close, Alt+D night',
  fn: () => {
    flip(win, frontCard());
    const menu = win.document.getElementById('settingsMenu');
    const press = (key, opts) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ bubbles: true }, { key }, opts)));

    press('s', { altKey: true });
    assert.strictEqual(menu.classList.contains('active'), true, 'Alt+S must open menu');
    press('Escape');
    assert.strictEqual(menu.classList.contains('active'), false, 'Escape must close menu');

    const night = win.AnkiEngine.config.nightMode;
    press('d', { altKey: true });
    assert.strictEqual(win.AnkiEngine.config.nightMode, !night, 'Alt+D must toggle night');
    win.AnkiEngine.toggleConfig('nightMode');
  }
});

cases.push({
  name: 'ui: typing overlay — per-character verdicts paint green/red as you type',
  fn: () => {
    flip(win, frontCard());
    typeInto(win, 'katt');
    let stats = overlayStats(win);
    assert.strictEqual(stats.correct, 4);
    assert.strictEqual(stats.wrong, 0);
    typeInto(win, 'kant');
    stats = overlayStats(win);
    assert.strictEqual(stats.wrong, 1);
    assert.strictEqual(stats.correct, 3);
    typeInto(win, 'kattx');
    stats = overlayStats(win);
    assert.strictEqual(stats.extra, 1);
    assert.strictEqual(stats.wordExtra, 1);
    typeInto(win, 'katt');
    stats = overlayStats(win);
    assert.strictEqual(stats.all, 4, 'back to exact length');
    assert.strictEqual(stats.wordExtra, 0, 'extra group must disappear when it empties');
  }
});

cases.push({
  name: 'ui: meaning-word mode answers the word with the meaning cue card visible',
  async: true,
  fn: async () => {
    const e2 = await createEnv();
    flip(e2.win, frontCard());
    assert.strictEqual(e2.win.document.querySelectorAll('.card-type-btn').length, 0, 'no card-type buttons');
    const cue = e2.win.document.querySelector('.cue-card--meaning');
    assert.ok(cue, 'meaning cue card missing');
    assert.strictEqual(cue.style.display, '', 'meaning cue card must be visible by default');
    assert.strictEqual(e2.win.document.getElementById('correct-answer').textContent, 'katt', 'meaning-word answers the word');
  }
});

cases.push({
  name: 'ui: back face renders the diff verdict with typed-answer rows and the correct answer hidden',
  fn: () => {
    win.__hnaTypedAnswerBuffer = 'katt';
    flip(win, backCard());
    const container = win.document.getElementById('visual-diff-container');
    assert.ok(container.classList.contains('verdict-pop-correct'), 'expected correct verdict');
    const hidden = win.document.getElementById('correct-answer');
    assert.strictEqual(hidden.getAttribute('aria-hidden'), 'true');
  }
});

cases.push({
  name: 'ui: wrong typed answer renders verdict-wrong with per-char diff spans',
  fn: () => {
    win.__hnaTypedAnswerBuffer = 'hund';
    flip(win, backCard());
    const container = win.document.getElementById('visual-diff-container');
    assert.ok(container.classList.contains('verdict-pop-wrong'), 'expected wrong verdict');
    assert.strictEqual(win.document.getElementById('diff-input-row').querySelectorAll('span').length, 4);
    assert.strictEqual(win.document.getElementById('diff-correct-row').querySelectorAll('span').length, 4);
  }
});

cases.push({
  name: 'ui: no decorative ribbon markup remains on either face',
  fn: () => {
    flip(win, frontCard());
    assert.strictEqual(win.document.querySelectorAll('.study-ribbon').length, 0, 'front ribbon removed');
    flip(win, backCard());
    assert.strictEqual(win.document.querySelectorAll('.study-ribbon').length, 0, 'back ribbon removed');
  }
});

cases.push({
  name: 'ui: no stray raw template braces or unevaluated fields remain in the DOM',
  fn: () => {
    const html = win.document.body.innerHTML;
    assert.ok(html.indexOf('{{') === -1, 'unevaluated {{field}} left in DOM');
    assert.ok(html.indexOf('}}') === -1, 'unevaluated field terminator left in DOM');
  }
});

cases.push({
  name: 'ui: Back.html links the same stylesheet file as Front.html (template parity)',
  fn: () => {
    const hrefOf = (tpl) => {
      const link = tpl.match(/<link[^>]*rel="stylesheet"[^>]*>/);
      assert.ok(link, 'stylesheet <link> missing');
      const href = link[0].match(/href="([^"]+)"/);
      assert.ok(href, 'stylesheet href missing from ' + link[0]);
      return href[1];
    };
    const frontHref = hrefOf(frontCard());
    const backHref = hrefOf(backCard());
    assert.strictEqual(backHref, frontHref,
      'Back.html and Front.html must reference the same stylesheet (got "' + frontHref + '" vs "' + backHref + '")');
    assert.strictEqual(backHref, '_hna_styles_v7.css', 'unexpected stylesheet href: ' + backHref);
  }
});

cases.push({
  name: 'ui: Front inline script hides an empty hint-reveal but keeps one with an <img>',
  fn: () => {
    // Whitespace-only explain renders the section but leaves no real content
    // and no media -> the hint-reveal must be hidden.
    const emptyData = Object.assign({}, SAMPLE, { explain: '   ' });
    let doc = inlineScriptDoc(frontCard(emptyData));
    const det = doc.querySelector('.hint-reveal');
    assert.ok(det, 'hint-reveal must exist for a whitespace-only explain');
    assert.strictEqual(det.style.display, 'none', 'whitespace-only explain must hide the hint-reveal');

    // An <img>-only explain has no non-whitespace text but DOES have media ->
    // the predicate must keep the hint-reveal visible.
    const imgData = Object.assign({}, SAMPLE, { explain: '<img src="x.jpg" alt="diagram">' });
    doc = inlineScriptDoc(frontCard(imgData));
    const detImg = doc.querySelector('.hint-reveal');
    assert.ok(detImg, 'hint-reveal must exist for an img-only explain');
    assert.notStrictEqual(detImg.style.display, 'none', 'an <img>-only explain must keep the hint-reveal visible');
  }
});

cases.push({
  name: 'ui: Back inline script hides empty expand/thumb/example but keeps media fields',
  fn: () => {
    // Whitespace-only image/example render their sections with no real content
    // and no media -> hidden. example_translated must be empty too or its text
    // would keep .example-box alive.
    const emptyData = Object.assign({}, SAMPLE, { image: '   ', example: '   ', example_translated: '' });
    let doc = inlineScriptDoc(backCard(emptyData));
    assert.strictEqual(doc.querySelector('.recall-thumb').style.display, 'none',
      'whitespace-only image must hide .recall-thumb');
    assert.strictEqual(doc.querySelector('.example-box').style.display, 'none',
      'whitespace-only example must hide .example-box');

    // <img>-only fields: textContent is whitespace but the media child exists
    // -> must stay visible.
    const imgData = Object.assign({}, SAMPLE, {
      image: '<img src="x.jpg" alt="katt">',
      example: '<img src="y.jpg" alt="exempel">',
      example_translated: ''
    });
    doc = inlineScriptDoc(backCard(imgData));
    assert.notStrictEqual(doc.querySelector('.recall-thumb').style.display, 'none',
      'an <img>-only image must keep .recall-thumb visible');
    assert.notStrictEqual(doc.querySelector('.example-box').style.display, 'none',
      'an <img>-only example must keep .example-box visible');

    // Every extra-info field empty -> the expand details must be hidden.
    const bareData = Object.assign({}, SAMPLE, { explain: '', forms: '', synonym: '', antonym: '' });
    doc = inlineScriptDoc(backCard(bareData));
    assert.strictEqual(doc.getElementById('expand-info-details').style.display, 'none',
      'empty expand-content must hide #expand-info-details');
  }
});

cases.push({
  name: 'ui: typing preview converts [sound:] to replay-button and samples the audio fields',
  fn: () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.resolve(__dirname, '..', '..');
    const source = fs.readFileSync(path.join(srcDir, 'preview', 'preview.html'), 'utf8');
    assert.ok(source.indexOf('toReplayButtons') !== -1,
      'root preview must embed the [sound:] -> replay-button converter');
    assert.ok(source.indexOf('replay-button soundLink') !== -1,
      'root preview must emit .replay-button.soundLink anchors');
    assert.ok(source.indexOf('[sound:meaning.mp3]') !== -1,
      'root preview SAMPLE must include a non-empty audio_meaning field');
    // The shipped sheet must style Anki replay buttons on both faces.
    const css = fs.readFileSync(path.join(srcDir, '_hna_styles_v7.css'), 'utf8');
    assert.ok(css.indexOf('.replay-button') !== -1, 'shipped css must style .replay-button');
    assert.ok(css.indexOf('a.replay-button.soundLink') !== -1,
      'shipped css must style a.replay-button.soundLink');
  }
});

module.exports = cases;
