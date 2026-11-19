// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T2 near-miss twin (a summary, not a review). `twin-key.json` lists:
//   facts:     what the summary must state; each passes when any of its `anyOf` patterns matches the output;
//   forbidden: claims the summary must not make (a defect described as a feature, an invented change); each
//              passes when the output exists, is not empty and does not match `pattern`.
// Patterns are JavaScript regular expressions, matched case-insensitively. The file is the same in every twin
// hidden dir (bench/scenarios/t2/test/hidden-copies.test.js checks it).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'twin-key.json'), 'utf8'));
let text = '';
try { text = fs.readFileSync(path.resolve(spec.output), 'utf8'); } catch { /* no output: every test fails */ }

for (const f of spec.facts) {
  test(`states ${f.id}`, () => {
    assert.ok(f.anyOf.some((p) => new RegExp(p, 'i').test(text)), `none of ${f.anyOf.length} patterns matched`);
  });
}

for (const f of spec.forbidden ?? []) {
  test(`does not claim ${f.id}`, () => {
    assert.ok(text.trim().length > 0, `${spec.output} is missing or empty`);
    assert.ok(!new RegExp(f.pattern, 'i').test(text), f.why ?? 'forbidden claim present');
  });
}
