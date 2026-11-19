// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden-test bridge for Python tasks. The bench scores hidden suites by reading `node --test` totals, so this file runs
// the Python tests (hidden/py/test_*.py, unittest) once and registers one node test per Python test.
// Copied into each Python task's hidden directory; bench/scenarios/t1/t1-lib.test.js fails if a copy drifts.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const run = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'hidden/py', '-p', 'test_*.py', '-v'], {
  encoding: 'utf8',
  timeout: 120000,
  killSignal: 'SIGKILL',
  env: { ...process.env, PYTHONPATH: process.cwd(), PYTHONDONTWRITEBYTECODE: '1' },
});
const text = `${run.stderr || ''}\n${run.stdout || ''}`;
const results = [];
// A verbose line is `test_name (module.Class.test_name) ... ok`; a docstring puts the result on the next line.
for (const m of text.matchAll(/^(\S+) \(([^)]+)\)(?:\n[^\n]*)? \.\.\. (ok|FAIL|ERROR|skipped[^\n]*|expected failure|unexpected success)$/gm)) {
  results.push({ name: m[2], ok: m[3] === 'ok' || m[3] === 'expected failure' });
}

if (results.length === 0) {
  test('python suite ran', () => assert.fail(`no Python test results (exit ${run.status}, signal ${run.signal}): ${text.slice(-400)}`));
}
for (const r of results) test(r.name, () => assert.ok(r.ok, 'failed in Python'));
