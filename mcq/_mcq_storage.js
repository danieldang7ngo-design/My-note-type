/* ============================================================
   HNA MCQ STORAGE MODULE
   Cross-platform storage with localStorage + cookie fallback,
   plus specific State persistence for Front-to-Back MCQ flips.
   ============================================================ */

var STORAGE_KEYS = {
    CONFIG: 'anki-card-config', // Same key to share settings with general HNA type if wanted
    MCQ_STATE: 'hna-mcq-state'
};

function safeCookie() {
    try { return document.cookie || ""; } catch (e) { return ""; }
}

function safeGet(key) {
    // 1. Check Session Storage first (best for front->back state)
    try {
        var sv = sessionStorage.getItem(key);
        if (sv !== null) return sv;
    } catch(e) {}
    
    // 2. Check Local Storage
    try {
        var lv = localStorage.getItem(key);
        if (lv !== null) return lv;
    } catch (e) {}

    // 3. Check Cookies
    try {
        var eq = key + "=", ca = safeCookie().split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1);
            if (c.indexOf(eq) === 0) return decodeURIComponent(c.substring(eq.length));
        }
    } catch (e) {}

    return null;
}

function safeSet(key, value) {
    var ok = false;

    // Use Session Storage specifically for MCQ_STATE (ephemeral review state)
    if (key === STORAGE_KEYS.MCQ_STATE) {
        try { sessionStorage.setItem(key, value); return true; } catch(e) { return false; }
    }

    try { localStorage.setItem(key, value); ok = true; } catch (e) {}
    try {
        var dt = new Date();
        dt.setTime(dt.getTime() + 3650 * 864e5);
        document.cookie = key + "=" + encodeURIComponent(value) + "; expires=" + dt.toUTCString() + "; path=/; SameSite=Lax";
        ok = true;
    } catch (e) {}
    return ok;
}

// Early nightMode injection
try {
    var initialConf = safeGet(STORAGE_KEYS.CONFIG);
    if (initialConf && initialConf.indexOf('"nightMode":true') !== -1) {
        document.documentElement.classList.add("night-mode");
    }
} catch (e) {
    console.warn("Failed to load nightMode config");
}
