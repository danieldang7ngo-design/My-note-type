/* ============================================================
   HNA TYPING OVERLAY
   Real-time character-by-character feedback for Front card
   Dependencies: AnkiEngine.decodeHTML, AnkiEngine.buildSettingsMenu, safeSet, STORAGE_KEYS
   ============================================================ */

(function () {
    var _retryCount = 0;
    var _gapCursorSpan = null;
    var _lastCursor = -1;
    var _retryRAF = null;

    // BUG FIX: the unicode-property letter regex used to be a LITERAL
    // (/[\p{L}\p{N}]/u). Property escapes are a Chromium 64+ feature; on older
    // QtWebEngine the WHOLE SCRIPT failed to PARSE (SyntaxError) before any
    // try/catch could run, so the ASCII fallback below was dead code and the
    // typing module died entirely. Building the regex at runtime makes a parse
    // error impossible. Defined once at module scope, not per call.
    var PLACEHOLDER_LETTER_RE = null;
    try { PLACEHOLDER_LETTER_RE = new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (e) { PLACEHOLDER_LETTER_RE = null; }

    // Kill the previous card's pending work before starting our own. Anki swaps
    // #qa without a reload, so a retry chain / init timer from the last card
    // otherwise keeps running against a detached overlay and pins its whole
    // subtree alive. This is what actually accumulated across a session.
    if (window.__hnaTypingRAF) { cancelAnimationFrame(window.__hnaTypingRAF); window.__hnaTypingRAF = null; }
    if (window.__hnaTypingTimer) { clearTimeout(window.__hnaTypingTimer); window.__hnaTypingTimer = null; }
    if (window.__hnaIsTypingTimer) { clearTimeout(window.__hnaIsTypingTimer); window.__hnaIsTypingTimer = null; }
    // Flush any pending debounced storage write so the previous card's typed
    // answer still reaches storage across the flip — the Back-face diff reads
    // __hnaTypedAnswerBuffer first, but this keeps the crash-fallback channel
    // honest even if that global were lost.
    if (window.__hnaPersistTimer) {
        clearTimeout(window.__hnaPersistTimer);
        window.__hnaPersistTimer = null;
        if (typeof window.__hnaTypedAnswerBuffer === 'string') {
            try { safeSetTransient(STORAGE_KEYS.TYPED_ANSWER, window.__hnaTypedAnswerBuffer); } catch (e) { }
        }
    }
    if (window.__hnaActiveTypeansInput) { window.__hnaActiveTypeansInput = null; }
    if (window.__hnaScheduleTypeansUpdate) { window.__hnaScheduleTypeansUpdate = null; }

    // FIX: Remove old listener before adding new one
    if (window.__hnaSelectionListener) {
        document.removeEventListener('selectionchange', window.__hnaSelectionListener);
    }
    window.__hnaSelectionListener = function () {
        if (window.__hnaActiveTypeansInput && document.activeElement === window.__hnaActiveTypeansInput) {
            if (typeof window.__hnaScheduleTypeansUpdate === 'function') {
                window.__hnaScheduleTypeansUpdate();
            }
        }
    };
    document.addEventListener('selectionchange', window.__hnaSelectionListener);

    function initTypeAnswer() {
        var input = document.querySelector('input#typeans');
        var overlay = document.getElementById('typeans-overlay');
        var smoothCaret = document.getElementById('smooth-caret');
        var correctAnswerSpan = document.getElementById('correct-answer');

        // Back cards have no overlay at all — nothing to retry for. Without this
        // every Back card burned a 100-frame retry chain looking for an input
        // that is never coming.
        if (!overlay) return;

        if (!input) {
            if (_retryCount < 100) {
                _retryCount++;
                _retryRAF = requestAnimationFrame(initTypeAnswer);
                window.__hnaTypingRAF = _retryRAF;
            }
            return;
        }

        // Cancel any pending retry RAF
        if (_retryRAF) {
            cancelAnimationFrame(_retryRAF);
            _retryRAF = null;
            window.__hnaTypingRAF = null;
        }

        window.__hnaActiveTypeansInput = input;

        // Persist what the user typed. The in-memory buffer is the source of
        // truth for the Back-face diff; storage is only a crash fallback.
        //
        // The in-memory buffer is written synchronously — the Back-face diff
        // reads window.__hnaTypedAnswerBuffer before it ever touches storage,
        // so a flip is always covered. Storage (localStorage + cookie) is a
        // crash/restart fallback only, so it is deduped and trailing-debounced:
        // before this, one physical keystroke fired both `input` and `keyup`,
        // each writing localStorage AND a 10-year cookie — 4 storage writes per
        // character. The timer is registered on a window handle so a flip
        // cancels the pending write instead of re-persisting the old card.
        var _lastPersisted = null;
        function persistTypedAnswer() {
            window.__hnaTypedAnswerBuffer = input.value;
            if (input.value === _lastPersisted) return;
            _lastPersisted = input.value;
            clearTimeout(window.__hnaPersistTimer);
            window.__hnaPersistTimer = setTimeout(function () {
                window.__hnaPersistTimer = null;
                try { safeSetTransient(STORAGE_KEYS.TYPED_ANSWER, input.value); } catch(e) {}
            }, 200);
        }

        if (!correctAnswerSpan) {
            if (_retryCount < 100) {
                _retryCount++;
                _retryRAF = requestAnimationFrame(initTypeAnswer);
                window.__hnaTypingRAF = _retryRAF;
            }
            return;
        }

        var ankiCenterTag = input.parentElement;
        if (ankiCenterTag && ankiCenterTag.tagName === 'CENTER') {
            var parentWrapper = ankiCenterTag.parentElement;
            if (parentWrapper) {
                parentWrapper.insertBefore(input, ankiCenterTag);
                parentWrapper.removeChild(ankiCenterTag);
            }
        }

        input.style.position = 'absolute';
        input.style.opacity = '0';
        input.style.pointerEvents = 'auto';
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.left = '0';
        input.style.top = '0';
        input.style.zIndex = '1';
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');

        // ".swedish-word logic": {{word}} renders into span.swedish-word on
        // the Back face as raw HTML, so a <br> in the note field shows there
        // as a REAL line break. The overlay now does the same — the shared
        // parser keeps <br> as \n instead of dropping it with the tags, and
        // buildInitialDOM turns every \n into an actual line break. NO
        // whitespace collapsing: multi-line answers display line by line,
        // exactly like the headword they are rehearsing.
        var correctAnswer = AnkiEngine.decodeAnswerField(correctAnswerSpan.innerHTML).trim();
        var totalChars = correctAnswer.length;
        var flatCharSpans = [];

        // Precomputed per-character invariants. These depend ONLY on
        // correctAnswer, never on what was typed — so recomputing
        // toLowerCase() and the \p{L}\p{N} regex state on every keystroke
        // (once per char in the shared prefix + once per placeholder char)
        // was pure waste. Built once here, read-only in updateDisplay.
        // placeholderStates pairs with typeableSlots one-to-one.
        var placeholderStates = [];
        // correctAnswer indices the user actually types for. A line break is
        // LAYOUT, not content — the caret jumps it and no keystroke fills it
        // (a single-line input cannot even produce \n), so every comparison
        // below walks this slot list instead of raw indices.
        var typeableSlots = [];
        // typeableIndexByPos[answerPos] = the typeable ORDER of that answer
        // position, or -1 when the position is a separator/break that a
        // learner never fills with a letter (spaces are jumped over by
        // typing a space — a real separator swallows that keystroke).
        var typeableIndexByPos = [];

        // One group collects everything typed past the answer so the extras are
        // a single "extra word/token" unit (.word-extra), not stray spans.
        var extraGroupEl = null;

        function makePlaceholderSpan(cls, text) {
            var span = document.createElement('span');
            span.className = cls;
            span.textContent = text;
            return span;
        }

        function getPlaceholderState(c) {
            if (c === '\n') return { cls: 'char-linebreak', text: '' };
            // A real space text (not '') so the overlay's text-align: justify
            // has collapsible whitespace to spread — wrapped answer lines then
            // fill the full card width instead of hugging left.
            if (c === ' ') return { cls: 'char-space-placeholder', text: ' ' };
            // Runtime-built regex first (null on engines without property
            // escapes), then the ASCII fallback, then the punctuation hint.
            if (PLACEHOLDER_LETTER_RE && PLACEHOLDER_LETTER_RE.test(c)) return { cls: 'char-placeholder', text: '_' };
            if (/[a-zA-Z0-9À-ɏ]/i.test(c)) return { cls: 'char-placeholder', text: '_' };
            return { cls: 'char-punctuation-hint', text: c };
        }

        function buildInitialDOM() {
            while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
            flatCharSpans = [];
            placeholderStates = [];
            typeableSlots = [];
            typeableIndexByPos = [];
            // _extraGroupEl may survive from a previous card's overlay; any
            // node inside is a stale reference to a detached tree, so clear it.
            extraGroupEl = null;
            var currentWordEls = [];
            var flushWord = function (beforeEl) {
                if (currentWordEls.length === 0) return;
                var wordEl = document.createElement('span');
                wordEl.className = 'word-group';
                for (var w = 0; w < currentWordEls.length; w++) wordEl.appendChild(currentWordEls[w]);
                overlay.insertBefore(wordEl, beforeEl);
                currentWordEls = [];
            };
            for (var i = 0; i < correctAnswer.length; i++) {
                var c = correctAnswer[i];
                var isSpace = (c === ' ');
                var isBreak = (c === '\n');
                var placeholder = getPlaceholderState(c);
                placeholderStates.push(placeholder);
                // Every non-newline answer position is typeable IN ORDER —
                // spaces included, so a correctly typed multi-word answer
                // aligns 1:1 with the answer (the learner's own separator
                // lands exactly on the answer's separator). orderIdx is the
                // position in that all-inclusive slot list.
                var orderIdx = -1;
                if (!isBreak) {
                    typeableSlots.push(i);
                    orderIdx = typeableSlots.length - 1;
                }
                typeableIndexByPos[i] = orderIdx;
                var span = makePlaceholderSpan(placeholder.cls, placeholder.text);
                if (isSpace || isBreak) {
                    // Spaces AND line breaks end the current word-group; a
                    // break additionally starts a new visual line. The
                    // separator must be IN the overlay before insertBefore
                    // uses it as the anchor for the flushed word group.
                    overlay.appendChild(span);
                    flushWord(span);
                } else {
                    currentWordEls.push(span);
                }
                flatCharSpans.push(span);
            }
            flushWord(null);
            if (smoothCaret) overlay.appendChild(smoothCaret);
        }

        buildInitialDOM();
        // Clear BOTH stale-answer channels: the diff on Back reads
        // window.__hnaTypedAnswerBuffer before it ever looks at storage, so
        // clearing storage alone let last card's answer leak into this one.
        window.__hnaTypedAnswerBuffer = '';
        try { sessionStorage.removeItem(STORAGE_KEYS.TYPED_ANSWER); } catch(e) {}

        var _updatePending = false;
        var _caretPending = false;

        function scheduleUpdate() {
            if (_updatePending) return;
            _updatePending = true;
            requestAnimationFrame(function () {
                _updatePending = false;
                updateDisplay();
            });
        }

        window.__hnaScheduleTypeansUpdate = scheduleUpdate;

        // cursorRect is the active cursor's DOM rect captured by updateDisplay
        // in the same frame the spans changed. Passing it through avoids the
        // second querySelector + rect read; the rAF only re-reads the overlay
        // rect (needed for the transform origin) and writes the transform.
        function scheduleCaretUpdate(skipSameCursor, cursorRect) {
            if (skipSameCursor) return;
            if (_caretPending) return;
            _caretPending = true;
            requestAnimationFrame(function () {
                _caretPending = false;
                if (!smoothCaret) return;
                // When the user disabled the smooth caret the whole update is
                // invisible — skip the rect reads entirely.
                if (document.documentElement.classList.contains('hide-smooth-caret')) return;
                if (!overlay || !overlay.isConnected) return;
                var ovRect = overlay.getBoundingClientRect();
                if (cursorRect) {
                    smoothCaret.style.opacity = '1';
                    smoothCaret.style.transform = 'translate3d(' + (cursorRect.left - ovRect.left) + 'px, ' + (cursorRect.top - ovRect.top + overlay.scrollTop) + 'px, 0)';
                    smoothCaret.style.height = cursorRect.height + 'px';
                    return;
                }
                var activeCursor = overlay.querySelector('.active-cursor');
                if (activeCursor) {
                    var acRect = activeCursor.getBoundingClientRect();
                    smoothCaret.style.opacity = '1';
                    smoothCaret.style.transform = 'translate3d(' + (acRect.left - ovRect.left) + 'px, ' + (acRect.top - ovRect.top + overlay.scrollTop) + 'px, 0)';
                    smoothCaret.style.height = acRect.height + 'px';
                } else {
                    var lastChar = flatCharSpans[flatCharSpans.length - 1];
                    if (lastChar) {
                        var lcRect = lastChar.getBoundingClientRect();
                        smoothCaret.style.opacity = '1';
                        smoothCaret.style.transform = 'translate3d(' + (lcRect.left - ovRect.left + lcRect.width) + 'px, ' + (lcRect.top - ovRect.top + overlay.scrollTop) + 'px, 0)';
                        smoothCaret.style.height = lcRect.height + 'px';
                    } else {
                        smoothCaret.style.opacity = '0';
                    }
                }
            });
        }

        function updateDisplay() {
            if (!input || !input.isConnected) return;
            var typed = input.value;
            // Paste cap: a huge paste builds one span per char on the main
            // thread (the Back-face diff already caps its DP at 40000 cells).
            // Past 2000 chars, drop the overlay entirely — the real input still
            // holds the text, so the answer is never lost.
            if (typed.length > 2000) {
                while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
                return;
            }
            var cursorPos = (typeof input.selectionStart === 'number') ? input.selectionStart : typed.length;
            // Typed position j fills the j-th typeable answer slot IN ORDER
            // (typeableSlots includes the answer's own separators, so a
            // correctly typed multi-word answer aligns 1:1). Per-character
            // verdicts below use the same all-inclusive order space.
            var compareLen = Math.min(typeableSlots.length, typed.length);

            for (var j = 0; j < compareLen; j++) {
                var slot = typeableSlots[j];
                var cTyped = typed.charAt(j);
                var span = flatCharSpans[slot];
                if (!span) continue;
                // Defensive parity guard: single-line inputs sanitize line
                // breaks out of .value on most engines, but not every Anki
                // webview is current. If a stray \n/\t ever slips through it
                // must classify and render as a plain space.
                if (cTyped !== ' ' && /\s/.test(cTyped)) cTyped = ' ';
                var isCursor = (j === cursorPos);
                var cursorClass = isCursor ? ' active-cursor' : '';

                // Per-character verdict: every typed position is judged the
                // moment it lands (case-insensitive, same rule as the diff),
                // so the learner sees the exact character that missed the mark
                // — no waiting for the whole word to conclude. Letters carry
                // the green/red colour + underline; spaces only the underline
                // (they have no glyph worth painting).
                var match = (cTyped.toLowerCase() === correctAnswer.charAt(slot).toLowerCase());
                var newCls, newText;
                if (match) {
                    if (cTyped === ' ') {
                        newCls = 'char-correct-space';
                        newText = '';
                    } else {
                        newCls = 'char-correct';
                        newText = cTyped;
                    }
                } else {
                    if (cTyped === ' ') {
                        newCls = 'char-wrong-space';
                        newText = ' ';
                    } else {
                        newCls = 'char-wrong';
                        newText = cTyped;
                    }
                }
                newCls += cursorClass;
                if (span.className !== newCls) span.className = newCls;
                if (span.textContent !== newText) span.textContent = newText;
            }

            if (typed.length > typeableSlots.length) {
                // Everything past the answer collects as one "extra word" group
                // (.word-extra). Created lazily, removed when it empties.
                if (!extraGroupEl) {
                    extraGroupEl = document.createElement('span');
                    extraGroupEl.className = 'word-group word-extra';
                    if (smoothCaret && overlay.contains(smoothCaret)) overlay.insertBefore(extraGroupEl, smoothCaret);
                    else overlay.appendChild(extraGroupEl);
                }
                for (var x = typeableSlots.length; x < typed.length; x++) {
                    var cExtra = typed.charAt(x);
                    var extraCls, extraText;
                    if (cExtra !== ' ' && /\s/.test(cExtra)) cExtra = ' ';
                    if (cExtra === ' ') {
                        extraCls = 'char-extra-space';
                        extraText = ' ';
                    } else {
                        extraCls = 'char-extra';
                        extraText = cExtra;
                    }
                    if (x === cursorPos) extraCls += ' active-cursor';
                    // Extra spans live AFTER every real answer span; the
                    // offset by typeable count keeps them contiguous.
                    var storeIdx = correctAnswer.length + (x - typeableSlots.length);
                    var extraSpan = flatCharSpans[storeIdx];
                    if (!extraSpan) {
                        extraSpan = makePlaceholderSpan(extraCls, extraText);
                        flatCharSpans[storeIdx] = extraSpan;
                        extraGroupEl.appendChild(extraSpan);
                    } else {
                        if (extraSpan.className !== extraCls) extraSpan.className = extraCls;
                        if (extraSpan.textContent !== extraText) extraSpan.textContent = extraText;
                    }
                }
            } else if (extraGroupEl) {
                overlay.removeChild(extraGroupEl);
                extraGroupEl = null;
            }

            // Only drop spans beyond what's *currently* typed. Trimming down to
            // correctAnswer.length unconditionally used to delete the extra-char
            // spans the block above just created (whenever typed.length >
            // correctAnswer.length), so any character typed past the answer's
            // length was inserted then immediately removed in the same pass.
            var keepLen = correctAnswer.length + Math.max(0, typed.length - typeableSlots.length);
            while (flatCharSpans.length > keepLen) {
                var staleExtra = flatCharSpans.pop();
                if (staleExtra && staleExtra.parentNode) {
                    staleExtra.parentNode.removeChild(staleExtra);
                }
            }

            for (var k = typed.length; k < typeableSlots.length; k++) {
                var slotIdx = typeableSlots[k];
                var placeholderSpan = flatCharSpans[slotIdx];
                if (!placeholderSpan) continue;
                var placeholderState = placeholderStates[slotIdx];
                if (placeholderSpan.className !== placeholderState.cls) {
                    placeholderSpan.className = placeholderState.cls;
                }
                if (placeholderSpan.textContent !== placeholderState.text) {
                    placeholderSpan.textContent = placeholderState.text;
                }
            }

            if (_gapCursorSpan) {
                _gapCursorSpan.classList.remove('active-cursor');
                _gapCursorSpan = null;
            }

            if (typed.length < typeableSlots.length && cursorPos === typed.length) {
                var gapSpan = flatCharSpans[typeableSlots[typed.length]];
                if (gapSpan) {
                    gapSpan.classList.add('active-cursor');
                    _gapCursorSpan = gapSpan;
                }
            }

            // Capture the active cursor's rect ONCE and reuse it for both the
            // auto-scroll check and the caret transform. The auto-scroll only
            // needs to run when the caret actually moved — before this it read
            // two rects on EVERY keystroke (updateDisplay) and then the caret
            // rAF re-queried and re-read them again, ~4 forced layouts per key.
            var activeCursor = overlay.querySelector('.active-cursor');
            var cursorRect = null;
            var prevCursor = _lastCursor;
            if (activeCursor) {
                cursorRect = activeCursor.getBoundingClientRect();
                if (cursorPos !== prevCursor) {
                    var overlayBounds = overlay.getBoundingClientRect();
                    if (cursorRect.top < overlayBounds.top || cursorRect.bottom > overlayBounds.bottom) {
                        overlay.scrollTop += cursorRect.top - overlayBounds.top - (overlay.clientHeight - activeCursor.offsetHeight) / 2;
                    }
                }
            }

            _lastCursor = cursorPos;
            scheduleCaretUpdate(cursorPos === prevCursor, cursorRect);
        }

        var handleInputEvent = function () {
            persistTypedAnswer();
            scheduleUpdate();
            document.body.classList.add('is-typing');
            clearTimeout(window.__hnaIsTypingTimer);
            window.__hnaIsTypingTimer = setTimeout(function () {
                document.body.classList.remove('is-typing');
            }, 500);
        };

        ['input', 'keyup', 'change', 'compositionend'].forEach(function (evt) {
            input.addEventListener(evt, handleInputEvent);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                scheduleUpdate();
            }
            // Don't blur mid-IME-composition: Enter confirms the composition;
            // blurring mid-commit would drop the composed text from the overlay.
            if (e.key === 'Enter' && !e.isComposing) {
                input.blur();
            }
        });

        input.addEventListener('mouseup', scheduleUpdate);
        input.addEventListener('focus', scheduleUpdate);
        input.focus();
        scheduleUpdate();

    }

    // Delay to let Anki inject the {{type:word}} input; the retry fallback
    // inside initTypeAnswer covers delayed injection. The old
    // document.readyState === 'loading' branch is dead code inside Anki (the
    // webview is long since complete when a card renders) and registered an
    // anonymous DOMContentLoaded listener the next flip's teardown could not
    // cancel — the one documented "listener without a stored handle".
    window.__hnaTypingTimer = setTimeout(initTypeAnswer, 50);
})();