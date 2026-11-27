// SPDX-License-Identifier: Apache-2.0
'use strict';

// A T12 git fixture's history must not hold the judge-only answer key: the runner leaves the file out of the
// workspace, but `git show HEAD:.bench-answer-key.md` would still read it from a committed copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIX = path.join(__dirname, '..', '..', 'scenarios', 't12', 'fixtures');

test('no T12 git fixture commits its answer key', () => {
  let checked = 0;
  for (const id of fs.readdirSync(FIX)) {
    const dotgit = path.join(FIX, id, 'dotgit');
    if (!fs.existsSync(dotgit)) continue;
    const files = execFileSync('git', ['--git-dir', dotgit, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
    assert.ok(!files.some((f) => path.basename(f) === '.bench-answer-key.md'), id);
    checked++;
  }
  assert.ok(checked >= 3);
});
