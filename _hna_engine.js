/* ============================================================
   HNA MAIN ENGINE
   Shared configuration, settings UI, and keyboard shortcuts
   for both Typing and MCQ note types.
   
   Exports: window.AnkiEngine
   Dependencies: STORAGE_KEYS, safeGet, safeSet
   
   See ARCHITECTURE.md for system overview.
   ============================================================ */

window.AnkiEngine = window.AnkiEngine || {};
var AnkiEngine = window.AnkiEngine;

// One reused textarea instead of a fresh element per call. This runs on every
// card (twice on Back) and the discarded elements were measurable retained nodes.
AnkiEngine.decodeHTML = function (html) {
    var txt = AnkiEngine.__decoder;
    if (!txt) { txt = AnkiEngine.__decoder = document.createElement("textarea"); }
    txt.innerHTML = html;
    return txt.value;
};

// Tokenize answers once for typing feedback. This deliberately
// uses ES5-safe Latin ranges: older Anki WebViews cannot parse Unicode
// property escapes, while Swedish letters are covered by the range.
AnkiEngine.tokenizeAnswer = function (answer) {
    var text = String(answer == null ? '' : answer);
    var tokens = [];
    var i = 0;
    var start;
    var ch;
    var type;
    function isWordChar(c) { return /[0-9A-Za-z\u00C0-\u024F]/.test(c); }
    function push(textPart, tokenType, tokenStart, tokenEnd) {
        var previous = tokens.length ? tokens[tokens.length - 1] : null;
        // Punctuation belongs to its preceding word feedback unit (Hej!).
        if (tokenType === 'punctuation' && previous && previous.type === 'word') {
            previous.text += textPart;
            previous.normalized += textPart.toLowerCase();
            previous.end = tokenEnd;
            return;
        }
        tokens.push({ text: textPart, normalized: textPart.toLowerCase(), start: tokenStart, end: tokenEnd, type: tokenType });
    }
    while (i < text.length) {
        start = i;
        ch = text.charAt(i);
        if (isWordChar(ch)) {
            while (i < text.length && isWordChar(text.charAt(i))) i++;
            type = 'word';
        } else if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
            i++;
            type = 'newline';
        } else if (/\s/.test(ch)) {
            while (i < text.length && /\s/.test(text.charAt(i)) && text.charAt(i) !== '\r' && text.charAt(i) !== '\n') i++;
            type = 'separator';
        } else {
            while (i < text.length && !isWordChar(text.charAt(i)) && !/\s/.test(text.charAt(i))) i++;
            type = 'punctuation';
        }
        push(text.slice(start, i), type, start, i);
    }
    return tokens;
};

// Shared answer-field parser — the ".swedish-word logic". {{word}} reaches
// span.swedish-word as RAW HTML on the Back face, so a <br> in the note
// field renders there as a REAL line break. Reading .textContent instead
// silently deletes <br> ("katt<br>hund" -> "katthund"), which fused
// multi-line answers into one run-on string in both the typing overlay and
// the visual diff. Both now parse through here: <br> variants become \n
// BEFORE tag stripping, other tags are removed while entity-escaped literal
// angle brackets in the text survive, entities then decode, and CRLF/nbsp
// normalize to \n/space. Callers own trim/collapse decisions.
AnkiEngine.decodeAnswerField = function (html) {
    var s = String(html == null ? '' : html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '');
    s = AnkiEngine.decodeHTML(s);
    return s.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ');
};

var defaultConfig = {
    nightMode: false,
    realtimeCheck: true,
    showSmoothCaret: true,
    showTrans: true,
    showExample: true,
    showExplain: true,
    showExpand: true,
    showImage: true,
    showTags: true,
    showStats: false,
    playSound: true,
    auroraFlow: true
};

// Settings menu spec — single source of truth for both card faces.
// This used to be a ~99-line <template id="settings-template"> duplicated
// verbatim in Front.html AND Back.html. Two copies of the same markup, in
// files that must be pasted separately into Anki's template editor, meant
// every menu change had to be made twice by hand or the two faces silently
// drifted apart. Defining it here means both faces load one definition.
// Fields: config key, Swedish label, SVG path, optional keyboard shortcut.
// `extra: true` puts the row inside the collapsed "Mer" section.
//
// It sits HERE, next to defaultConfig, and not down beside buildSettingsMenu:
// updateSwitches iterates it, and init() (which calls updateSwitches) runs at
// top level partway down this file. Declared after that call, MENU_SPEC was
// still undefined when the first card read `.length`, which threw and aborted
// the rest of this file's top-level execution — so window.AnkiAudio never got
// assigned and _hna_diff.js then died on `AnkiAudio is not defined`, rendering
// the diff rows empty. Same key set as defaultConfig; keep the two together.
AnkiEngine.MENU_SPEC = [
    { key: 'nightMode', label: 'Mörkt läge', shortcut: 'Alt+D', d: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1-8.313-12.454z' },
    { key: 'realtimeCheck', label: 'Realtidskontroll', d: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { key: 'showSmoothCaret', label: 'Mjuk markör', d: 'M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    { key: 'playSound', label: 'Ljudeffekter', d: 'M11 5L6 9H2v6h4l5 4V5z m4 2a5 5 0 0 1 0 10m2.5-12.5a8.5 8.5 0 0 1 0 15' },
    // Aurora-flöde: motion-only switch. OFF adds html.pause-aurora-flow, which
    // freezes the ribbons' animation-play-state (see _hna_styles_v7.css) — the
    // aurora layer itself stays rendered; nothing is hidden or recreated.
    { key: 'auroraFlow', label: 'Aurora-flöde', d: 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2' },
    { key: 'showTrans', label: 'Översätt exempel', extra: true, d: 'M5 8l6 6 6-6' },
    { key: 'showExample', label: 'Exempel', extra: true, d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z' },
    { key: 'showExplain', label: 'Förklara', extra: true, d: 'M12 20h.01M7 20h.01m10 0h.01M12 4v12m-4-4l4 4 4-4' },
    { key: 'showExpand', label: 'Expandera', extra: true, d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
    { key: 'showImage', label: 'Visa bild', extra: true, d: 'M4 16l4.586-4.586a2 2 0 0 1 2.828 0L16 16m-2-2l1.586-1.586a2 2 0 0 1 2.828 0L20 14m-6-6h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z' },
    { key: 'showTags', label: 'Visa taggar', extra: true, d: 'M7 7h10v10H7z M7 7l5 5 5-5 M7 17l5-5 5 5' },
    { key: 'showStats', label: 'Visa statistik', extra: true, d: 'M3 3v18h18V3H3zm9 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }
];

if (!AnkiEngine.config) {
    AnkiEngine.config = defaultConfig;
} else {
    for (var defKey in defaultConfig) {
        if (!AnkiEngine.config.hasOwnProperty(defKey)) {
            AnkiEngine.config[defKey] = defaultConfig[defKey];
        }
    }
}

AnkiEngine.init = function () {
    this.loadConfig();
    this.applyConfig();
    this.setupEvents();

    var self = this;
    // Only sync switch state here. The menu itself is built lazily on first
    // gear click — building it eagerly cloned ~125 template nodes + 13 toggle
    // listeners on EVERY card flip, for UI that is invisible until opened.
    // This used to branch on document.readyState === 'loading' and register an
    // anonymous DOMContentLoaded listener — dead code inside Anki (the webview
    // is long since loaded when a card renders) and the only listener in the
    // codebase without a stored-handle teardown. Removed; the rAF path covers
    // every real case.
    // One-shot rAF (RAM audit): cancel a pending init frame before re-scheduling
    // and clear the handle when it runs. Deliberately a SEPARATE handle from
    // __hnaEngineRAF — applyConfig above scheduled its _applyToggleMap frame
    // first, and reusing one handle here would cancel it, silently breaking
    // every config class on the card.
    if (window.__hnaEngineInitRAF) cancelAnimationFrame(window.__hnaEngineInitRAF);
    window.__hnaEngineInitRAF = requestAnimationFrame(function () {
        window.__hnaEngineInitRAF = null;
        self.updateSwitches();
    });
};

// Coerce one config value to the boolean every known key must hold. A string
// "false" copied from storage used to be truthy, so {"nightMode":"false"}
// flipped night mode ON; only 'true'/'1' (case-insensitive, trimmed) and the
// number 1 are true. Unknown keys are never copied into this.config at all —
// they used to drift into saveConfig output and the toggle UI.
function coerceConfigValue(v) {
    if (typeof v === 'string') {
        var s = v.toLowerCase().trim();
        return s === 'true' || s === '1';
    }
    if (typeof v === 'number') return v === 1;
    return Boolean(v);
}

// Config priority, lowest to highest:
//   1. defaultConfig            — static defaults, merged in at module load above
//   2. ANKI_PERSISTENT_CONFIG   — base layer injected by the host page. Despite
//                                 the name it is NOT the final authority.
//   3. localStorage/cookie      — the user's own toggles, written by saveConfig.
//                                 Applied last, so it wins on key overlap.
// Do not reorder: moving storage below the persistent config would make every
// settings change silently ineffective on the next flip.
AnkiEngine.loadConfig = function () {
    if (window.ANKI_PERSISTENT_CONFIG) {
        for (var k in window.ANKI_PERSISTENT_CONFIG) {
            if (defaultConfig.hasOwnProperty(k)) this.config[k] = coerceConfigValue(window.ANKI_PERSISTENT_CONFIG[k]);
        }
    }
    try {
        var s = safeGet(STORAGE_KEYS.CONFIG);
        if (s) {
            try {
                var p = JSON.parse(s);
                for (var key in p) {
                    if (defaultConfig.hasOwnProperty(key)) this.config[key] = coerceConfigValue(p[key]);
                }
            } catch (e) { }
        }
    } catch (e) {
        console.warn("Failed to load config");
    }
};

AnkiEngine.saveConfig = function () {
    var s = JSON.stringify(this.config);
    try {
        safeSet(STORAGE_KEYS.CONFIG, s);
    } catch (e) {
        console.warn("Failed to save config");
    }
};

AnkiEngine.applyConfig = function () {
    var c = this.config;
    var toggleMap = this._buildToggleMap(c);
    var self = this;
    // One-shot rAF (RAM audit): cancel a pending applyConfig frame before
    // re-scheduling (a resize storm can call applyConfig repeatedly) and clear
    // the handle once the frame has run.
    if (window.__hnaEngineRAF) cancelAnimationFrame(window.__hnaEngineRAF);
    window.__hnaEngineRAF = requestAnimationFrame(function () {
        window.__hnaEngineRAF = null;
        self._applyToggleMap(toggleMap);
    });
    this.updateSwitches();
};

AnkiEngine._buildToggleMap = function (c) {
    return [
        ['night-mode', c.nightMode],
        ['disable-realtime', !c.realtimeCheck],
        ['stealth-mode', !c.realtimeCheck && c.showSmoothCaret],
        ['hide-smooth-caret', !c.showSmoothCaret],
        ['hide-trans', !c.showTrans],
        ['hide-example', !c.showExample],
        ['hide-explain', !c.showExplain],
        ['hide-expand', !c.showExpand],
        ['hide-image', !c.showImage],
        ['hide-tags-card', !c.showTags],
        ['hide-stats', !c.showStats],
        ['pause-aurora-flow', !c.auroraFlow]
    ];
};

AnkiEngine._applyToggleMap = function (toggleMap) {
    var cl = document.documentElement.classList;
    for (var i = 0; i < toggleMap.length; i++) {
        cl.toggle(toggleMap[i][0], toggleMap[i][1]);
    }
    var body = document.body;
    if (body) body.classList.toggle('night-mode', this.config.nightMode);
};

// Drives off MENU_SPEC rather than a hand-kept short-name map (Night ->
// nightMode, SmoothCaret -> showSmoothCaret, ...). That map was a third place
// the 13 toggles were listed, after the two HTML templates, and adding a
// setting meant editing all three or the switch silently never lit up.
AnkiEngine.updateSwitches = function () {
    for (var i = 0; i < this.MENU_SPEC.length; i++) {
        var key = this.MENU_SPEC[i].key;
        var el = document.getElementById('sw_' + key);
        if (el) {
            var on = Boolean(this.config[key]);
            el.classList.toggle("checked", on);
            el.setAttribute('aria-checked', on ? 'true' : 'false');
        }
    }
};

AnkiEngine.toggleConfig = function (k) {
    this.loadConfig();
    this.config[k] = !this.config[k];
    this.saveConfig();
    this.applyConfig();
};

AnkiEngine.toggleSettings = function (e) {
    if (e) e.stopPropagation();
    this.buildSettingsMenu();
    var btn = document.getElementById('btnSettings'), menu = document.getElementById('settingsMenu');
    if (btn) {
        btn.classList.toggle('active');
        btn.setAttribute('aria-expanded', btn.classList.contains('active') ? 'true' : 'false');
    }
    if (menu) menu.classList.toggle('active');
};

AnkiEngine.closeSettings = function () {
    var btn = document.getElementById('btnSettings'), menu = document.getElementById('settingsMenu');
    if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
    }
    if (menu) menu.classList.remove('active');
};

AnkiEngine.setupEvents = function () {
    var keyMap = {
        'AltS': { check: function(e, k) { return e.altKey && (k === 's' || e.code === 'KeyS'); }, action: 'toggleSettings' },
        'AltD': { check: function(e, k) { return e.altKey && (k === 'd' || e.code === 'KeyD'); }, action: 'toggleConfig', param: 'nightMode' },
        'CtrlJ': { check: function(e, k) { return e.ctrlKey && (k === 'j' || e.code === 'KeyJ'); }, action: 'focusBtn', param: 'typeans' }
    };

    if (AnkiEngine._keydownListener) {
        document.removeEventListener("keydown", AnkiEngine._keydownListener, true);
    }
    AnkiEngine._keydownListener = function (e) {
        // Never fire shortcuts mid-IME-composition (compositionend resolves
        // the string and fires the input pipeline on its own).
        if (e.isComposing) return;
        if (e.key === 'Escape') {
            var sm = document.getElementById('settingsMenu');
            if (sm && sm.classList.contains('active')) {
                // Stop the key from falling through to Anki's global handlers
                // (possible double-action when the menu closes).
                e.preventDefault(); e.stopImmediatePropagation();
                AnkiEngine.closeSettings();
            }
        }
        var k = e.key ? e.key.toLowerCase() : '';
        for (var kn in keyMap) {
            if (keyMap[kn].check(e, k)) {
                var action = keyMap[kn].action, param = keyMap[kn].param;
                var handled = false;
                // preventDefault/stopImmediatePropagation only when the action
                // actually did something — on the Back face #typeans doesn't
                // exist, so Ctrl+J must not swallow the event for Anki.
                if (action === 'toggleSettings') { AnkiEngine.toggleSettings(); handled = true; }
                else if (action === 'toggleConfig') { AnkiEngine.toggleConfig(param); handled = true; }
                else if (action === 'focusBtn') { var el2 = document.getElementById(param); if (el2) { el2.focus(); handled = true; } }
                if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
                break;
            }
        }
    };
    document.addEventListener("keydown", AnkiEngine._keydownListener, true);

    if (AnkiEngine._docClickListener) {
        document.removeEventListener("click", AnkiEngine._docClickListener);
    }
    AnkiEngine._docClickListener = function (e) {
        var settingsMenu = document.getElementById("settingsMenu"), btnSettings = document.getElementById("btnSettings");
        if (settingsMenu && settingsMenu.classList.contains("active")) {
            if (!settingsMenu.contains(e.target) && btnSettings && !btnSettings.contains(e.target)) {
                AnkiEngine.closeSettings();
            }
        }
    };
    document.addEventListener("click", AnkiEngine._docClickListener);
};

AnkiEngine.init();

// One settings row. Built with createElement rather than innerHTML so the
// toggle listener can be attached to the node directly — these live inside
// #settingsMenu, which is inside #qa, so they die with the card and need no
// idempotence guard (unlike the menu's own click handler below).
AnkiEngine._buildMenuItem = function (spec) {
    var item = document.createElement('div');
    item.className = 'menu-item';
    item.setAttribute('data-config', spec.key);

    var label = document.createElement('span');
    label.className = 'menu-label';
    // SVG needs the namespaced factory; createElement('svg') yields an
    // unknown HTML element that renders nothing.
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'menu-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', spec.d);
    svg.appendChild(path);
    label.appendChild(svg);
    label.appendChild(document.createTextNode(spec.label));
    if (spec.shortcut) {
        var sc = document.createElement('span');
        sc.className = 'menu-shortcut';
        sc.textContent = spec.shortcut;
        label.appendChild(sc);
    }

    var toggle = document.createElement('div');
    toggle.className = 'toggle-switch';
    toggle.id = 'sw_' + spec.key;
    // Keyboard/ARIA: the toggle is a div, so expose it as a switch to AT and
    // make Space/Enter flip it. It lives inside #settingsMenu inside #qa, so it
    // dies with the card — no guard flag needed.
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-label', spec.label);
    toggle.setAttribute('aria-checked', AnkiEngine.config[spec.key] ? 'true' : 'false');
    toggle.addEventListener('click', function () { AnkiEngine.toggleConfig(spec.key); });
    toggle.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            AnkiEngine.toggleConfig(spec.key);
        }
    });

    item.appendChild(label);
    item.appendChild(toggle);
    return item;
};

AnkiEngine.buildSettingsMenu = function () {
    var menu = document.getElementById('settingsMenu');
    if (!menu) return false;
    if (menu.children.length > 0) {
        this.updateSwitches();
        return true;
    }

    var frag = document.createDocumentFragment();
    var extras = null;
    for (var i = 0; i < this.MENU_SPEC.length; i++) {
        var spec = this.MENU_SPEC[i];
        if (!spec.extra) {
            frag.appendChild(this._buildMenuItem(spec));
            continue;
        }
        if (!extras) {
            extras = document.createElement('details');
            extras.className = 'extras-dropdown';
            var summary = document.createElement('summary');
            summary.className = 'extras-trigger';
            summary.textContent = 'Mer ▾';
            extras.appendChild(summary);
            var body = document.createElement('div');
            body.className = 'extras-content';
            extras.appendChild(body);
            frag.appendChild(extras);
        }
        extras.lastChild.appendChild(this._buildMenuItem(spec));
    }

    var link = document.createElement('a');
    link.className = 'menu-link';
    link.href = 'https://facebook.com';
    // Open externally — without this the persistent Anki webview navigates away
    // from the card mid-session, losing review state.
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Följ på FB: Đăng Ngô';
    frag.appendChild(link);

    menu.appendChild(frag);
    // #settingsMenu itself is a persistent-per-card node but the guard stays:
    // buildSettingsMenu is idempotent via the children check above, and the
    // flag costs nothing while documenting the rule.
    if (!menu.__hnaClickBound) {
        menu.__hnaClickBound = true;
        menu.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    this.updateSwitches();
    return true;
};

// Built lazily on first gear click (see AnkiEngine.toggleSettings) — not here.
// Eager build ran on every flip and was the single largest retained-node source.

// Audio feedback (correct/wrong tones via Web Audio API)
window.AnkiAudio = window.AnkiAudio || {
    ctx: null,
    playTone: function (type) {
        if (!AnkiEngine.config.playSound) return;
        try {
            if (!this.ctx || this.ctx.state === 'closed') {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
            var osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
            osc.connect(gain); gain.connect(this.ctx.destination);
            var t = this.ctx.currentTime;
            if (type === 'correct') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(1000, t + 0.1);
                gain.gain.setValueAtTime(0.1, t);
                // Release envelope so the tone decays instead of clipping to silence.
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
            } else {
                // square at 180Hz: less grating than a flat 150Hz sawtooth, still
                // clearly a wrong-answer cue.
                osc.type = 'square'; osc.frequency.setValueAtTime(180, t);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
            }
            osc.start(); osc.stop(t + 0.2);
            // Release the graph nodes as soon as the tone ends; without this
            // each flip's oscillator+gain stay wired to destination until GC.
            osc.onended = function () { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
        } catch (e) { }
    }
    // NOTE: no close(). One AudioContext is deliberately kept for the whole
    // session (see the RAM-leak notes in CLAUDE.md) — closing and reopening per
    // flip churned a device thread each time. Blink suspends an idle context on
    // its own, and playTone resumes it. A close() method here had no callers and
    // was only an invitation to reintroduce the per-flip churn.
};

// NOTE: a MutationObserver on #qa used to sit here re-capturing .aurora-card and
// cancelling animations on the detached root. Measured over 80 flips it cancelled
// nothing (Blink already drops animations on detached elements) while holding a
// permanent observer + a detached card root across every flip. Removed.
window.__hnaPrevCardRoot = null;
