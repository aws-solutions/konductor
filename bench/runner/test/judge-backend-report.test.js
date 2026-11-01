// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox, FAKE_JUDGE } = require('./judge-backend-sandbox.js');

test('the report names the backend of a single directory and flags pooled directories judged on different backends', () => {
  const s = sandbox();
  try {
    const a = s.mkRun('a');
    const b = s.mkRun('b');
    assert.equal(s.oc(a, '--mode', 'rubric,pairwise').status, 0);
    assert.equal(s.cli(['judge', '--run', b, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE]).status, 0);

    assert.equal(s.cli(['report', '--run', a, '--bench-dir', s.bench]).status, 0);
    const single = JSON.parse(fs.readFileSync(path.join(a, 'report.json'), 'utf8'));
    assert.equal(single.judging.backend, 'opencode');
    assert.deepEqual(single.judging.backends, ['opencode']);
    assert.ok(single.judging.spentUsd > 0);
    const md = fs.readFileSync(path.join(a, 'report.md'), 'utf8');
    assert.match(md, /Judge backend: opencode \(opencode 1\.19\.5, us-east-1/);
    assert.match(md, /judge spend over all invocations: \$/i);
    assert.doesNotMatch(md, /different backends/);

    const out = path.join(s.root, 'pooled');
    assert.equal(s.cli(['report', '--run', `${a},${b}`, '--bench-dir', s.bench, '--out', out]).status, 0);
    const pooled = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
    assert.equal(pooled.judging.backend, 'mixed');
    assert.deepEqual(pooled.judging.backends.sort(), ['kiro', 'opencode']);
    assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /judged on different backends \(kiro, opencode\)/);
  } finally { s.cleanup(); }
});

test('a kiro-only report states the kiro backend and has no backend warning', () => {
  const s = sandbox();
  try {
    const a = s.mkRun('a');
    assert.equal(s.cli(['judge', '--run', a, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE]).status, 0);
    assert.equal(s.cli(['report', '--run', a, '--bench-dir', s.bench]).status, 0);
    const md = fs.readFileSync(path.join(a, 'report.md'), 'utf8');
    assert.match(md, /Judge backend: kiro/);
    assert.doesNotMatch(md, /different backends/);
  } finally { s.cleanup(); }
});

test('profile preflight: results judged on two backends fail the detailed profile; one backend adds no item', () => {
  const P = require('../lib/profiles.js');
  const facts = (backends) => ({
    study: { comparison: true, capability: false, judged: true }, replicates: { min: 5 }, aaArms: ['a', 'a-b'], sameRefRepeat: false,
    controls: { positive: 0, negative: 0 }, calibration: { kappa: 0.7 }, judging: { present: true, backends, pairwise: { run: true, records: 4, bothOrders: 4 } },
  });
  const judgments = { modes: ['graded', 'pairwise', 'rubric'], graded: [{ orderings: [{}, {}] }] };
  const one = P.profileCheck(P.loadProfile('detailed'), { facts: facts(['opencode']), judgments });
  const none = P.profileCheck(P.loadProfile('detailed'), { facts: facts(undefined), judgments });
  assert.equal(one.met, true);
  assert.deepEqual(one.items.map((i) => i.text), none.items.map((i) => i.text));
  const two = P.profileCheck(P.loadProfile('detailed'), { facts: facts(['kiro', 'opencode']), judgments });
  assert.equal(two.met, false);
  assert.match(two.items.filter((i) => !i.ok)[0].text, /judge backend: results were judged on different backends \(kiro, opencode\)/);
});
