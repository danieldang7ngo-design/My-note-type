'use strict';
/* Conservative CSS minifier for the publish artifact.
   Semantics-preserving ONLY: strips C-style block comments and collapses
   runs of whitespace to a single space, never touching quoted strings.
   Values, selector case, semicolons, and calc() spacing are left verbatim,
   so the design contract tests (which assert exact token strings) remain
   valid against the shipped file. The readable ROOT css stays the source
   of truth.

   Usage:
     node tests/minify-css.js <in.css> [out.css]
 */

function minifyCss(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];

    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        throw new Error('minifyCss: unterminated block comment starting at offset ' + i +
          ' — missing closing "*/". Truncating the rest of the CSS silently would ship a broken artifact.');
      }
      i = end + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const start = i;
      i++;
      while (i < css.length && css[i] !== c) {
        if (css[i] === '\\') i++;
        i++;
      }
      i++;
      out += css.slice(start, i);
      continue;
    }

    if (c === '\n' || c === '\r' || c === '\t' || c === ' ' || c === '\f' || c === '\v') {
      out += ' ';
      while (i < css.length &&
        (css[i] === '\n' || css[i] === '\r' || css[i] === '\t' ||
         css[i] === ' ' || css[i] === '\f' || css[i] === '\v')) {
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }
  return out.trim();
}

if (require.main === module) {
  const fs = require('fs');
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile) {
    console.error('usage: node tests/minify-css.js <in.css> [out.css]');
    process.exit(1);
  }
  const src = fs.readFileSync(inFile, 'utf8');
  const min = minifyCss(src);
  if (outFile) fs.writeFileSync(outFile, min);
  else process.stdout.write(min);
  console.error('minified: ' + Buffer.byteLength(min) + ' bytes (' +
    (Buffer.byteLength(min) / 1024).toFixed(1) + ' KB) from ' + Buffer.byteLength(src) + ' bytes (' +
    (100 * Buffer.byteLength(min) / Buffer.byteLength(src)).toFixed(0) + '%)');
}

module.exports = { minifyCss };
