// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every T2 hidden dir carries copies of the grader files (a hidden test cannot reach the bench tree). These tests
// keep the copies byte-identical to their sources, so a grader fix cannot leave old copies behind.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const T2 = path.join(__dirname, '..');
const RUNNER_GRADER = path.join(T2, '..', '..', 'runner', 'lib', 'findings-key.js');
const read = (f) => fs.readFileSync(f, 'utf8');
const hiddenDirs = () => fs.readdirSync(path.join(T2, 'hidden')).map((d) => path.join(T2, 'hidden', d, 'hidden'));

test('lib/findings-key.cjs matches the runner grader when the runner has one', { skip: !fs.existsSync(RUNNER_GRADER) }, () => {
  assert.equal(read(path.join(T2, 'lib', 'findings-key.cjs')), read(RUNNER_GRADER));
});

test('every hidden copy matches lib/', () => {
  for (const dir of hiddenDirs()) {
    for (const f of ['findings.test.cjs', 'findings-key.cjs', 'twin.test.cjs']) {
      const copy = path.join(dir, f);
      if (fs.existsSync(copy)) assert.equal(read(copy), read(path.join(T2, 'lib', f)), copy);
    }
  }
});

test('every task file has its hidden key and solution', () => {
  for (const f of fs.readdirSync(T2).filter((n) => n.endsWith('.json'))) {
    const task = JSON.parse(read(path.join(T2, f)));
    const key = task.controlKind === 'twin' ? 'twin-key.json' : 'key.json';
    assert.ok(fs.existsSync(path.join(T2, 'hidden', task.hidden, 'hidden', key)), `${task.id}: ${key}`);
    assert.ok(fs.existsSync(path.join(T2, 'solutions', task.id)), `${task.id}: solution`);
    assert.ok(fs.existsSync(path.join(T2, 'fixtures', task.fixture)), `${task.id}: fixture`);
  }
});
