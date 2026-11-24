// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/physical/review/content-lock.js: a plant variant id (`<probe>.vNN`) names one content. A change under the same id
// is refused (D-183); a new id is recorded. Test data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareTasks, main } = require('../../physical/review/content-lock.js');

function tasksDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'fixtures', 'plant-empty'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixtures', 'plant-empty', 'NOTE.txt'), 'x\n');
  const put = (id, faults) => fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, fixture: 'plant-empty', prompt: 'p', environment: { faults } }));
  return { dir, put };
}

const quiet = { log: () => {}, error: () => {} };

test('a written lock passes; a same-id content change fails the check and the write', (t) => {
  const { dir, put } = tasksDir(t);
  put('plant-a4-pillar-contact.v03', [{ which: 'jam', atCall: 3 }]);
  const lock = path.join(dir, '..', `${path.basename(dir)}.lock.json`);
  t.after(() => fs.rmSync(lock, { force: true }));
  assert.equal(main(['--tasks', dir, '--lock', lock, '--write'], quiet), 0);
  assert.equal(main(['--tasks', dir, '--lock', lock], quiet), 0);
  put('plant-a4-pillar-contact.v03', [{ which: 'jam', atCall: 2 }]);
  const rows = compareTasks(dir, JSON.parse(fs.readFileSync(lock, 'utf8')).tasks);
  assert.deepEqual(rows.map((r) => [r.id, r.problem]), [['plant-a4-pillar-contact.v03', 'same-id change']]);
  const errors = [];
  assert.equal(main(['--tasks', dir, '--lock', lock, '--write'], { log: () => {}, error: (s) => errors.push(s) }), 1);
  assert.match(errors.join('\n'), /plant-a4-pillar-contact\.v03: content changed under the same id; write it as a new version/);
});

test('a new id is listed as new by the check and recorded by the write', (t) => {
  const { dir, put } = tasksDir(t);
  put('plant-a4-pillar-contact.v03', []);
  const lock = path.join(dir, '..', `${path.basename(dir)}.lock.json`);
  t.after(() => fs.rmSync(lock, { force: true }));
  main(['--tasks', dir, '--lock', lock, '--write'], quiet);
  put('plant-a4-pillar-contact.v04', [{ which: 'jam', atCall: 2 }]);
  assert.equal(main(['--tasks', dir, '--lock', lock], quiet), 1);
  assert.equal(main(['--tasks', dir, '--lock', lock, '--write'], quiet), 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(lock, 'utf8')).tasks).sort(), ['plant-a4-pillar-contact.v03', 'plant-a4-pillar-contact.v04']);
});

test('a fixture change counts as a content change', (t) => {
  const { dir, put } = tasksDir(t);
  put('plant-x.v01', []);
  const lock = path.join(dir, '..', `${path.basename(dir)}.lock.json`);
  t.after(() => fs.rmSync(lock, { force: true }));
  main(['--tasks', dir, '--lock', lock, '--write'], quiet);
  fs.writeFileSync(path.join(dir, 'fixtures', 'plant-empty', 'NOTE.txt'), 'y\n');
  assert.equal(main(['--tasks', dir, '--lock', lock], quiet), 1);
});

test('usage errors exit 2', () => {
  assert.equal(main([], quiet), 2);
  assert.equal(main(['--tasks', '/no/such/dir', '--lock', '/tmp/x.json'], quiet), 2);
});
