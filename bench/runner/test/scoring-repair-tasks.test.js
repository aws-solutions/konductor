// SPDX-License-Identifier: Apache-2.0
'use strict';

// Check weight and kind in the task schema, and the four task checks repaired in the scoring repair (M4, N3).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../lib/schema.js');

const BENCH = path.join(__dirname, '..', '..');
const task = (rel) => JSON.parse(fs.readFileSync(path.join(BENCH, rel), 'utf8'));
const withCheck = (c) => ({
  id: 't1', class: 'simple', target: null, prompt: 'p', fixture: 'f', timeoutSec: 60, checks: [c],
  rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['lite'],
});

test('the task schema takes a check weight and kind, and refuses a bad one', () => {
  const schema = loadSchema('task');
  assert.deepEqual(validate(schema, withCheck({ type: 'file_exists', path: 'a', weight: 2, kind: 'format' })), []);
  assert.notDeepEqual(validate(schema, withCheck({ type: 'file_exists', path: 'a', kind: 'style' })), []);
  assert.notDeepEqual(validate(schema, withCheck({ type: 'file_exists', path: 'a', weight: -1 })), []);
});

test('sdlc-problem-framing: the "Option A" line check is a format check', () => {
  const c = task('sdlc/sdlc-problem-framing.json').checks.filter((x) => /option\|alternative/.test(x.cmd || ''));
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'format');
});

test('hard-export-formats: package.json is not held unchanged; no dependency may be added instead', () => {
  const checks = task('tasks/hard-export-formats.json').checks;
  assert.equal(checks.some((c) => c.type === 'fixture_unchanged' && c.path === 'package.json'), false);
  assert.equal(checks.some((c) => c.type === 'cmd' && /devDependencies/.test(c.cmd)), true);
});

test('sdlc-spike-dedupe: "throwaway" is judged by the rubric only', () => {
  const t = task('sdlc/sdlc-spike-dedupe.json');
  assert.equal(t.checks.some((c) => /throwaway/.test(c.pattern || '')), false);
  assert.equal(t.rubric.some((r) => r.id === 'throwaway'), true);
});

test('the two loose keyword checks are gone and the rubric judges them (review S2, D-41)', () => {
  const spike = task('sdlc/sdlc-spike-dedupe.json');
  assert.equal(spike.checks.some((c) => /recommend/.test(c.cmd || c.pattern || '')), false);
  assert.equal(spike.rubric.some((r) => r.id === 'recommendation'), true);
  const framing = task('sdlc/sdlc-problem-framing.json');
  assert.equal(framing.checks.some((c) => /kill\|abandon/.test(c.cmd || c.pattern || '')), false);
  assert.match(framing.rubric.find((r) => r.id === 'measure').criterion, /stop rule/);
});

test('the no-new-dependency check passes the fixture and fails a tree with a dependency', () => {
  const { runChecks } = require('../lib/checks.js');
  const { tmp, write } = require('./helpers.js');
  const check = task('tasks/hard-export-formats.json').checks.find((c) => /devDependencies/.test(c.cmd || ''));
  const root = tmp();
  try {
    write(path.join(root, 'package.json'), '{"name":"x","version":"1.0.0"}');
    assert.equal(runChecks(root, [check])[0].passed, true);
    write(path.join(root, 'package.json'), '{"name":"x","dependencies":{"left-pad":"1.0.0"}}');
    assert.equal(runChecks(root, [check])[0].passed, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
