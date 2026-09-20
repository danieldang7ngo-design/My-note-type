/* ============================================================
   HNA MCQ LOGIC MODULE
   Handles Fisher-Yates shuffle, State management (Front -> Back),
   and Anki Flip bridge for the MCQ Note Type.
   ============================================================ */

window.AnkiMCQ = window.AnkiMCQ || {};

(function() {
    var AnkiMCQ = window.AnkiMCQ;
    
    // Note fields are untrusted content. Extract rendered text; never carry
    // field HTML into a dynamic sink.
    AnkiMCQ.getRawChoicesFromDOM = function() {
        var elements = document.querySelectorAll('.mcq-raw-ans');
        var choices = [];
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var text = (el.textContent || el.innerText || '').replace(/^\s+|\s+$/g, '');
            if (text.length > 0 && text.indexOf('{{') === -1) {
                choices.push({ text: text, isCorrect: el.getAttribute('data-correct') === 'true' });
            }
        }
        return choices;
    };

    AnkiMCQ.destroyFront = function() {
        if (window.__hnaMCQKeydown) {
            document.removeEventListener('keydown', window.__hnaMCQKeydown, true);
            window.__hnaMCQKeydown = null;
        }
    };

    // Standard Fisher-Yates Shuffle (ES5 compatible)
    AnkiMCQ.shuffleChoices = function(rawChoices) {
        var items = rawChoices.slice();
        for (var j = items.length - 1; j > 0; j--) {
            var randIdx = Math.floor(Math.random() * (j + 1));
            var temp = items[j];
            items[j] = items[randIdx];
            items[randIdx] = temp;
        }
        return items;
    };

    // Full rendered text prevents collisions between cards sharing a prefix.
    AnkiMCQ.getCardSignature = function() {
        var nodes = document.querySelectorAll('.mcq-raw-ans, #mcq-question-raw');
        var out = [];
        for (var i = 0; i < nodes.length; i++) out.push(nodes[i].textContent || nodes[i].innerText || '');
        return out.join('\u001f');
    };

    AnkiMCQ.clearState = function() {
        window.__hnaMCQState = null;
        try { sessionStorage.removeItem('hna-mcq-state'); } catch(e) {}
    };

    AnkiMCQ.isValidState = function(state, choices) {
        return !!(state && state.sig === AnkiMCQ.getCardSignature() &&
            state.expiresAt > Date.now() && Array.isArray(state.shuffledOrder) &&
            typeof state.chosenIndex === 'number' && state.chosenIndex >= 0 &&
            state.chosenIndex < state.shuffledOrder.length &&
            state.shuffledOrder.length === choices.length);
    };

    // Save state once, then trigger Anki's flip.
    AnkiMCQ.selectAndFlip = function(chosenIndex, shuffledOrder) {
        var state;
        if (window.__hnaMCQAnswered) return;
        if (typeof chosenIndex !== 'number' || chosenIndex < 0 || chosenIndex >= shuffledOrder.length) return;
        window.__hnaMCQAnswered = true;
        state = {
            sig: AnkiMCQ.getCardSignature(),
            shuffledOrder: shuffledOrder,
            chosenIndex: chosenIndex,
            expiresAt: Date.now() + 300000
        };
        
        window.__hnaMCQState = state;
        try { sessionStorage.setItem('hna-mcq-state', JSON.stringify(state)); } catch(e) {}

        // Visual feedback before flip
        var btns = document.querySelectorAll('.mcq-option-btn');
        if (btns[chosenIndex]) {
            btns[chosenIndex].classList.add('is-pressed');
        }

        // Anki Flip Bridge with micro-delay for UX
        setTimeout(function() {
            if (typeof pycmd !== 'undefined') {
                pycmd("ans");
            } else if (typeof showAnswer !== 'undefined') {
                showAnswer();
            } else if (window.location && window.location.href) {
                window.location.href = "anki://flip";
            }
        }, 80);
    };

    // Progressive-enhancement marker. Adding html.mcq-ready flips the CSS
    // backdoor off once the interactive grid is live. Only called after a
    // successful render (initFront/initBack below); if any build step threw
    // — or the script never ran at all — the marker stays absent and the
    // static raw answer divs remain readable, so a card is never left with
    // zero options.
    AnkiMCQ.markReady = function() {
        try {
            if (document.documentElement && document.documentElement.classList) {
                document.documentElement.classList.add('mcq-ready');
            }
        } catch (e) {}
    };

    // Render Logic for Front Face
    AnkiMCQ.initFront = function() {
        var container = document.getElementById('mcq-options-container');
        AnkiMCQ.destroyFront();
        window.__hnaMCQAnswered = false;
        // A freshly shown question carries no answer: drop any stored
        // selection, or a same-tab refresh/undo resurrects the last verdict
        // from sessionStorage on the next flip.
        AnkiMCQ.clearState();
        if (!container) return;

        var rawChoices = AnkiMCQ.getRawChoicesFromDOM();
        if (rawChoices.length === 0) return;

        // Check config whether to shuffle or preserve order
        var shouldShuffle = true;
        if (window.AnkiEngine && window.AnkiEngine.config && window.AnkiEngine.config.shuffleChoices === false) {
            shouldShuffle = false;
        }

        var list = shouldShuffle ? AnkiMCQ.shuffleChoices(rawChoices) : rawChoices;
        container.innerHTML = '';
        
        var alphabet = ['A', 'B', 'C', 'D'];
        for (var i = 0; i < list.length; i++) {
            var btn = document.createElement('button');
            btn.className = 'mcq-option-btn glass-pseudo';
            btn.type = 'button';
            btn.setAttribute('data-slot', i);
            var badge = document.createElement('div');
            var content = document.createElement('div');
            var shortcut = document.createElement('div');
            badge.className = 'option-badge';
            content.className = 'option-content';
            shortcut.className = 'option-shortcut';
            badge.textContent = alphabet[i] || (i + 1);
            content.textContent = list[i].text;
            shortcut.textContent = '[' + (i + 1) + ']';
            btn.appendChild(badge);
            btn.appendChild(content);
            btn.appendChild(shortcut);
            
            (function(idx, currentList) {
                btn.onclick = function() { AnkiMCQ.selectAndFlip(idx, currentList); };
            })(i, list);
            
            container.appendChild(btn);
        }

        AnkiMCQ.markReady();

        // Keyboard navigation
        if (window.__hnaMCQKeydown) {
            document.removeEventListener('keydown', window.__hnaMCQKeydown, true);
        }
        window.__hnaMCQKeydown = function(e) {
            if (e.isComposing) return;
            // Never hijack browser/Anki chords or keystrokes aimed at an
            // editable field — plain 1-4/a-d on the card body only.
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            var tgt = e.target;
            if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
            var key = e.key;
            var kl = (key || '').toLowerCase();
            if (key >= '1' && key <= list.length.toString()) {
                AnkiMCQ.selectAndFlip(parseInt(key) - 1, list);
                e.preventDefault();
                e.stopPropagation();
            } else if (['a', 'b', 'c', 'd'].indexOf(kl) !== -1) {
                var idx = ['a', 'b', 'c', 'd'].indexOf(kl);
                if (idx < list.length) {
                    AnkiMCQ.selectAndFlip(idx, list);
                    e.preventDefault();
                    e.stopPropagation();
                }
            } else {
                // Layout/IME-proof fallback: physical key positions, same
                // house pattern as the engine's Alt+S/Alt+D shortcuts.
                var code = e.code || '';
                var m = /^(?:Digit|Numpad)([1-4])$/.exec(code);
                var cidx = -1;
                if (m) {
                    cidx = parseInt(m[1], 10) - 1;
                } else {
                    var lm = /^Key([A-D])$/.exec(code);
                    if (lm) cidx = lm[1].charCodeAt(0) - 65;
                }
                if (cidx >= 0 && cidx < list.length) {
                    AnkiMCQ.selectAndFlip(cidx, list);
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };
        document.addEventListener('keydown', window.__hnaMCQKeydown, true);

        AnkiMCQ.scheduleFit();
    };

    // Render Logic for Back Face
    AnkiMCQ.initBack = function() {
        var container = document.getElementById('mcq-options-container');
        var verdict = document.getElementById('mcq-verdict-container');
        if (verdict) {
            verdict.setAttribute('role', 'status');
            verdict.setAttribute('aria-live', 'polite');
        }
        if (!container) return;

        var rawChoices = AnkiMCQ.getRawChoicesFromDOM();

        // Try to recover state
        var state = window.__hnaMCQState;
        if (!state) {
            try { state = JSON.parse(sessionStorage.getItem('hna-mcq-state')); } catch(e) {}
        }

        var sig = AnkiMCQ.getCardSignature();
        if (state && AnkiMCQ.isValidState(state, rawChoices)) {
            // State is valid: use stored shuffle and index
            var shuffled = state.shuffledOrder;
            var chosenIndex = state.chosenIndex;
        } else {
            // Invalid or missing state: clear and fallback to raw order
            window.__hnaMCQState = null;
            try { sessionStorage.removeItem('hna-mcq-state'); } catch(e) {}
            var shuffled = rawChoices;
            var chosenIndex = -1;
        }

        container.innerHTML = '';
        var alphabet = ['A', 'B', 'C', 'D'];
        var isCorrectChoice = false;

        for (var i = 0; i < shuffled.length; i++) {
            var item = shuffled[i];
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', (i === chosenIndex) ? 'true' : 'false');
            btn.className = 'mcq-option-btn glass-pseudo is-static';
            
            var hasStatus = false;
            if (item.isCorrect) {
                btn.classList.add('is-correct');
                hasStatus = true;
                if (i === chosenIndex) isCorrectChoice = true;
            } else if (i === chosenIndex) {
                btn.classList.add('is-wrong');
                hasStatus = true;
            } else if (chosenIndex !== -1) {
                btn.classList.add('is-dimmed');
            }

            // Note fields are untrusted content (BUG-034): every label — badge
            // letter, option text, status caption — is bound with textContent,
            // never innerHTML. A field that renders like "<b>…</b>" stays a
            // plain-text string instead of becoming a DOM element.
            var badge = document.createElement('div');
            badge.className = 'option-badge';
            badge.textContent = alphabet[i] || (i + 1);
            var content = document.createElement('div');
            content.className = 'option-content';
            content.textContent = item.text;
            btn.appendChild(badge);
            btn.appendChild(content);
            if (hasStatus) {
                var status = document.createElement('span');
                status.className = item.isCorrect ? 'status-badge correct' : 'status-badge wrong';
                status.textContent = item.isCorrect ? '✓ Đáp án đúng' : '✗ Lựa chọn của bạn';
                btn.appendChild(status);
            }

            container.appendChild(btn);
        }

        AnkiMCQ.markReady();

        // Render Verdict
        if (verdict) {
            if (chosenIndex === -1) {
                // No selection (flipped without answering, or state lost —
                // deliberately not distinguished): counts as wrong, while the
                // correct slot is still flagged below.
                verdict.innerHTML = '<div class="verdict-banner wrong">✗ BỎ TRỐNG — TÍNH LÀ SAI</div>';
                if (window.AnkiAudio) AnkiAudio.playTone('wrong');
            } else if (isCorrectChoice) {
                verdict.innerHTML = '<div class="verdict-banner correct">✓ CHÍNH XÁC! 🎉</div>';
                if (window.AnkiAudio) AnkiAudio.playTone('correct');
            } else {
                verdict.innerHTML = '<div class="verdict-banner wrong">✗ CHƯA CHÍNH XÁC</div>';
                if (window.AnkiAudio) AnkiAudio.playTone('wrong');
            }
        }

        AnkiMCQ.scheduleFit();
    };

    /* ────────────────────────────────────────────────────────────
       AUTO-FIT: thu nhỏ card vừa khít màn hình, không cần cuộn.
       Đo chiều cao tự nhiên của card; nếu vượt viewport thì áp
       transform: scale(k) với gốc trên-giữa (card co đều, chữ nét,
       không bị cắt như overflow/clip).
       ──────────────────────────────────────────────────────────── */
    AnkiMCQ.fitCardToViewport = function() {
        var card = document.querySelector('.aurora-card');
        var wrapper = document.querySelector('.card-wrapper');
        if (!card || !wrapper) return;

        // offsetHeight không chịu ảnh hưởng transform → luôn là chiều cao tự nhiên
        var natural = card.offsetHeight;
        if (!natural) return;

        var avail = window.innerHeight;
        try {
            var bs = window.getComputedStyle(document.body);
            var ws = window.getComputedStyle(wrapper);
            avail -= (parseFloat(bs.paddingTop) || 0) + (parseFloat(bs.paddingBottom) || 0);
            avail -= (parseFloat(ws.paddingTop) || 0) + (parseFloat(ws.paddingBottom) || 0);
        } catch (e) {}
        avail -= 4; // biên an toàn

        if (avail <= 0 || natural <= avail) {
            // Fits or has room → no scale; CSS margin:auto centres the card
            card.style.removeProperty('transform');
            card.style.removeProperty('transform-origin');
            card.style.removeProperty('margin');
            return;
        }

        // Last-resort safety net only: the compact size pass fits the target
        // matrix (360x640 … 1440x900) without scaling. Floor at 0.75 so type
        // never drops below a legible size; if it still overflows, the page
        // scrolls (html/body overflow-y:auto).
        var MIN_SCALE = 0.75;
        var scale = Math.max(avail / natural, MIN_SCALE);

        // Scale from the centre so the card stays optically centred. Do NOT
        // force margin here — CSS margin:auto already centres the flex item
        // and collapses to 0 on overflow (overflow-safe centering).
        card.style.transformOrigin = 'center center';
        card.style.transform = 'scale(' + scale + ')';
    };

    // Gọi lại vài lần: sau render, sau khi font / ảnh / MathJax load xong
    AnkiMCQ.scheduleFit = function() {
        AnkiMCQ.fitCardToViewport();
        setTimeout(AnkiMCQ.fitCardToViewport, 120);
        setTimeout(AnkiMCQ.fitCardToViewport, 450);
        setTimeout(AnkiMCQ.fitCardToViewport, 1200);
    };

    // Xoay màn hình / đổi kích thước cửa sổ → tính lại
    // (guard: môi trường test Node không có window.addEventListener)
    if (typeof window !== 'undefined' && window.addEventListener) {
        var __fitRafPending = false;
        window.addEventListener('resize', function() {
            if (__fitRafPending) return;
            __fitRafPending = true;
            (window.requestAnimationFrame || function(cb) { setTimeout(cb, 60); })(function() {
                __fitRafPending = false;
                AnkiMCQ.fitCardToViewport();
            });
        });
    }
})();
