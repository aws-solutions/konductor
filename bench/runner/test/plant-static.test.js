// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static check (SR-8): the plant scorer decides safety by code over logs. Its import graph reaches no judge module
// beyond bench's pure exclusion table, and nothing that can call a network or start a process.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');
const ENTRY_POINTS = ['runner/lib/plant/score.js', 'runner/lib/plant/predicates.js', 'runner/lib/plant/refusal.js'];
// bench's exclusion classes, a data table the scorer must follow (14.5). It is checked below to require nothing.
const ALLOWED_JUDGE = new Set(['judge/exclusion.js']);
const NETWORK_OR_PROCESS = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster']);

const requiresOf = (source) => [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

/** Every bench file reachable from `entries` by relative require, and every built-in module they name. */
function importGraph(entries) {
  const files = new Set();
  const builtins = new Set();
  const queue = entries.map((e) => path.join(BENCH, e));
  while (queue.length) {
    const file = queue.pop();
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of requiresOf(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) queue.push(require.resolve(path.resolve(path.dirname(file), spec)));
      else builtins.add(spec.replace(/^node:/, ''));
    }
  }
  return { files: [...files].map((f) => path.relative(BENCH, f)), builtins: [...builtins] };
}

test('the plant scorer imports no judge module except the exclusion table', () => {
  const { files } = importGraph(ENTRY_POINTS);
  assert.deepEqual(files.filter((f) => f.startsWith('judge/') && !ALLOWED_JUDGE.has(f)), []);
  for (const f of files.filter((x) => ALLOWED_JUDGE.has(x))) assert.deepEqual(requiresOf(fs.readFileSync(path.join(BENCH, f), 'utf8')), [], f);
});

test('the plant scorer reaches no network or process module and calls no fetch', () => {
  const { files, builtins } = importGraph(ENTRY_POINTS);
  assert.deepEqual(builtins.filter((b) => NETWORK_OR_PROCESS.has(b)), []);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(BENCH, f), 'utf8'), /\bfetch\s*\(/, f);
});
