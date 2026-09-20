/* ============================================================
   HNA MCQ ENGINE
   Config, settings UI, keyboard shortcuts, audio feedback.
   Reuses AnkiEngine namespace for full theme-pack compatibility.
   ============================================================ */

window.AnkiEngine = window.AnkiEngine || {};
var AnkiEngine = window.AnkiEngine;

AnkiEngine.decodeHTML = function(html) {
    var txt = AnkiEngine.__decoder;
    if (!txt) { txt = AnkiEngine.__decoder = document.createElement("textarea"); }
    txt.innerHTML = html;
    return txt.value;
};

// ── Default Config ──────────────────────────────────────────
var defaultConfig = {
    nightMode:    false,
    shuffleChoices: true,         // Randomize option order each review
    playSound:    true,           // Web Audio chime on correct/wrong
    auroraFlow:   true,           // Aurora ribbon animation
    showExplain:  true,           // Show Explanation box on back
    showTags:     true,
    showStats:    false
};

// ── Menu Spec ─────────────────────────────────────────────────
AnkiEngine.MENU_SPEC = [
    { key: 'nightMode',      label: 'Chế độ tối',          shortcut: 'Alt+D', d: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1-8.313-12.454z' },
    { key: 'shuffleChoices', label: 'Xáo trộn đáp án',                        d: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5' },
    { key: 'playSound',      label: 'Hiệu ứng âm thanh',                      d: 'M11 5L6 9H2v6h4l5 4V5z m4 2a5 5 0 0 1 0 10m2.5-12.5a8.5 8.5 0 0 1 0 15' },
    { key: 'auroraFlow',     label: 'Hiệu ứng Aurora',                        d: 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2' },
    { key: 'showExplain',    label: 'Hiển thị giải thích', extra: true,       d: 'M12 20h.01M7 20h.01m10 0h.01M12 4v12m-4-4l4 4 4-4' },
    { key: 'showTags',       label: 'Hiển thị nhãn',       extra: true,       d: 'M7 7h10v10H7z M7 7l5 5 5-5 M7 17l5-5 5 5' },
    { key: 'showStats',      label: 'Hiển thị thống kê',   extra: true,       d: 'M3 3v18h18V3H3zm9 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }
];

// ── Config Lifecycle ─────────────────────────────────────────
function coerceConfigValue(v) {
    if (typeof v === 'string') { var s = v.toLowerCase().trim(); return s === 'true' || s === '1'; }
    if (typeof v === 'number') return v === 1;
    return Boolean(v);
}

if (!AnkiEngine.config) {
    AnkiEngine.config = {};
    for (var _dk in defaultConfig) { AnkiEngine.config[_dk] = defaultConfig[_dk]; }
} else {
    for (var _dk2 in defaultConfig) {
        if (!AnkiEngine.config.hasOwnProperty(_dk2)) AnkiEngine.config[_dk2] = defaultConfig[_dk2];
    }
}

AnkiEngine.loadConfig = function() {
    try {
        var s = safeGet(STORAGE_KEYS.CONFIG);
        if (s) {
            var p = JSON.parse(s);
            for (var k in p) {
                if (defaultConfig.hasOwnProperty(k)) this.config[k] = coerceConfigValue(p[k]);
            }
        }
    } catch(e) { console.warn("MCQ config load failed", e); }
};

AnkiEngine.saveConfig = function() {
    try { safeSet(STORAGE_KEYS.CONFIG, JSON.stringify(this.config)); } catch(e) {}
};

AnkiEngine.applyConfig = function() {
    var c = this.config;
    var toggleMap = [
        ['night-mode',         c.nightMode],
        ['pause-aurora-flow',  !c.auroraFlow],
        ['hide-explain',       !c.showExplain],
        ['hide-tags-card',     !c.showTags],
        ['hide-stats',         !c.showStats]
    ];
    var self = this;
    if (window.__mcqEngineRAF) cancelAnimationFrame(window.__mcqEngineRAF);
    window.__mcqEngineRAF = requestAnimationFrame(function() {
        window.__mcqEngineRAF = null;
        var cl = document.documentElement.classList;
        for (var i = 0; i < toggleMap.length; i++) {
            cl.toggle(toggleMap[i][0], toggleMap[i][1]);
        }
        var body = document.body;
        if (body) body.classList.toggle('night-mode', c.nightMode);
        self.updateSwitches();
    });
};

AnkiEngine.updateSwitches = function() {
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

AnkiEngine.toggleConfig = function(k) {
    this.loadConfig();
    this.config[k] = !this.config[k];
    this.saveConfig();
    this.applyConfig();
};

// ── Settings Menu ─────────────────────────────────────────────
AnkiEngine.toggleSettings = function(e) {
    if (e) e.stopPropagation();
    this.buildSettingsMenu();
    var btn = document.getElementById('btnSettings'), menu = document.getElementById('settingsMenu');
    if (btn) {
        btn.classList.toggle('active');
        btn.setAttribute('aria-expanded', btn.classList.contains('active') ? 'true' : 'false');
    }
    if (menu) menu.classList.toggle('active');
};

AnkiEngine.closeSettings = function() {
    var btn = document.getElementById('btnSettings'), menu = document.getElementById('settingsMenu');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); }
    if (menu) menu.classList.remove('active');
};

AnkiEngine._buildMenuItem = function(spec) {
    var item = document.createElement('div');
    item.className = 'menu-item';
    item.setAttribute('data-config', spec.key);

    var label = document.createElement('span');
    label.className = 'menu-label';
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
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-label', spec.label);
    toggle.setAttribute('aria-checked', AnkiEngine.config[spec.key] ? 'true' : 'false');
    toggle.addEventListener('click', function() { AnkiEngine.toggleConfig(spec.key); });
    toggle.addEventListener('keydown', function(e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); AnkiEngine.toggleConfig(spec.key); }
    });

    item.appendChild(label);
    item.appendChild(toggle);
    return item;
};

AnkiEngine.buildSettingsMenu = function() {
    var menu = document.getElementById('settingsMenu');
    if (!menu) return false;
    if (menu.children.length > 0) { this.updateSwitches(); return true; }

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
            summary.textContent = 'Tùy chọn khác ▾';
            extras.appendChild(summary);
            var body = document.createElement('div');
            body.className = 'extras-content';
            extras.appendChild(body);
            frag.appendChild(extras);
        }
        extras.lastChild.appendChild(this._buildMenuItem(spec));
    }
    menu.appendChild(frag);
    if (!menu.__mcqClickBound) {
        menu.__mcqClickBound = true;
        menu.addEventListener('click', function(e) { e.stopPropagation(); });
    }
    this.updateSwitches();
    return true;
};

// ── Keyboard Shortcuts ──────────────────────────────────────
AnkiEngine.setupEvents = function() {
    if (AnkiEngine._keydownListener) {
        document.removeEventListener("keydown", AnkiEngine._keydownListener, true);
    }
    AnkiEngine._keydownListener = function(e) {
        if (e.isComposing) return;
        var k = e.key ? e.key.toLowerCase() : '';

        // Alt+S: toggle settings menu
        if (e.altKey && (k === 's' || e.code === 'KeyS')) {
            AnkiEngine.toggleSettings(); e.preventDefault(); e.stopImmediatePropagation(); return;
        }
        // Alt+D: toggle dark mode
        if (e.altKey && (k === 'd' || e.code === 'KeyD')) {
            AnkiEngine.toggleConfig('nightMode'); e.preventDefault(); e.stopImmediatePropagation(); return;
        }
        // Escape: close settings menu
        if (e.key === 'Escape') {
            var sm = document.getElementById('settingsMenu');
            if (sm && sm.classList.contains('active')) {
                e.preventDefault(); e.stopImmediatePropagation();
                AnkiEngine.closeSettings(); return;
            }
        }

        // Digits 1-4 or letters a-d: pick an MCQ option. Keystrokes aimed
        // at an editable field pass through untouched.
        var tgt = e.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
        var slotMap = { '1': 0, 'a': 0, '2': 1, 'b': 1, '3': 2, 'c': 2, '4': 3, 'd': 3 };
        var slot = slotMap.hasOwnProperty(k) ? slotMap[k] : -1;
        if (slot < 0) {
            // Layout/IME-proof fallback: physical key positions.
            var code = e.code || '';
            var m = /^(?:Digit|Numpad)([1-4])$/.exec(code);
            if (m) slot = parseInt(m[1], 10) - 1;
            else {
                var lm = /^Key([A-D])$/.exec(code);
                if (lm) slot = lm[1].charCodeAt(0) - 65;
            }
        }
        if (!e.altKey && !e.ctrlKey && !e.metaKey && slot >= 0) {
            var btn = document.querySelector('.mcq-option-btn[data-slot="' + slot + '"]');
            if (btn && !btn.disabled) { btn.click(); e.preventDefault(); e.stopImmediatePropagation(); }
        }
    };
    document.addEventListener("keydown", AnkiEngine._keydownListener, true);

    if (AnkiEngine._docClickListener) {
        document.removeEventListener("click", AnkiEngine._docClickListener);
    }
    AnkiEngine._docClickListener = function(e) {
        var settingsMenu = document.getElementById("settingsMenu"), btnSettings = document.getElementById("btnSettings");
        if (settingsMenu && settingsMenu.classList.contains("active")) {
            if (!settingsMenu.contains(e.target) && btnSettings && !btnSettings.contains(e.target)) {
                AnkiEngine.closeSettings();
            }
        }
    };
    document.addEventListener("click", AnkiEngine._docClickListener);
};

AnkiEngine.init = function() {
    this.loadConfig();
    this.applyConfig();
    this.setupEvents();
    var self = this;
    if (window.__mcqEngineInitRAF) cancelAnimationFrame(window.__mcqEngineInitRAF);
    window.__mcqEngineInitRAF = requestAnimationFrame(function() {
        window.__mcqEngineInitRAF = null;
        self.updateSwitches();
    });
};

AnkiEngine.init();

// ── Web Audio Feedback Synthesizer ───────────────────────────
// Zero-asset: no external .mp3 files needed.
window.AnkiAudio = window.AnkiAudio || {
    ctx: null,
    playTone: function(type) {
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
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, t);          // E5
                osc.frequency.exponentialRampToValueAtTime(880, t + 0.15); // A5
                gain.gain.setValueAtTime(0.12, t);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
                osc.start(); osc.stop(t + 0.35);
            } else {
                osc.type = 'square';
                osc.frequency.setValueAtTime(180, t);
                osc.frequency.exponentialRampToValueAtTime(130, t + 0.25);
                gain.gain.setValueAtTime(0.08, t);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
                osc.start(); osc.stop(t + 0.25);
            }
            osc.onended = function() { try { osc.disconnect(); gain.disconnect(); } catch(_e) {} };
        } catch(_e) {}
    }
};
