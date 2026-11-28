// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scratch lint (DEBT D-303): bench test files make temp dirs with mkScratch (scratch.js), which removes them at
// process exit even when a test throws. A raw mkdtemp call leaks when its removal is skipped or forgotten, as
// prompt-fix-study.test.js did (97 pfs- dirs in /tmp). Raw calls fail, except the per-file counts in
// scratch-lint-baseline.json, which only shrink. Task fixtures are not checked: agents see them, and
// temp-leaks.test.js runs those under a fresh TMPDIR instead.
// shortcut: a dir made by a child process or a helper module is not seen; temp-leaks.test.js covers the known ones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');
const DIRS = ['agenteval/test', 'physical/test', 'runner/test', 'skilleval/test'];
const RAW = /\bmkdtemp(?:Sync)?\s*\(/g;

/** Number of raw mkdtemp / mkdtempSync calls in `src`. */
function rawCalls(src) {
  return (src.match(RAW) || []).length;
}

/** { 'runner/test/x.test.js': n } for every bench test file with n > 0 raw calls. */
function scan() {
  const out = {};
  for (const dir of DIRS) {
    for (const rel of fs.readdirSync(path.join(BENCH, dir), { recursive: true })) {
      if (!/\.test\.m?js$/.test(rel)) continue;
      const file = `${dir}/${rel}`;
      if (path.join(BENCH, file) === __filename) continue; // its own examples
      const n = rawCalls(fs.readFileSync(path.join(BENCH, file), 'utf8'));
      if (n) out[file] = n;
    }
  }
  return out;
}

test('rawCalls: mkdtemp and mkdtempSync calls count; mkScratch and the bare word do not', () => {
  const src = [
    "const a = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'));",
    "fs.mkdtemp(path.join(os.tmpdir(), 'b-'), cb);",
    "const c = mkScratch('c-');",
    '// mkdtempSync is what scratch.js wraps',
  ].join('\n');
  assert.equal(rawCalls(src), 2);
});

test('scratch lint: no raw mkdtemp in bench tests beyond the baseline, and the baseline only shrinks', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'scratch-lint-baseline.json'), 'utf8')).files;
  const now = scan();
  const over = Object.entries(now).filter(([f, n]) => n > (baseline[f] || 0)).map(([f, n]) => `${f}: ${n} raw mkdtemp call(s), baseline ${baseline[f] || 0}`);
  assert.deepEqual(over, [], "use mkScratch from bench/runner/test/scratch.js, which removes the dir at exit");
  const stale = Object.entries(baseline).filter(([f, n]) => (now[f] || 0) < n).map(([f, n]) => `${f}: baseline ${n}, now ${now[f] || 0}`);
  assert.deepEqual(stale, [], 'lower these counts in scratch-lint-baseline.json');
});
