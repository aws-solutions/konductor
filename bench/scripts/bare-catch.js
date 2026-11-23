#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Bare catch blocks in the bench's own JavaScript (FW-26): a `catch { }` or `catch (e) { }` whose body holds nothing,
// not even a comment. A swallowed error must say why it is safe to drop (a one-line comment) or record it.
//   node bench/scripts/bare-catch.js [FILE|DIR ...]   (default: every non-test bench .js; prints file:line per site)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { benchFiles, blank } = require('./fn-sizes.js');

const BENCH = path.join(__dirname, '..');

/** 1-based line numbers of the bare catch blocks in `text`. */
function bareCatches(text) {
  const code = blank(text);
  const out = [];
  const re = /\bcatch\s*(?:\([^()]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const close = code.indexOf('}', open);
    if (close < 0) continue;
    // The code between the braces is blank (comments are blanked too): bare only when the source holds no comment either.
    if (code.slice(open + 1, close).trim() === '' && text.slice(open + 1, close).trim() === '') out.push(text.slice(0, m.index).split('\n').length);
  }
  return out;
}

/** [{ file, line }] over `files` (bench-relative). */
function scan(files) {
  return files.flatMap((f) => bareCatches(fs.readFileSync(path.join(BENCH, f), 'utf8')).map((line) => ({ file: f, line })));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.length ? args.flatMap((a) => (fs.statSync(a).isDirectory() ? benchFiles(path.resolve(a)) : [path.relative(BENCH, path.resolve(a))])) : benchFiles();
  for (const r of scan(files)) console.log(`${r.file}:${r.line}`);
}

module.exports = { bareCatches, scan };
