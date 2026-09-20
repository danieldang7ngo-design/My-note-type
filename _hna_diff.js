/* ============================================================
   HNA DIFF RENDERER
   Levenshtein-based visual diff for Back card
   Dependencies: AnkiEngine.decodeHTML, AnkiEngine.decodeAnswerField,
                 AnkiAudio, safeGet, STORAGE_KEYS
   ============================================================ */

(function initDiff() {
    function triggerVerdictPop(container, className) {
        if (!container) return;
        container.classList.remove('verdict-pop-correct', 'verdict-pop-wrong', 'verdict-pop-near-miss');
        if (!className) return;
        void container.offsetWidth;
        container.classList.add(className);
    }

    // Copy rendered next to the correct-answer row, keyed by the semantic
    // verdict's messageKey. The verdict itself stays language-agnostic.
    // Titles only show on single-row verdicts (exact / unanswered): the
    // side-by-side comparison view hides both row titles (see below).
    var VERDICT_LABELS = {
        'label-answer': 'Det korrekta svaret',
        'label-exact': 'Exakt!'
    };

    function renderDiff() {
        var rowT = document.getElementById("diff-input-row"), rowC = document.getElementById("diff-correct-row");
        if (!rowT || !rowC) return false;
        if (rowC.dataset.hnaRendered === '1') return true;

        // ".swedish-word logic": {{word}} reaches span.swedish-word on the Back
        // face as raw HTML — a <br> in the note field renders there as a REAL
        // line break. Reading .textContent silently drops <br>
        // ("katt<br>hund" -> "katthund"), fusing multi-line answers into one
        // unbreakable run in the diff. Parse innerHTML through the shared
        // <br>=\n parser so the diff renders the same line breaks the headword
        // shows.
        function collapseSpaceRuns(s) { return s.replace(/[^\S\n]+/g, ' '); }
        var wordEl = document.getElementById("correct-answer");
        var correctDisp = collapseSpaceRuns(
            AnkiEngine.decodeAnswerField(wordEl ? wordEl.innerHTML : "").trim()
        );
        var typedDisp = "";
        var backInput = document.querySelector('input#typeans');

        if (backInput && typeof backInput.value === 'string' && backInput.value.length > 0) {
            typedDisp = backInput.value;
        } else if (typeof window.__hnaTypedAnswerBuffer === 'string' && window.__hnaTypedAnswerBuffer.length > 0) {
            typedDisp = window.__hnaTypedAnswerBuffer;
        } else {
            try { typedDisp = safeGetTransient(STORAGE_KEYS.TYPED_ANSWER); } catch(e) { typedDisp = null; }
            if (typedDisp === null) typedDisp = "";
        }

        typedDisp = collapseSpaceRuns(AnkiEngine.decodeHTML(typedDisp).trim());
        rowC.dataset.hnaRendered = '1';

        // Comparison strings: the typing overlay makes line breaks cost NO
        // keystroke (the caret jumps them), so the aligned comparison runs on
        // the display string with \n stripped — breaks are layout, not content.
        var correct = correctDisp.split('\n').join('');
        var typed = typedDisp.split('\n').join('');

        // Semantic verdict model (Phase 2): a pure, DOM-free verdict object
        // drives every disclosure decision below — what is revealed (typed
        // row, granular diff), how the tone sounds, and which label copy
        // sits next to the correct row. Row titles only show on single-row
        // verdicts; the comparison view hides them (below). The object is
        // unit-tested differentially via
        // window.__hnaDiffInternals.computeVerdict.
        var verdict = computeVerdict(typed, correct);
        var container = document.getElementById('visual-diff-container');
        // The typing overlay judges each typed character against the answer
        // lowercased, so a case-only difference ("Katt" vs "katt") reads all
        // correct there — the verdict/tone must agree with the overlay and
        // compare lowercased (BUG-027). An unanswered recall is neutral: it
        // reveals the answer without a punitive error tone or animation.
        if (verdict.status !== 'unanswered') AnkiAudio.playTone(verdict.exact ? 'correct' : 'wrong');
        var labelC = document.querySelector('#diff-section-correct .diff-row-label');
        if (labelC) labelC.textContent = VERDICT_LABELS[verdict.messageKey] || 'Det korrekta svaret';

        function hideTypedRow() {
            var diffInputSec = document.getElementById("diff-section-input");
            if (diffInputSec) diffInputSec.style.display = 'none';
        }

        // Correct / unanswered: no typed row, no granular diff — a single
        // tinted correct-answer row is all the learner needs.
        if (!verdict.showTypedAnswer) {
            hideTypedRow();
            if (verdict.status === 'correct') {
                renderSimple(rowC, correctDisp, 'diff-tint-correct');
                triggerVerdictPop(container, 'verdict-pop-correct');
            } else {
                renderSimple(rowC, correctDisp, 'diff-tint-wrong');
                triggerVerdictPop(container, '');
            }
            return true;
        }

        // Wrong / near-miss: the typed row renders under the correct row
        // for comparison — the row titles are noise there, so hide both.
        // (Single-row verdicts above keep theirs.)
        var diffLabels = document.querySelectorAll('#visual-diff-container .diff-row-label');
        for (var li = 0; li < diffLabels.length; li++) diffLabels[li].style.display = 'none';

        // Wrong / near-miss: reveal the typed answer, aligned against the
        // correct one. Cap the DP product. The typed side is user-controlled —
        // a pasted multi-thousand-char string would allocate a (m+1)x(n+1)
        // table twice (distance pass + alignment pass) and stall the Back face
        // for ~50-100ms. 40000 cells covers ~200x200 or ~40x1000 chars, far
        // beyond any real answer. Past the cap we fall back to the plain
        // two-row render, no alignment (BUG-039).
        if (typed.length * correct.length > 40000) {
            renderSimple(rowC, correctDisp, 'diff-tint-wrong', 'diff-row-correct');
            renderSimple(rowT, typedDisp, 'diff-tint-wrong', 'diff-row-typed');
            triggerVerdictPop(container, 'verdict-pop-wrong');
            return true;
        }

        var diff = computeDiff(typed, correct);
        var verdictClass = (verdict.status === 'near-miss') ? 'verdict-pop-near-miss' : 'verdict-pop-wrong';
        renderRows(rowT, rowC, diff, correctDisp);
        triggerVerdictPop(container, verdictClass);
        return true;
    }

    function levenshteinDistance(t, c) {
        var m = t.length, n = c.length;
        var dp = new Array(m + 1);
        for (var i = 0; i <= m; i++) { dp[i] = new Array(n + 1); dp[i][0] = i; }
        for (var j = 0; j <= n; j++) dp[0][j] = j;
        for (var i = 1; i <= m; i++) {
            for (var j = 1; j <= n; j++) {
                dp[i][j] = (t[i - 1] === c[j - 1]) ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
            }
        }
        return dp[m][n];
    }

    // Semantic verdict for a typed-vs-correct comparison (Phase 2). Pure —
    // no DOM, no audio, no strings beyond the messageKey. Inputs are the
    // normalized comparison strings renderDiff builds (trimmed, whitespace
    // collapsed, \n removed); comparison is case-insensitive so the Back
    // verdict always agrees with the realtime per-character overlay (BUG-027).
    //
    //   status          exact  nearest distance  disclosure
    //   --------------- -----  ----------------  ---------------------------
    //   correct          true   0   0            no typed row, no diff
    //   unanswered      false   -   correct.len  no typed row, no diff
    //   near-miss       false   1 edit, or 2 edits at <=20% of the answer
    //   wrong           false   otherwise        typed row + granular diff
    //   (over-cap) still 'wrong', but the caller renders without alignment.
    function computeVerdict(typed, correct) {
        var verdict = {
            status: 'unanswered',
            exact: false,
            distance: 0,
            messageKey: 'label-answer',
            showTypedAnswer: false,
            showDiff: false
        };
        if (!typed) {
            verdict.distance = correct.length;
            return verdict;
        }
        if (typed.toLowerCase() === correct.toLowerCase()) {
            verdict.status = 'correct';
            verdict.exact = true;
            verdict.distance = 0;
            verdict.messageKey = 'label-exact';
            return verdict;
        }
        var distance = levenshteinDistance(typed, correct);
        var longest = Math.max(typed.length, correct.length);
        verdict.distance = distance;
        // A single edit is always a near-miss: dropping a character ("kat" for
        // "katt", 25% of the answer), swapping a diacritic ("sprak" for
        // "språk"). Two edits are only a near-miss when they are a small
        // fraction of the answer; this prevents short-answer semantic errors
        // ("katter" for "katt") from being softened while preserving tolerance
        // for a two-character typo across a longer recall.
        verdict.status = (distance === 1 || (distance === 2 && distance / longest <= 0.2)) ? 'near-miss' : 'wrong';
        verdict.showTypedAnswer = true;
        verdict.showDiff = true;
        return verdict;
    }

    function computeDiff(t, c) {
        if (!t && !c) return { t: [], c: [], distance: 0 };
        if (!t) {
            // ES5: Array.prototype.fill is ES2015, so build the gap array by hand.
            var gt = [];
            for (var i = 0; i < c.length; i++) gt.push({ char: '', type: 'missing-gap' });
            return { t: gt, c: c.split('').map(function (ch) { return { char: ch, type: 'missed' }; }), distance: c.length };
        }
        if (!c) {
            var gc = [];
            for (var i = 0; i < t.length; i++) gc.push({ char: '', type: 'sub-error' });
            return { t: t.split('').map(function (ch) { return { char: ch, type: 'extra' }; }), c: gc, distance: t.length };
        }
        return levenshteinDiff(t, c, t.toLowerCase(), c.toLowerCase());
    }

    function levenshteinDiff(t, c, tLo, cLo) {
        var m = t.length, n = c.length;
        var dp = new Array(m + 1);
        for (var i = 0; i <= m; i++) dp[i] = new Array(n + 1);
        // BUG FIX (v6): this used to do `dp[i] = i` / `dp[j] = j`, which
        // overwrote the whole row (a fresh array from the loop above) with a
        // plain number. Every later `dp[i][j] = ...` write then silently
        // no-ops (JS discards property writes on primitive numbers), so the
        // DP table stayed empty and the wrong-answer diff was garbage.
        for (var i = 0; i <= m; i++) dp[i][0] = i;
        for (var j = 0; j <= n; j++) dp[0][j] = j;

        for (var i = 1; i <= m; i++) {
            for (var j = 1; j <= n; j++) {
                dp[i][j] = (tLo[i - 1] === cLo[j - 1]) ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
            }
        }

        // Backtrace runs FORWARD, from (0, 0) to (m, n), then reverses.
        //
        // A BACKWARD walk (the previous implementation) greedily matched the
        // TAIL first: typing "ett" against "ett kontakt två kontakt" aligned
        // the final "t" to the last "t" of the phrase and flagged only "e" +
        // trailing "t"s as correct. Both walks follow an optimal path (dp is
        // a PREFIX-cost table, and checking dp[ni][nj] == dp[i][j] + cost keeps
        // every step on one), but they pick DIFFERENT optimal paths when
        // several exist: backward prefers the last equal characters, forward
        // prefers the FIRST — which is the prefix alignment a typed answer
        // actually means.
        //
        // Order matters: match before substitute, or an equal pair on a
        // zero-cost diagonal gets marked as a substitution of a letter for
        // itself. Extra (blame the typed side) before missed (blame the
        // correct side) keeps identical strings perfectly aligned.
        var rt = [], rc = [];
        var i = 0, j = 0;
        while (i < m || j < n) {
            if (i < m && j < n && tLo[i] === cLo[j] && dp[i + 1][j + 1] === dp[i][j]) {
                rt.push({ char: t[i], type: 'correct' }); rc.push({ char: c[j], type: 'correct' }); i++; j++;
            } else {
                var extraOpt = i < m && dp[i + 1][j] === dp[i][j] + 1;
                var missedOpt = j < n && dp[i][j + 1] === dp[i][j] + 1;
                var subOpt = i < m && j < n && dp[i + 1][j + 1] === dp[i][j] + 1;
                var extraLeadsMatch = extraOpt && i + 1 < m && j < n && tLo[i + 1] === cLo[j];
                var missedLeadsMatch = missedOpt && i < m && j + 1 < n && tLo[i] === cLo[j + 1];
                var subLeadsMatch = subOpt && i + 1 < m && j + 1 < n && tLo[i + 1] === cLo[j + 1];
                // Prefer the optimal move that creates an immediate next match.
                // Extra (delete typed char) is best when the next typed char
                // matches the current correct char — e.g. "katt hund" vs
                // "katthund" where the space is extra and the following "h"
                // aligns. Otherwise a pure substitution should win over an
                // extra+missed pair, e.g. "katt" vs "kant".
                if (extraOpt && extraLeadsMatch) {
                    rt.push({ char: t[i], type: 'extra' }); rc.push({ char: '', type: 'sub-error' }); i++;
                } else if (subOpt && subLeadsMatch) {
                    rt.push({ char: t[i], type: 'sub-wrong' }); rc.push({ char: c[j], type: 'sub-correct' }); i++; j++;
                } else if (missedOpt && missedLeadsMatch) {
                    rt.push({ char: '', type: 'missing-gap' }); rc.push({ char: c[j], type: 'missed' }); j++;
                } else if (subOpt) {
                    rt.push({ char: t[i], type: 'sub-wrong' }); rc.push({ char: c[j], type: 'sub-correct' }); i++; j++;
                } else if (extraOpt) {
                    rt.push({ char: t[i], type: 'extra' }); rc.push({ char: '', type: 'sub-error' }); i++;
                } else if (missedOpt) {
                    rt.push({ char: '', type: 'missing-gap' }); rc.push({ char: c[j], type: 'missed' }); j++;
                } else if (j < n) {
                    rt.push({ char: '', type: 'missing-gap' }); rc.push({ char: c[j], type: 'missed' }); j++;
                } else if (i < m) {
                    rt.push({ char: t[i], type: 'extra' }); rc.push({ char: '', type: 'sub-error' }); i++;
                } else {
                    break;
                }
            }
        }
        return { t: rt, c: rc, distance: dp[m][n] };
    }

    // rowCls lets the typed row render with diff-row-typed while the correct
    // row keeps diff-row-correct (the plain fallback used for exact matches,
    // no-answer, and the over-cap case).
    function renderSimple(cont, text, tintCls, rowCls) {
        cont.innerHTML = ''; cont.className = 'diff-row ' + (rowCls || 'diff-row-correct') + ' ' + tintCls; cont.textContent = text;
    }

    function renderRows(contT, contC, diff, correctDisp) {
        contC.innerHTML = ''; contC.className = 'diff-row diff-row-correct';
        // Precompute the number of \n that precede each comp char in the
        // display string. Comp chars are correctDisp with \n removed, so each
        // comp index maps back to exactly one display char position.
        var breakMap = [], pending = 0;
        for (var di = 0; di < correctDisp.length; di++) {
            if (correctDisp.charAt(di) === '\n') { pending++; }
            else { breakMap.push(pending); pending = 0; }
        }
        var cv = 0;
        diff.c.forEach(function (p) {
            if (p.type === 'sub-error') return;
            var breaks = breakMap[cv] || 0;
            for (var bi = 0; bi < breaks; bi++) {
                contC.appendChild(document.createTextNode('\n'));
            }
            if (p.type === 'correct') { contC.appendChild(document.createTextNode(p.char)); cv++; return; }
            var span = document.createElement('span'); span.textContent = p.char; span.className = (p.type === 'missed') ? 'dc-missed' : 'dc-wrong'; contC.appendChild(span);
            cv++;
        });
        // Trailing \n after the last comp char.
        for (var ti = 0; ti < pending; ti++) {
            contC.appendChild(document.createTextNode('\n'));
        }
        contT.innerHTML = ''; contT.className = 'diff-row diff-row-typed';
        diff.t.forEach(function (p) {
            if (p.type === 'missing-gap') return;
            if (p.type === 'correct') { contT.appendChild(document.createTextNode(p.char)); return; }
            var span = document.createElement('span'); span.textContent = p.char; span.className = (p.type === 'extra') ? 'dt-extra' : 'dt-wrong'; contT.appendChild(span);
        });
    }

    renderDiff();

    // renderDiff() fills the diff rows synchronously against the static HTML
    // rows defined in Back.html, so the first call always returns true. The
    // MutationObserver fallback this replaced was for async rows that cannot
    // happen with the current static markup.
})();
