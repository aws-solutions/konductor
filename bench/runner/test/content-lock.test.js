// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/content-lock.js (DEBT D-150): a change to a task's prompt, checks, rubric, key or fixture must come
// with a version bump, and a hand edit needs a recheck of the current version before it can be locked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const cl = require('../../scenarios/content-lock.js');
const { readiness, lockBlockers, CONTENT_FLAG, HAND_EDIT_FLAG, VERSION_FLAG } = require('../../scenarios/ready.js');

test('every pack task matches bench/scenarios/content-lock.json (bump the version and run content-lock.js --write after a change)', () => {
  const off = cl.compare().filter((r) => r.problem);
  assert.deepEqual(off.map((r) => `${r.id}: ${r.problem}`), []);
});

function pack() {
  const dir = tmp();
  const t = { id: 't1-a', version: 2, prompt: 'Fix it.', fixture: 'fa', hidden: 'ha', checks: [], handEdited: { family: 'claude', editor: 'x', log: 'HAND-EDITS.md', version: 2 }, review: { recheck: { family: 'glm', version: 2 } } };
  write(path.join(dir, 't1', 't1-a.json'), JSON.stringify(t));
  write(path.join(dir, 't1', 'fixtures', 'fa', 'a.txt'), 'alpha\n');
  write(path.join(dir, 't1', 'hidden', 'ha', 'key.json'), '{"items":[]}');
  const lockFile = path.join(dir, 'content-lock.json');
  const [row] = cl.compare(dir, {});
  fs.writeFileSync(lockFile, JSON.stringify({ tasks: { 't1-a': { version: 2, sha256: row.sha256 } } }));
  return { dir, lockFile, file: path.join(dir, 't1', 't1-a.json'), t };
}

test('a key, fixture or prompt change at the same version is caught; bookkeeping is not content; a bump clears it', () => {
  const p = pack();
  const state = () => cl.compare(p.dir)[0].problem;
  assert.equal(state(), null);
  write(p.file, JSON.stringify({ ...p.t, pilot: { decision: 'keep' }, review: { recheck: { version: 2, family: 'glm' } } }));
  assert.equal(state(), null, 'pilot and review are bookkeeping');
  for (const [rel, text] of [['hidden/ha/key.json', '{"items":[1]}'], ['fixtures/fa/a.txt', 'beta\n']]) {
    const f = path.join(p.dir, 't1', rel);
    const old = fs.readFileSync(f, 'utf8');
    write(f, text);
    assert.equal(state(), 'same-version change', rel);
    write(f, old);
  }
  write(p.file, JSON.stringify({ ...p.t, prompt: 'Fix it now.' }));
  const row = cl.compare(p.dir)[0];
  assert.equal(row.problem, 'same-version change');
  assert.deepEqual(lockBlockers(p.t, row), [CONTENT_FLAG]);
  assert.deepEqual(readiness(p.dir).find((r) => r.id === 't1-a').lockBlockers, [CONTENT_FLAG], 'scenarios ready lists it');
  write(p.file, JSON.stringify({ ...p.t, prompt: 'Fix it now.', version: 3, handEdited: { ...p.t.handEdited, version: 3 } }));
  assert.equal(state(), 'bumped');
  assert.deepEqual(readiness(p.dir).find((r) => r.id === 't1-a').lockBlockers, [HAND_EDIT_FLAG], 'the v2 recheck does not cover v3');
});

test('a recheck with no version covers only up to legacyRecheckVersion', () => {
  const t = { version: 4, handEdited: { family: 'claude' }, review: { recheck: { family: 'glm' } } };
  assert.deepEqual(lockBlockers(t, { problem: null, entry: { version: 4, legacyRecheckVersion: 4 } }), []);
  assert.deepEqual(lockBlockers(t, { problem: null, entry: { version: 4, legacyRecheckVersion: 3 } }), [HAND_EDIT_FLAG]);
  assert.deepEqual(lockBlockers(t, { problem: null, entry: { version: 4 } }), [HAND_EDIT_FLAG]);
  assert.deepEqual(lockBlockers({ ...t, review: { recheck: { version: 4 } } }, { problem: null, entry: { version: 4 } }), []);
});

test('a version bumped past its recheck with no handEdited record still blocks the lock (D-156)', () => {
  assert.deepEqual(lockBlockers({ version: 3, review: { recheck: { version: 2 } } }), [VERSION_FLAG]);
  assert.deepEqual(lockBlockers({ version: 3, review: { version: 2, verdicts: [] } }), [VERSION_FLAG]);
  assert.deepEqual(lockBlockers({ version: 3, review: { version: 2, recheck: { version: 3 } } }), []);
  assert.deepEqual(lockBlockers({ version: 1 }), [], 'a task no review has read yet has nothing to be ahead of');
});

test('scenarios lint on the pack names a task left out of content-lock.json, or changed at its version, with the command (D-166)', () => {
  const { contentLockProblems } = require('../../scenarios/cli.js');
  const p = pack();
  const opts = { packDir: p.dir, lockFile: p.lockFile };
  assert.deepEqual(contentLockProblems(p.dir, opts), [], 'a matching lock passes');
  write(p.file, JSON.stringify({ ...p.t, prompt: 'Fix it now.' }));
  assert.match(contentLockProblems(p.dir, opts)[0], /t1-a v2 changed without a version bump: bump its version .*content-lock\.js --write/);
  write(path.join(p.dir, 't1', 't1-b.json'), JSON.stringify({ ...p.t, id: 't1-b' }));
  assert.ok(contentLockProblems(p.dir, opts).some((l) => /t1-b is new: run node bench\/scenarios\/content-lock\.js --write/.test(l)));
  assert.deepEqual(contentLockProblems(path.join(p.dir, 't1'), opts), [], 'a task dir that is not the pack is not checked');
});
