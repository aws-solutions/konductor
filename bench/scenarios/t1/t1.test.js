// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scoreOf } = require('./dry-run.js');

const DIR = __dirname;
const ids = fs.readdirSync(DIR).filter((f) => /^t1-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));

test('scoreOf weighs hidden tests 0.5 and substance checks 0.2, and skips format and tests checks', () => {
  const r = scoreOf([
    { type: 'tests', tests: { passed: 5, total: 10 } },
    { type: 'cmd', passed: true, weight: 3, kind: 'substance' },
    { type: 'contains', passed: false, weight: 1, kind: 'substance' },
    { type: 'contains', passed: false, weight: 5, kind: 'format' },
  ]);
  assert.equal(r.hidden, 0.5);
  assert.equal(r.checks, 0.75);
  assert.ok(Math.abs(r.score - ((0.5 * 0.5 + 0.2 * 0.75) / 0.7) * 100) < 1e-9);
});

test('scoreOf renormalises when a part is missing', () => {
  assert.equal(scoreOf([{ type: 'cmd', passed: true, weight: 1 }]).score, 100);
});

test('every task has its fixture, hidden tests and reference, and its ids match', () => {
  for (const id of ids) {
    const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    assert.equal(task.id, id);
    assert.equal(task.hidden, id);
    // A twin or a negative control may run on another task's fixture.
    assert.equal(task.fixture, task.controlKind === 'none' ? id : task.fixture);
    assert.ok(fs.existsSync(path.join(DIR, 'fixtures', task.fixture)), `fixtures/${task.fixture}`);
    for (const d of ['hidden', 'solutions']) assert.ok(fs.existsSync(path.join(DIR, d, id)), `${d}/${id}`);
  }
});

test('Python tasks carry byte-identical copies of the bridge and the timeout helper', () => {
  const bridge = fs.readFileSync(path.join(DIR, 'lib', 'py-bridge.test.js'), 'utf8');
  const timeouts = fs.readFileSync(path.join(DIR, 'lib', 'py-timeouts.py'), 'utf8');
  for (const id of ids) {
    const bridgeCopy = path.join(DIR, 'hidden', id, 'hidden', 'py_bridge.test.js');
    if (!fs.existsSync(bridgeCopy)) continue;
    assert.equal(fs.readFileSync(bridgeCopy, 'utf8'), bridge, `${id} bridge`);
    assert.equal(fs.readFileSync(path.join(DIR, 'hidden', id, 'hidden', 'py', 'timeouts.py'), 'utf8'), timeouts, `${id} timeouts`);
  }
});

test('no task file or fixture names a host path or an internal tool', () => {
  const bad = /\/home\/|\/local\/|\/var\/tmp|@amazon|midway|brazil|kiro-cli|konductor/i;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const id of ids) {
    const extra = ['answers'].filter((d) => fs.existsSync(path.join(DIR, d, id)));
    const files = [path.join(DIR, `${id}.json`), ...['hidden', 'solutions', ...extra].flatMap((d) => walk(path.join(DIR, d, id))), ...(fs.existsSync(path.join(DIR, 'fixtures', id)) ? walk(path.join(DIR, 'fixtures', id)) : [])];
    for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), bad, f);
  }
});

test('every task passes the task schema and the v3 rules (needs the scoring schema with check weight and kind)', () => {
  const { validate, loadSchema } = require('../../runner/lib/schema.js');
  const { v3Errors } = require('../../runner/lib/task-v3.js');
  const schema = loadSchema('task');
  for (const id of ids) {
    const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    assert.deepEqual(validate(schema, task), [], id);
    assert.deepEqual(v3Errors(task), [], id);
  }
});

test('a task aimed at an SOP that waits for the user\'s yes says in its prompt that the scope is confirmed and committing is allowed', () => {
  const waits = ['k-e2e-test-generation', 'k-light-ui-testing', 'k-test-coverage-review'];
  for (const id of ids) {
    const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    if (!waits.includes(task.targetSop)) continue;
    assert.match(task.prompt, /scope is confirmed|confirm(ed)? the scope/i, `${id} must confirm the scope`);
    assert.match(task.prompt, /commit/i, `${id} must allow committing on the feature branch`);
  }
});
