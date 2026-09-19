/* ============================================================
   HNA AURORA SINGLETON
   Keeps the blurred aurora-bg layer alive once per REVIEW SESSION instead
   of letting Anki's per-card #qa innerHTML swap destroy and rebuild it
   (and its filter:blur() compositing layer) on every flip. This is what
   was accumulating RAM even with Perf Mode / Aurora Flow toggled off —
   those only hid or paused the layer, they didn't stop it from being
   recreated. This file removes the recreation entirely.
   Dependencies: none. Safe to load in any order relative to the other
   _hna_* scripts; it doesn't touch AnkiEngine or the typing/diff modules.
   ============================================================ */

(function () {
    function ensureHost() {
        var host = document.getElementById('hna-aurora-host');
        if (host) return host;

        host = document.createElement('div');
        host.id = 'hna-aurora-host';
        host.className = 'hna-aurora-host';
        // Session-lifetime markup: the two blurred ribbon layers. This host
        // is created ONCE and never re-innerHTML'd, so the mid layer costs
        // one fixed rasterization (same class of cost as the base ribbon),
        // not a per-flip one.
        host.innerHTML = '<div class="aurora-bg"></div><div class="aurora-bg aurora-bg--mid"></div>';

        // Insert as <body>'s very first child, once, for the whole
        // session. Never removed, never recreated from here on.
        document.body.insertBefore(host, document.body.firstChild);
        return host;
    }

    function syncAurora() {
        var host = ensureHost();

        // Host mirrors the card box exactly at every breakpoint (the old
        // <=768 fullscreen !important override is gone so the static
        // body::before backdrop can show around the card). The aurora
        // layers inside are proportional (%-based insets/travel), so the
        // animation scales to whatever size the card is.
        var card = document.querySelector('.aurora-card');
        if (!card) {
            // Don't hide the host on transient no-card states (flip gap).
            // The host stays at its last known position and opacity; the
            // next sync (animationend / MutationObserver) will re-position it.
            return;
        }
        var rect = card.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // not laid out yet, retry next pass

        // The host is position:absolute (so it scrolls with the card and
        // stays aligned with the in-flow glass-pseudo layers on mobile/
        // tablet where the back card is taller than the viewport), so it
        // needs DOCUMENT coordinates, not the viewport-relative rect.
        // body is position:relative, so it is the host's containing block —
        // and body is the real scroll container on phones (html, body get
        // height:100% + overflow-y:auto). Content coordinates = viewport
        // rect minus body's own rect, plus body's internal scroll offset.
        // This stays correct whether the window scrolls (bodyRect shifts,
        // body scroll* = 0) or body alone scrolls (bodyRect is fixed,
        // scroll* grows). Since the host lives inside body, it travels with
        // the card automatically — no scroll listener is needed, so the RAM
        // audit's listener budget is untouched.
        var body = document.body;
        var br = body ? (body.getBoundingClientRect ? body.getBoundingClientRect() : null) : null;
        var ox = br ? br.left : 0;
        var oy = br ? br.top : 0;
        var sx = body ? (body.scrollLeft || 0) : 0;
        var sy = body ? (body.scrollTop || 0) : 0;
        host.style.left = (rect.left - ox + sx) + 'px';
        host.style.top = (rect.top - oy + sy) + 'px';
        host.style.width = rect.width + 'px';
        host.style.height = rect.height + 'px';

        var radius = getComputedStyle(card).borderRadius;
        if (radius) host.style.borderRadius = radius;

        host.classList.add('hna-aurora-visible');
    }

    function scheduleSync() {
        // One-shot double-rAF (RAM audit rule): cancel a pending sync before
        // re-scheduling so a resize/flip storm cannot pile up chained frames;
        // the handle is cleared once the second frame has run.
        if (window.__hnaAuroraSync) cancelAnimationFrame(window.__hnaAuroraSync);
        window.__hnaAuroraSync = requestAnimationFrame(function () {
            syncAurora();
            // Fonts/images can still reflow the card after first paint
            // (word-wrap, image decode) — re-measure one more frame later
            // so the halo doesn't sit at a stale size/position.
            window.__hnaAuroraSync = requestAnimationFrame(function () {
                window.__hnaAuroraSync = null;
                syncAurora();
            });
        });
    }

    scheduleSync();

    // All four re-sync paths run at every breakpoint now: the host is
    // card-sized everywhere, so it must re-measure after each flip, resize,
    // and card reflow (details open, image load) on phones/tablets too.

    // NOTE: the listener is on document, not on a specific .aurora-card.
    //    Per-card listeners (the previous approach) were attached once at
    //    load time to the first card seen — they died with that card and
    //    never fired for subsequent flips, so the re-sync below only ran
    //    on card 1. document-level capture catches every flip.
    //
    //    A MutationObserver on #qa is also present because Anki's
    //    innerHTML swap can abort the appearing animation mid-flight
    //    (e.g. on very fast flips), leaving animationend un-fired and
    //    the aurora host still sized to the old card. The observer
    //    catches the swap itself, not the animation ending.
    var qaEl = document.getElementById('qa');
    if (qaEl && typeof MutationObserver !== 'undefined') {
        var __hnaAuroraMO = window.__hnaAuroraMO;
        if (!__hnaAuroraMO) {
            __hnaAuroraMO = window.__hnaAuroraMO = new MutationObserver(function (records) {
                // Filter to the card swap itself. This observer sits on #qa with
                // subtree:true, so WITHOUT the filter it also fires on every
                // childList mutation deeper inside the card — the typing
                // overlay's extra-span insert/remove and the Back-face diff-row
                // rebuild being the per-keystroke ones. Each batch then ran two
                // rAFs doing getBoundingClientRect + getComputedStyle, i.e. the
                // aurora was doing forced layout work on every over-typed char.
                // Anki's flip replaces #qa's children directly, so every swap
                // record has target === qaEl (or adds an .aurora-card subtree).
                for (var i = 0; i < records.length; i++) {
                    if (records[i].target === qaEl) { scheduleSync(); return; }
                    var added = records[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var n = added[j];
                        if (n.classList && n.classList.contains('aurora-card')) { scheduleSync(); return; }
                    }
                }
            });
        }
        __hnaAuroraMO.observe(qaEl, { childList: true, subtree: true });
    }
    if (!window.__hnaAuroraAnimEndBound) {
        window.__hnaAuroraAnimEndBound = true;
        document.addEventListener('animationend', function (e) {
            if (!e.target.classList.contains('aurora-card')) return;
            // Single-tier: hna-card-appear is the only card-appear animation
            // name (the uq-card-appear branch was removed with the tier split).
            if (e.animationName === 'hna-card-appear') syncAurora();
        });
    }

    // Re-sync if the card's own box size changes after the fact (details/
    // summary expand, image load) without recreating anything. One
    // persistent ResizeObserver for the whole session, just re-targeted
    // to whichever .aurora-card exists on the current card.
    if (typeof ResizeObserver !== 'undefined') {
        var ro = window.__hnaAuroraRO;
        if (!ro) {
            ro = window.__hnaAuroraRO = new ResizeObserver(function () {
                syncAurora();
            });
        } else {
            ro.disconnect();
        }
        var cardEl = document.querySelector('.aurora-card');
        if (cardEl) ro.observe(cardEl);
    }

    if (!window.__hnaAuroraResizeBound) {
        window.__hnaAuroraResizeBound = true;
        // visualViewport fires only for real viewport changes (KVB open/close,
        // pinch zoom), not for full-screen/landscape toggles which are already
        // handled by MutationObserver + scheduleSync. The handler re-syncs the
        // card-sized host on mobile too, so the halo tracks the card when the
        // VKB resizes the viewport.
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleSync, { passive: true });
        } else {
            window.addEventListener('resize', scheduleSync);
        }
    }
})();
