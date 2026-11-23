// SPDX-License-Identifier: Apache-2.0
'use strict';

// Class check for D-182 (review 2026-11-23 F8): committed bench code and tests must not name one person's host paths,
// such as an agent workspace under /local/home/<user>/.kiro/crew or a home dir spelled out. Such a default works on one
// box and silently means something else on the next. DEBT.md and the docs may quote them as evidence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
// A literal user name in a fixture (session-copy's redaction test uses `someone`) is test data, not a host default.
const HOST_PATH = /\.kiro\/crew\/workspace-|\/local\/home\/(?:"?\$\{?USER\}?"?|\$\{process\.env\.USER\})\//;
const CODE = /\.(?:js|sh|py|json)$|^[^.]+$/;

test('no committed bench script, module or test names a host workspace path', () => {
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'bench'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && CODE.test(path.basename(f)) && !f.startsWith('bench/docs/') && f !== 'bench/DEBT.md' && f !== 'bench/runner/test/host-paths.test.js');
  const found = files.filter((f) => {
    try { return HOST_PATH.test(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return false; }
  });
  assert.deepEqual(found, [], 'take the path from an env variable (PLANT_*, BENCH_*) and STOP with what to set');
});
