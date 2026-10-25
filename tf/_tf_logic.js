/* ============================================================
   HNA TF LOGIC MODULE (True-False note type)
   Four statements, each answered DUNG (left half) or SAI
   (right half). Two buttons per row, radio behaviour.
   Front collects answers + KIEM TRA flip; back grades.
   Dependencies: _tf_storage.js (safeGet/safeSet/STORAGE_KEYS),
   _tf_engine.js (AnkiEngine config + tones). ES5 only.
   ============================================================ */

(function () {
    var TF_KEY = 'hna-tf-state';
    var TF_TTL_MS = 5 * 60 * 1000;
    var TF_TRUE_TOKENS = ['T', 'TRUE', '1', 'D', '\u0110', 'ĐÚNG', 'Y', 'YES', '+'];
    var TF_FALSE_TOKENS = ['F', 'FALSE', '0', 'S', 'SAI', 'N', 'NO', '-'];

    function $(id) { return document.getElementById(id); }

    function strip(s) {
        return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, '');
    }

    /* Map a raw truth token to true / false / null (empty = skip slot)
       or the string 'invalid' for an unknown token (fail-closed). */
    function normalizeTruth(v) {
        var t = strip(v).toUpperCase();
        if (t === '') return null;
        if (TF_TRUE_TOKENS.indexOf(t) !== -1) return true;
        if (TF_FALSE_TOKENS.indexOf(t) !== -1) return false;
        return 'invalid';
    }

    function hasUnrendered(s) {
        var open = '{' + '{';
        var close = '}' + '}';
        return s.indexOf(open) !== -1 && s.indexOf(close) !== -1;
    }

    /* Read the four statement slots from the raw fallback nodes.
       Returns { items, question, invalid }. An unknown truth token
       (or a quote-broken data-tf attribute) fails closed: invalid. */
    function readItems() {
        var nodes = document.querySelectorAll
            ? document.querySelectorAll('#tf-raw-data .tf-raw-item')
            : [];
        var items = [];
        var i, el, text, token, truth;
        for (i = 0; i < nodes.length; i++) {
            el = nodes[i];
            text = strip(el.textContent || '');
            if (text === '' || hasUnrendered(text)) continue;
            token = el.getAttribute ? el.getAttribute('data-tf') : null;
            if (token !== null && token.indexOf('"') !== -1) {
                return { items: [], question: readQuestion(), invalid: true };
            }
            truth = normalizeTruth(token || '');
            if (truth === 'invalid') {
                return { items: [], question: readQuestion(), invalid: true };
            }
            if (truth === null) continue; /* empty truth: slot bo qua */
            items.push({ origIndex: i, text: text, truth: truth });
        }
        return { items: items, question: readQuestion(), invalid: false };
    }

    function readQuestion() {
        var q = $('tf-question-raw');
        return strip(q ? (q.textContent || '') : '');
    }

    function computationSig(question, items) {
        var parts = [question];
        var i;
        for (i = 0; i < items.length; i++) {
            parts.push(items[i].text);
            parts.push(items[i].truth ? 'T' : 'F');
        }
        return parts.join('');
    }

    function shuffleOrder(n) {
        var order = [];
        var i, j, tmp;
        for (i = 0; i < n; i++) order.push(i);
        var doShuffle = true;
        try {
            if (window.AnkiEngine && window.AnkiEngine.config &&
                    window.AnkiEngine.config.shuffleChoices === false) {
                doShuffle = false;
            }
        } catch (e) { doShuffle = true; }
        if (!doShuffle) return order;
        for (i = order.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        }
        return order;
    }

    function isPermutation(order, n) {
        if (!order || order.length !== n) return false;
        var seen = {};
        var i;
        for (i = 0; i < order.length; i++) {
            if (typeof order[i] !== 'number' || order[i] < 0 ||
                    order[i] >= n || seen[order[i]]) return false;
            seen[order[i]] = true;
        }
        return true;
    }

    function clearState() {
        window.__hnaTFState = null;
        window.__hnaTFAnswered = false;
        try { sessionStorage.removeItem(TF_KEY); } catch (e) {}
    }

    function saveState(state) {
        window.__hnaTFState = state;
        try { safeSet(TF_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function loadState(question, items) {
        var raw = null;
        try { raw = sessionStorage.getItem(TF_KEY); } catch (e) { raw = null; }
        if (!raw) raw = (typeof safeGet === 'function') ? safeGet(TF_KEY) : null;
        if (!raw) return null;
        var st = null;
        try { st = JSON.parse(raw); } catch (e) { return null; }
        if (!st || st.v !== 1) return null;
        if (!st.expiresAt || st.expiresAt < Date.now()) return null;
        if (st.sig !== computationSig(question, items)) return null;
        if (!isPermutation(st.order, items.length)) return null;
        if (!st.answers || typeof st.answers !== 'object' ||
                Object.prototype.toString.call(st.answers) !== '[object Object]') return null;
        var _k;
        for (_k in st.answers) {
            if (st.answers.hasOwnProperty(_k) &&
                    typeof st.answers[_k] !== 'boolean') return null;
        }
        return st;
    }

    /* Grade every item. answers maps origIndex -> true/false.
       Missing key = unanswered (skipped). */
    function grade(items, answers) {
        var results = [];
        var wrongList = [];
        var correct = 0, wrong = 0, skipped = 0;
        var i, it, key, chosen, st;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            key = String(it.origIndex);
            chosen = (answers && answers.hasOwnProperty(key)) ? answers[key] : null;
            if (chosen === null || chosen === undefined) {
                st = 'skipped'; skipped++;
            } else if (chosen === it.truth) {
                st = 'correct'; correct++;
            } else {
                st = 'wrong'; wrong++;
            }
            results.push({
                origIndex: it.origIndex, text: it.text, truth: it.truth,
                chosen: (chosen === null || chosen === undefined) ? null : !!chosen,
                state: st
            });
        }
        for (i = 0; i < results.length; i++) {
            if (results[i].state !== 'correct') wrongList.push(results[i]);
        }
        wrongList.sort(function (a, b) { return a.origIndex - b.origIndex; });
        return {
            results: results, wrongList: wrongList,
            total: items.length, correct: correct, wrong: wrong,
            skipped: skipped, overall: (wrong === 0 && skipped === 0 && items.length > 0)
        };
    }

    function markReady() {
        try { document.documentElement.classList.add('tf-ready'); } catch (e) {}
    }

    function setText(el, s) {
        if ('textContent' in el) el.textContent = s;
        else el.innerText = s;
    }

    /* ---------------- FRONT ---------------- */

    var keydownHandler = null;
    var focusRow = 0;

    function answerCount(answers) {
        var n = 0, k;
        for (k in answers) {
            if (answers.hasOwnProperty(k) && answers[k] !== null &&
                    answers[k] !== undefined) n++;
        }
        return n;
    }

    function refreshProgress(container, answers, total) {
        var bar = $('tf-progress');
        if (bar) {
            setText(bar, 'Đã trả lời ' + answerCount(answers) + '/' + total);
        }
        /* Beta: KIEM TRA luôn bấm được kể cả chưa chọn đủ — chỉ giữ
           progress text, không gate disabled. */
        var btn = $('tf-submit');
        if (btn && btn.hasAttribute && btn.hasAttribute('disabled')) {
            btn.removeAttribute('disabled');
        }
    }

    function paintRow(row, val) {
        var halves = row.querySelectorAll
            ? row.querySelectorAll('.tf-half') : [];
        var i, h;
        for (i = 0; i < halves.length; i++) {
            h = halves[i];
            var isThis = (val !== null && val !== undefined) &&
                ((val === true && h.getAttribute('data-val') === 'true') ||
                 (val === false && h.getAttribute('data-val') === 'false'));
            if (isThis) {
                h.setAttribute('aria-checked', 'true');
                if (h.getAttribute('data-val') === 'true') {
                    h.classList.add('is-true');
                    h.classList.remove('is-false');
                } else {
                    h.classList.add('is-false');
                    h.classList.remove('is-true');
                }
            } else {
                h.setAttribute('aria-checked', 'false');
                h.classList.remove('is-true');
                h.classList.remove('is-false');
            }
        }
    }

    function buildFrontRow(item, rowPos, answers, onPick) {
        var row = document.createElement('div');
        row.className = 'tf-row glass-pseudo';
        row.setAttribute('data-orig', String(item.origIndex));
        row.setAttribute('data-pos', String(rowPos));
        row.setAttribute('tabindex', '0');

        var badge = document.createElement('span');
        badge.className = 'tf-badge';
        setText(badge, String(rowPos + 1));
        row.appendChild(badge);

        var text = document.createElement('span');
        text.className = 'tf-text';
        setText(text, item.text);
        row.appendChild(text);

        var halves = document.createElement('div');
        halves.className = 'tf-halves';
        halves.setAttribute('role', 'radiogroup');
        halves.setAttribute('aria-label', 'Câu ' + (rowPos + 1));

        var bt = document.createElement('button');
        bt.type = 'button';
        bt.className = 'tf-half tf-true';
        bt.setAttribute('role', 'radio');
        bt.setAttribute('aria-checked', 'false');
        bt.setAttribute('data-val', 'true');
        setText(bt, 'ĐÚNG');

        var bf = document.createElement('button');
        bf.type = 'button';
        bf.className = 'tf-half tf-false';
        bf.setAttribute('role', 'radio');
        bf.setAttribute('aria-checked', 'false');
        bf.setAttribute('data-val', 'false');
        setText(bf, 'SAI');

        bt.addEventListener('click', function () { onPick(item.origIndex, true, row); });
        bf.addEventListener('click', function () { onPick(item.origIndex, false, row); });

        halves.appendChild(bt);
        halves.appendChild(bf);
        row.appendChild(halves);

        var cur = answers.hasOwnProperty(String(item.origIndex))
            ? answers[String(item.origIndex)] : null;
        paintRow(row, cur);
        return row;
    }

    function initFront() {
        clearState();
        window.__hnaTFKeydown = null;
        if (keydownHandler && document.removeEventListener) {
            try { document.removeEventListener('keydown', keydownHandler, true); } catch (e) {}
            keydownHandler = null;
        }
        focusRow = 0;
        var parsed = readItems();
        var container = $('tf-rows-container');
        if (!container) return;
        while (container.firstChild) container.removeChild(container.firstChild);
        if (parsed.invalid || parsed.items.length === 0) {
            try {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('AnkiTF: invalid or empty truth tokens — static fallback kept');
                }
            } catch (e) {}
            return; /* fail-closed: no tf-ready, fallback list stays */
        }
        var items = parsed.items;
        var order = shuffleOrder(items.length);
        var byOrig = {};
        var i;
        for (i = 0; i < items.length; i++) byOrig[items[i].origIndex] = items[i];
        var answers = {};

        function onPick(origIndex, val, row) {
            answers[String(origIndex)] = val; /* re-click same side: no unselect */
            paintRow(row, val);
            refreshProgress(container, answers, items.length);
        }

        for (i = 0; i < order.length; i++) {
            container.appendChild(buildFrontRow(byOrig[order[i]], i, answers, onPick));
        }
        refreshProgress(container, answers, items.length);
        function submitNow(force) {
            if (window.__hnaTFAnswered) return false;
            if (!force && answerCount(answers) < items.length) return false;
            window.__hnaTFAnswered = true;
            var now = Date.now();
            saveState({
                v: 1, sig: computationSig(parsed.question, items),
                order: order.slice(), answers: copyAnswers(answers),
                submittedAt: now, expiresAt: now + TF_TTL_MS
            });
            try {
                if (typeof pycmd === 'function') pycmd('ans');
            } catch (e) {}
            return true;
        }
        wireSubmit(items, order, answers, parsed.question, submitNow);
        wireKeys(container, items, order, answers, submitNow);
        markReady();
    }

    function wireSubmit(items, order, answers, question, submitFn) {
        var btn = $('tf-submit');
        if (!btn) return;
        var fresh = btn.cloneNode(false);
        setText(fresh, 'KIỂM TRA');
        if (btn.parentNode) btn.parentNode.replaceChild(fresh, btn);
        fresh.addEventListener('click', function () {
            /* Beta: KIEM TRA luôn submit được kể cả chưa chọn đủ. */
            if (typeof submitFn === 'function') { submitFn(true); return; }
            if (window.__hnaTFAnswered) return;
            window.__hnaTFAnswered = true;
            var now = Date.now();
            saveState({
                v: 1, sig: computationSig(question, items),
                order: order.slice(), answers: copyAnswers(answers),
                submittedAt: now, expiresAt: now + TF_TTL_MS
            });
            try {
                if (typeof pycmd === 'function') pycmd('ans');
            } catch (e) {}
        });
    }

    function copyAnswers(answers) {
        var out = {}, k;
        for (k in answers) {
            if (answers.hasOwnProperty(k)) out[k] = answers[k];
        }
        return out;
    }

    function focusRowAt(container, idx) {
        var rows = container.querySelectorAll
            ? container.querySelectorAll('.tf-row') : [];
        if (!rows.length) return;
        if (idx < 0) idx = 0;
        if (idx >= rows.length) idx = rows.length - 1;
        focusRow = idx;
        try { rows[idx].focus(); } catch (e) {}
    }

    function wireKeys(container, items, order, answers, submitFn) {
        keydownHandler = function (e) {
            if (!e || e.isComposing) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            var tgt = e.target;
            if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' ||
                    tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
            var k = (e.key || '');
            var code = e.code || '';
            if (k === 'Enter' || code === 'Enter' || code === 'NumpadEnter') {
                if (typeof submitFn === 'function') submitFn(true);
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                return;
            }
            var rows = container.querySelectorAll
                ? container.querySelectorAll('.tf-row') : [];
            if (!rows.length) return;
            function currentOrig() {
                var r = rows[focusRow] || rows[0];
                return parseInt(r.getAttribute('data-orig'), 10);
            }
            function pickFocused(val) {
                var orig = currentOrig();
                var r = rows[focusRow] || rows[0];
                answers[String(orig)] = val;
                paintRow(r, val);
                refreshProgress(container, answers, items.length);
            }
            if (k >= '1' && k <= '4') {
                var n = parseInt(k, 10) - 1;
                if (n < rows.length) {
                    focusRowAt(container, n);
                    e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                }
                return;
            }
            var m = /^(?:Digit|Numpad)([1-4])$/.exec(code);
            if (m && k !== ' ') {
                var n2 = parseInt(m[1], 10) - 1;
                if (n2 < rows.length && (k === 'Unidentified' || k === '' || (k >= '1' && k <= '4'))) {
                    focusRowAt(container, n2);
                    e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                }
                return;
            }
            var lk = k.toLowerCase ? k.toLowerCase() : k;
            if (lk === 't' || code === 'KeyT') {
                pickFocused(true);
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                return;
            }
            if (lk === 'f' || code === 'KeyF') {
                pickFocused(false);
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                return;
            }
            if (k === 'ArrowDown' || k === 'ArrowRight') {
                focusRowAt(container, focusRow + 1);
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                return;
            }
            if (k === 'ArrowUp' || k === 'ArrowLeft') {
                focusRowAt(container, focusRow - 1);
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            }
        };
        window.__hnaTFKeydown = keydownHandler;
        document.addEventListener('keydown', keydownHandler, true);
    }

    function destroyFront() {
        if (keydownHandler && document.removeEventListener) {
            try { document.removeEventListener('keydown', keydownHandler, true); } catch (e) {}
        }
        keydownHandler = null;
        window.__hnaTFKeydown = null;
    }

    /* ---------------- BACK ---------------- */

    function verdictText(g, hasState, order) {
        var i, all;
        if (!hasState) {
            all = [];
            for (i = 0; i < g.total; i++) all.push(String(i + 1));
            return '✗ BỎ TRỐNG — TÍNH LÀ SAI ' + all.join(',');
        }
        if (g.overall) return '✓ CHÍNH XÁC';
        return '✗ CHƯA CHÍNH XÁC ' + missPositions(g, order).join(',');
    }

    function missPositions(g, order) {
        var map = {}, i, rp;
        var pos = [];
        if (order) {
            for (i = 0; i < order.length; i++) map[order[i]] = i;
        }
        for (i = 0; i < g.results.length; i++) {
            if (g.results[i].state !== 'correct') {
                if (order && map.hasOwnProperty(g.results[i].origIndex)) {
                    rp = map[g.results[i].origIndex] + 1;
                } else {
                    rp = i + 1;
                }
                pos.push(rp);
            }
        }
        pos.sort(function (a, b) { return a - b; });
        return pos;
    }

    function buildBackRow(item, rowPos, chosen) {
        var row = document.createElement('div');
        row.className = 'tf-row glass-pseudo is-static';
        row.setAttribute('data-orig', String(item.origIndex));
        row.setAttribute('data-pos', String(rowPos));
        if (chosen === null || chosen === undefined) row.classList.add('is-skipped');

        var badge = document.createElement('span');
        badge.className = 'tf-badge';
        setText(badge, String(rowPos + 1));
        row.appendChild(badge);

        var text = document.createElement('span');
        text.className = 'tf-text';
        setText(text, item.text);
        row.appendChild(text);

        var halves = document.createElement('div');
        halves.className = 'tf-halves';

        var bt = document.createElement('span');
        bt.className = 'tf-half tf-true';
        var bf = document.createElement('span');
        bf.className = 'tf-half tf-false';

        if (item.truth === true) {
            bt.classList.add('is-correct');
            setText(bt, '✓ ĐÚNG');
        } else {
            bt.classList.add('is-dimmed');
            setText(bt, 'ĐÚNG');
        }
        if (item.truth === false) {
            bf.classList.add('is-correct');
            setText(bf, '✓ SAI');
        } else {
            bf.classList.add('is-dimmed');
            setText(bf, 'SAI');
        }
        if (chosen !== null && chosen !== undefined && chosen !== item.truth) {
            var wrongHalf = (chosen === true) ? bt : bf;
            setText(wrongHalf, (chosen === true ? '✗ ĐÚNG' : '✗ SAI'));
            wrongHalf.classList.remove('is-dimmed');
            wrongHalf.classList.add('is-wrong');
        }
        halves.appendChild(bt);
        halves.appendChild(bf);
        row.appendChild(halves);
        return row;
    }

    function initBack() {
        destroyFront();
        var parsed = readItems();
        var container = $('tf-rows-container');
        var verdictBox = $('tf-verdict-container');
        if (!container) return;
        while (container.firstChild) container.removeChild(container.firstChild);
        if (verdictBox) while (verdictBox.firstChild) verdictBox.removeChild(verdictBox.firstChild);
        if (parsed.invalid || parsed.items.length === 0) {
            try {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('AnkiTF: invalid or empty truth tokens — static fallback kept');
                }
            } catch (e) {}
            return; /* fail-closed */
        }
        var items = parsed.items;
        var st = loadState(parsed.question, items);
        var hasState = !!st;
        var order = hasState ? st.order : shuffleIdentity(items.length);
        var answers = hasState ? (st.answers || {}) : {};
        var g = grade(items, answers);
        var byOrig = {};
        var i;
        for (i = 0; i < items.length; i++) byOrig[items[i].origIndex] = items[i];
        for (i = 0; i < order.length; i++) {
            var it = byOrig[order[i]];
            var key = String(it.origIndex);
            var chosen = answers.hasOwnProperty(key) ? answers[key] : null;
            container.appendChild(buildBackRow(it, i, chosen));
        }
        if (verdictBox) {
            var banner = document.createElement('div');
            banner.className = 'verdict-banner ' +
                ((!hasState || !g.overall) ? 'wrong' : 'correct');
            setText(banner, verdictText(g, hasState, order));
            verdictBox.appendChild(banner);
        }
        try {
            if (window.AnkiAudio && typeof window.AnkiAudio.playTone === 'function') {
                window.AnkiAudio.playTone((hasState && g.overall) ? 'correct' : 'wrong');
            }
        } catch (e) {}
        markReady();
    }

    function shuffleIdentity(n) {
        var out = [], i;
        for (i = 0; i < n; i++) out.push(i);
        return out;
    }

    window.AnkiTF = {
        normalizeTruth: normalizeTruth,
        readItems: readItems,
        computationSig: computationSig,
        shuffleOrder: shuffleOrder,
        isPermutation: isPermutation,
        saveState: saveState,
        loadState: loadState,
        clearState: clearState,
        grade: grade,
        verdictText: verdictText,
        missPositions: missPositions,
        markReady: markReady,
        initFront: initFront,
        initBack: initBack,
        destroyFront: destroyFront
    };
})();
