// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeScore: scoreOf } = require('../lib/score.js');
const { sharedHelpers } = require('../../runner/lib/hidden-lib.js');

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

test('Python tasks name the shared bridge and timeout helper in .bench-lib.json and commit no copy', () => {
  for (const id of ids) {
    const root = path.join(DIR, 'hidden', id);
    const named = sharedHelpers(root).map(([rel]) => rel);
    if (!named.includes('hidden/py_bridge.test.js')) continue;
    assert.ok(named.includes('hidden/py/timeouts.py'), `${id} timeouts`);
    for (const rel of named) assert.ok(!fs.existsSync(path.join(root, rel)), `${id} commits ${rel}`);
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

test('every brief renders its author prompt and both two-step prompts with no slot left', () => {
  const { loadConfig } = require('../lib/config.js');
  const { render } = require('../lib/prompt.js');
  const cfg = loadConfig(require('./scenario.config.js'));
  for (const f of fs.readdirSync(path.join(DIR, 'briefs'))) {
    for (const step of [null, 'data', 'key']) {
      const text = render(cfg, path.basename(f, '.json'), step);
      assert.doesNotMatch(text, /\{\{\w+\}\}|undefined/, `${f} ${step}`);
    }
  }
});

test('the log row marks a call counted at the abort limit as an estimate', () => {
  const { stage } = require('./scenario.config.js');
  assert.equal(stage.logRow('t1-x', 'fix', 'glm-5', { credits: 2.5 }), '| t1-x | fix | glm-5 | 2.50 |');
  assert.match(stage.logRow('t1-x', 'fix', 'glm-5', { credits: 15, estimated: true }), /^\| t1-x \| fix \| glm-5 \| 15\.00 \(estimate: .*\) \|$/);
});
