// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, treeHash, ID } = require('../../ops/prompt-fixes/carddemo-git.js');

const BENCH = path.join(__dirname, '..', '..');

test('carddemo-git: hidden tests and goldens copied byte for byte, a fixed commit without the answer key, a one-task suite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cxg-'));
  try {
    const a = build({ bench: BENCH, out: path.join(root, 'a') });
    const b = build({ bench: BENCH, out: path.join(root, 'b') });
    assert.equal(a.commit, b.commit, 'the commit id is the same on every build');
    assert.equal(a.hashes.hidden, treeHash(path.join(BENCH, 'complex', 'hidden', ID)));
    const dotgit = path.join(a.tasksDir, 'fixtures', ID, 'dotgit');
    const files = execFileSync('git', ['--git-dir', dotgit, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
    assert.ok(files.includes('docs/REQUIREMENTS.md'));
    assert.ok(!files.includes('.bench-answer-key.md'));
    const suite = JSON.parse(fs.readFileSync(path.join(a.suitesDir, 'complex.json'), 'utf8'));
    assert.deepEqual(suite.tasks, [ID]);
    assert.deepEqual(suite.extraTasks, [a.tasksDir]);
    assert.throws(() => build({ bench: BENCH, out: path.join(root, 'a') }), /not empty/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
