/* ============================================================
   HNA STORAGE MODULE
   Cross-platform storage with localStorage + cookie fallback.
   Used by both Typing and MCQ note types for configuration persistence.
   
   Exports: safeGet(), safeSet(), STORAGE_KEYS
   
   See ARCHITECTURE.md for system overview.
   ============================================================ */

// NOTE: an explicit `getAnimations().cancel()` teardown used to live here.
// Measured over 80 real flips it cancelled nothing — the previous card's root is
// always already detached, and Blink drops its animations without help
// (staleAnims === 0 at every checkpoint). Removed: it also kept a detached card
// root alive in __hnaPrevCardRoot between flips. The actual per-flip growth was
// event listeners, not compositor layers.

// Clear typing-overlay state from previous card (prevents stale globals)
window.__hnaActiveTypeansInput = null;
window.__hnaScheduleTypeansUpdate = null;

// NOTE: AnkiAudio.close() used to run here on every flip. Closing + reopening an
// AudioContext per card churns a device thread each time; one context reused for
// the whole session is cheaper and Blink suspends it when idle anyway. The
// context now persists on window.AnkiAudio across flips.

var STORAGE_KEYS = {
    CONFIG:       'anki-card-config',
    TYPED_ANSWER: 'hna-typed-answer'
};

// Learner answers are transient review state, never a durable preference.
// This TTL is only a crash/reload fallback for the current review session.
var TRANSIENT_TTL_MS = 30 * 60 * 1000;

function safeCookie() {
    try { return document.cookie || ""; } catch (e) { return ""; }
}

function safeGet(key) {
    try {
        var v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch (e) { }
    try {
        var eq = key + "=", ca = safeCookie().split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1);
            if (c.indexOf(eq) === 0) return decodeURIComponent(c.substring(eq.length));
        }
    } catch (e) { }
    return null;
}

function safeSet(key, value) {
    var ok = false;
    try { localStorage.setItem(key, value); ok = true; } catch (e) { }
    try {
        var dt = new Date();
        dt.setTime(dt.getTime() + 3650 * 864e5);
        document.cookie = key + "=" + encodeURIComponent(value) + "; expires=" + dt.toUTCString() + "; path=/; SameSite=Lax";
        ok = true;
    } catch (e) { }
    return ok;
}

function safeSetTransient(key, value) {
    var payload = JSON.stringify({ value: String(value == null ? '' : value), expiresAt: Date.now() + TRANSIENT_TTL_MS });
    try { sessionStorage.setItem(key, payload); return true; } catch (e) { return false; }
}

function safeGetTransient(key) {
    var raw;
    var payload;
    try { raw = sessionStorage.getItem(key); } catch (e) { return null; }
    if (raw === null) return null;
    try { payload = JSON.parse(raw); } catch (e) { try { sessionStorage.removeItem(key); } catch (ignore) {} return null; }
    if (!payload || typeof payload.value !== 'string' || typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) {
        try { sessionStorage.removeItem(key); } catch (ignore) {}
        return null;
    }
    return payload.value;
}

// Early nightMode injection (must run before body render to prevent flash)
try {
    var initialConf = safeGet(STORAGE_KEYS.CONFIG);
    if (initialConf && initialConf.indexOf('"nightMode":true') !== -1) {
        document.documentElement.classList.add("night-mode");
    }
} catch (e) {
    console.warn("Failed to load nightMode config");
}
