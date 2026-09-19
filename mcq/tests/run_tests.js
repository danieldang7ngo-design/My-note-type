'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING MCQ UNIT & INTEGRATION TESTS ===\n');

// 1. Check essential files existence
const requiredFiles = [
    'Front.html',
    'Back.html',
    '_mcq_styles.css',
    '_mcq_storage.js',
    '_mcq_engine.js',
    '_mcq_logic.js',
    '_mcq_aurora.js',
    '_Inter.ttf',
    '_JetBrainsMono.ttf',
    'preview/preview_mcq.html',
    'docs/README.md'
];

requiredFiles.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    assert.strictEqual(fs.existsSync(fullPath), true, `File missing: ${file}`);
    console.log(`✓ [PASS] File exists: ${file} (${fs.statSync(fullPath).size} bytes)`);
});

// 2. Test Fisher-Yates shuffle algorithm fairness and logic
const mockChoices = [
    { text: 'Correct Option', isCorrect: true },
    { text: 'Distractor A', isCorrect: false },
    { text: 'Distractor B', isCorrect: false },
    { text: 'Distractor C', isCorrect: false }
];

// Load logic script in isolated sandbox
const logicCode = fs.readFileSync(path.join(__dirname, '..', '_mcq_logic.js'), 'utf8');
const vm = require('vm');
const context = {
    window: {},
    document: {},
    console: console,
    Math: Math,
    Date: Date,
    safeSet: () => true,
    safeGet: () => null
};
vm.createContext(context);
vm.runInContext(logicCode, context);

const AnkiMCQ = context.window.AnkiMCQ;
assert.ok(AnkiMCQ, 'AnkiMCQ object exported to window');
assert.strictEqual(typeof AnkiMCQ.shuffleChoices, 'function', 'shuffleChoices function exists');

// Perform 1000 shuffles to ensure uniform distribution and preservation of elements
const positionCounts = [0, 0, 0, 0];
const iterations = 10000;
for (let i = 0; i < iterations; i++) {
    const shuffled = AnkiMCQ.shuffleChoices(mockChoices);
    assert.strictEqual(shuffled.length, 4, 'Shuffled array maintains length');
    
    // Find correct item index
    const correctIdx = shuffled.findIndex(item => item.isCorrect);
    assert.ok(correctIdx >= 0 && correctIdx < 4, 'Correct item must always be in array');
    positionCounts[correctIdx]++;
}

console.log('\nShuffle Distribution over 10,000 runs:');
positionCounts.forEach((count, idx) => {
    const pct = ((count / iterations) * 100).toFixed(2);
    console.log(`  Position ${['A', 'B', 'C', 'D'][idx]}: ${count} (${pct}%)`);
    // Each position should roughly get 25% (± 3%)
    assert.ok(pct >= 22 && pct <= 28, `Position ${idx} distribution out of expected range: ${pct}%`);
});
console.log('✓ [PASS] Fisher-Yates is fair and uniformly distributed');

// 3. Test CSS variables compatibility with HNA Theme Pack
const cssContent = fs.readFileSync(path.join(__dirname, '..', '_mcq_styles.css'), 'utf8');
const themeRequiredVars = [
    '--diff-correct-border',
    '--diff-correct-text',
    '--diff-wrong-border',
    '--diff-wrong-text',
    '--aurora-1',
    '--aurora-accent',
    '--surface-glass',
    '--font-mono'
];

themeRequiredVars.forEach(v => {
    assert.ok(cssContent.includes(v), `Required theme token ${v} must be present in _mcq_styles.css`);
    console.log(`✓ [PASS] CSS Token mapped: ${v}`);
});

console.log('\n🎉 ALL MCQ NOTE TYPE TESTS PASSED PERFECTLY!\n');
