// SPDX-License-Identifier: Apache-2.0
'use strict';

// Size lint (FW-25): no non-test bench function over 150 lines, except the ones in size-lint-baseline.json. The
// baseline only shrinks: a new long function fails, and so does a listed one that is now short or gone (remove it).
// The scanner (bench/scripts/fn-sizes.js) is checked on small sources first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { functionSizes, benchFiles, over } = require('../../scripts/fn-sizes.js');

const LIMIT = 150;
const BASELINE = path.join(__dirname, 'size-lint-baseline.json');
const body = (n) => Array.from({ length: n }, (_, i) => `  x += ${i};`).join('\n');

test('fn-sizes: counts head to closing brace for each function form', () => {
  const src = [
    'function a({ x, y } = {}) {', body(3), '}',
    'const b = async (p, { q }) => {', body(2), '};',
    'class C {', '  m(z) {', body(1), '  }', '}',
    'const o = { k: (v) => {', body(1), '} };',
  ].join('\n');
  const got = Object.fromEntries(functionSizes(src).map((s) => [s.name, s.lines]));
  assert.deepEqual(got, { a: 5, b: 4, m: 3, k: 3 });
});

test('fn-sizes: braces in strings, templates, comments and regexes do not count', () => {
  const src = [
    'function f() {',
    "  const s = '}}' + \"{\" + `a ${'}'} b }`; // } comment",
    '  /* { */ const r = /[{}]+\\}/g;',
    '  return s.replace(r, "");',
    '}',
    'function g() { return 1; }',
  ].join('\n');
  assert.deepEqual(functionSizes(src).map((s) => [s.name, s.lines]), [['f', 5], ['g', 1]]);
});

test('fn-sizes: the file list leaves out tests and task content', () => {
  const files = benchFiles();
  assert.ok(files.includes('runner/lib/orchestrate.js'));
  assert.ok(!files.some((f) => /(^|\/)(test|fixtures|hidden|solutions|answers)\//.test(f) || f.endsWith('.test.js')));
});

test(`size lint: no bench function over ${LIMIT} lines beyond the baseline, and the baseline only shrinks`, () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).functions;
  const key = (r) => `${r.file} ${r.name}`;
  const now = over(benchFiles(), LIMIT);
  const allowed = new Set(baseline.map(key));
  const fresh = now.filter((r) => !allowed.has(key(r)));
  assert.deepEqual(fresh.map((r) => `${r.file}:${r.line} ${r.name} (${r.lines} lines)`), [], 'split these into named steps');
  const found = new Set(now.map(key));
  const stale = baseline.filter((b) => !found.has(key(b)));
  assert.deepEqual(stale.map(key), [], 'these are now under the limit: remove them from size-lint-baseline.json');
});
