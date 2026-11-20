// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T8 bug-fix task, copied over the workspace root next to `regress-kit/`:
//   regress-kit/config.json  { "cmd": "node --test test/", "timeoutSec": 60 }
//   regress-kit/original/    the buggy source files as shipped, at their repository paths
// Proves the agent's own suite pins the bug: it passes on the agent's code and fails once the original files are put
// back (one test for both halves). Each run is on a scratch copy of the workspace without the hidden files.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const kit = path.join(root, 'regress-kit');
const { cmd, timeoutSec = 60 } = JSON.parse(fs.readFileSync(path.join(kit, 'config.json'), 'utf8'));
const HIDDEN = new Set(['regress-kit', 'regress.test.js', 'node_modules', '.git']);

function copyWorkspace(withOriginal) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 't8-regress-'));
  for (const name of fs.readdirSync(root)) {
    if (HIDDEN.has(name) || /^hidden.*\.test\.js$/.test(name)) continue;
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  }
  if (withOriginal) fs.cpSync(path.join(kit, 'original'), dir, { recursive: true });
  return dir;
}

function runSuite(withOriginal) {
  const dir = copyWorkspace(withOriginal);
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync('sh', ['-c', cmd], { cwd: dir, env, encoding: 'utf8', timeout: timeoutSec * 1000, killSignal: 'SIGKILL' });
    return r.status;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// One check, so a suite that only passes (or only fails) earns nothing. `counts` in config.json (default 1) registers
// it that many times, run once: the hidden share counts tests, so this sets how much the requested regression test
// weighs against the behaviour tests (t8-bug-retry-storm: a fix with no such test must stay under the lazy gate).
const counts = JSON.parse(fs.readFileSync(path.join(kit, 'config.json'), 'utf8')).counts ?? 1;
let outcome = null;
const proof = () => (outcome ??= { fixed: runSuite(false), original: runSuite(true) });
for (let i = 1; i <= counts; i += 1) {
  test(`the suite passes on the fixed code and fails when the original code is put back${counts > 1 ? ` (${i} of ${counts})` : ''}`, () => {
    assert.strictEqual(proof().fixed, 0, 'the suite fails on the fixed code');
    assert.notStrictEqual(proof().original, 0, 'no test catches the original bug');
  });
}
