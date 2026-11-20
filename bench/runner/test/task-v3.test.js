// SPDX-License-Identifier: Apache-2.0
'use strict';

// Schema v3 task fields: the schema accepts them, the loader checks the rules the schema cannot express, and an old
// `target` is mapped into targetSkills, targetSop or targetAgent (N1).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../lib/schema.js');
const { loadTasks, BENCH_DIR } = require('../lib/tasks.js');
const { targetsOf, v3Errors, catalogOfRepo } = require('../lib/task-v3.js');
const { tmp, write, makeBench } = require('./helpers.js');

const OLD = {
  id: 't1', class: 'review', target: null, prompt: 'p', fixture: 'f', timeoutSec: 60,
  checks: [{ type: 'file_exists', path: 'a' }], rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['lite'],
};
const { target: _drop, ...BASE } = OLD;
const V3 = {
  ...BASE, version: 1, phase: 'code-review', phases2: ['security'], role: 'reviewer', questions: 'scripted',
  scriptedUser: { facts: [{ id: 'f1', topics: ['scale'], answer: 'About 100 users.' }], defaultReply: 'Use your judgement.' },
  findingsKey: [{ id: 'k1', finding: 'SQL built by string concatenation', weight: 2 }],
  targetSkills: ['backend-review'], targetSop: null, targetAgent: 'k-architect',
  controlKind: 'twin', twinOf: 'review-orig', loadCheck: { mustLoad: ['backend-review'], mustNotLoad: ['frontend-review'] },
  effectSubset: true, limits: { softSec: 900, hardSec: 1800, maxTurns: 80 },
  authorship: { family: 'family-a', model: 'model-a', source: 'original', date: '2026-11-19' },
  review: { family: 'family-b', date: '2026-11-19', verdicts: [{ check: 'leak', verdict: 'pass' }] },
  pilot: { scores: { vanilla: 40, konductor: 70 }, reference: 100, stub: 10, decision: 'keep', date: '2026-11-19' },
  lockedAt: '2026-11-19',
};

test('the schema accepts a full v3 task and still accepts an old one', () => {
  const schema = loadSchema('task');
  assert.deepEqual(validate(schema, V3), []);
  assert.deepEqual(validate(schema, OLD), []);
  assert.deepEqual(v3Errors(V3), []);
  assert.deepEqual(v3Errors(OLD), []);
});

test('the schema rejects bad v3 values', () => {
  const schema = loadSchema('task');
  for (const bad of [{ questions: 'maybe' }, { controlKind: 'other' }, { phase: 'lunch' }, { role: 'cto' }, { limits: { softSec: 1 } }, { pilot: { scores: {}, decision: 'later', date: '2026-11-19' } }, { review: { family: 'x', date: '2026-11-19', verdicts: [{ check: 'vibes', verdict: 'pass' }] } }]) {
    assert.ok(validate(schema, { ...V3, ...bad }).length, JSON.stringify(bad));
  }
});

test('expertKey holds judge-only items with a source and 3 to 5 weak answers', () => {
  const schema = loadSchema('task');
  const key = { items: [{ id: 'e1', text: 'Says what happens when the counter store is down', source: 'https://example.org/a (MIT)' }], weakAnswers: ['Looks good', 'Add caching', 'Consider scale'] };
  assert.deepEqual(validate(schema, { ...V3, expertKey: key }), []);
  assert.deepEqual(v3Errors({ ...V3, expertKey: key }), []);
  for (const bad of [{ items: [], weakAnswers: key.weakAnswers }, { items: key.items, weakAnswers: ['one', 'two'] }, { items: [{ id: 'e1', text: 'x' }], weakAnswers: key.weakAnswers }, { ...key, extra: 1 }]) {
    assert.ok(validate(schema, { ...V3, expertKey: bad }).length, JSON.stringify(bad));
  }
  assert.ok(v3Errors({ ...V3, expertKey: { ...key, weakAnswers: ['a', 'b', 'c', 'd', 'e', 'f'] } }).length);
});

test('authorship.source is "original" or a licensed source object', () => {
  const schema = loadSchema('task');
  const withSource = (source) => validate(schema, { ...V3, authorship: { ...V3.authorship, source } });
  assert.deepEqual(withSource({ url: 'https://example.org/issues/1', licence: 'MIT', licenceCheckedAt: '2026-11-19', use: 'idea' }), []);
  for (const use of ['structure', 'quoted']) assert.deepEqual(withSource({ url: 'https://example.org/a', licence: 'Apache-2.0', licenceCheckedAt: '2026-11-19', use }), []);
  for (const bad of ['borrowed', '', { url: 'https://example.org/a', licence: 'MIT', licenceCheckedAt: '2026-11-19', use: 'copied' }, { url: 'https://example.org/a', licence: 'MIT', use: 'idea' }, { url: 'ftp://x', licence: 'MIT', licenceCheckedAt: '2026-11-19', use: 'idea' }, { url: 'https://example.org/a', licence: 'MIT', licenceCheckedAt: '2026-11-19', use: 'idea', extra: 1 }, 7]) {
    assert.ok(withSource(bad).length, JSON.stringify(bad));
  }
  const { source: _s, ...noSource } = V3.authorship;
  assert.ok(validate(schema, { ...V3, authorship: noSource }).length);
});

test('the loader rules catch what the schema cannot', () => {
  const cases = [
    [BASE, /needs "target"/],
    [{ ...V3, target: 'x' }, /cannot both be set/],
    [{ ...V3, twinOf: undefined }, /needs twinOf/],
    [{ ...V3, controlKind: 'none' }, /only for controlKind "twin"/],
    [{ ...V3, twinOf: 't1' }, /cannot name the task itself/],
    [{ ...V3, scriptedUser: undefined }, /needs scriptedUser/],
    [{ ...V3, questions: 'allowed' }, /only for questions "scripted"/],
    [{ ...V3, limits: { softSec: 10, hardSec: 5 } }, /softSec must not exceed/],
    [{ ...V3, phases2: ['code-review'] }, /must not repeat the main phase/],
    [{ ...V3, loadCheck: { mustLoad: ['a'], mustNotLoad: ['a'] } }, /both mustLoad and mustNotLoad/],
    [{ ...V3, review: { ...V3.review, family: 'family-a' } }, /must differ from authorship/],
    [{ ...V3, authorship: undefined, review: undefined }, /with phase\) needs authorship/],
  ];
  for (const [task, re] of cases) {
    const t = JSON.parse(JSON.stringify(task));
    assert.ok(v3Errors(t).some((e) => re.test(e)), `${re}: ${v3Errors(t)}`);
  }
});

test('an old target maps by kind from the repo listing, with kind prefixes and unknown names', () => {
  const cat = { skills: ['backend-review'], sops: ['k-plan'], agents: ['k-architect', 'konductor'] };
  const of = (target) => targetsOf({ ...OLD, target }, cat);
  assert.deepEqual(of('backend-review').targetSkills, ['backend-review']);
  assert.equal(of('k-plan').targetSop, 'k-plan');
  assert.equal(of('k-architect').targetAgent, 'k-architect');
  assert.deepEqual(of('skill:release-codename').targetSkills, ['release-codename']);
  assert.deepEqual(of('nope'), { targetSkills: [], targetSop: null, targetAgent: null, targetUnresolved: 'nope' });
  assert.deepEqual(of(null), { targetSkills: [], targetSop: null, targetAgent: null, targetUnresolved: null });
  // Explicit v3 fields win.
  assert.deepEqual(targetsOf(V3, cat).targetSkills, ['backend-review']);
});

test('every bench task with an old target maps to a known unit in this repo', () => {
  const tasks = loadTasks(BENCH_DIR);
  const cat = catalogOfRepo(BENCH_DIR);
  assert.ok(cat.skills?.length && cat.sops?.length && cat.agents?.length, 'the repo lists skills, SOPs and agents');
  const unresolved = [...tasks.values()].filter((t) => t.targets.targetUnresolved).map((t) => `${t.id}: ${t.target}`);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(tasks.get('review-inventory-security').targets.targetSkills, ['backend-review']);
  assert.equal(tasks.get('sop-plan').targets.targetSop, 'k-plan');
});

test('the loader reads a v3 task and refuses one that breaks a v3 rule', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    write(path.join(bench, 'tasks/v3.json'), JSON.stringify({ ...V3, id: 'v3', fixture: 'fx' }));
    const tasks = loadTasks(bench);
    assert.deepEqual(tasks.get('v3').targets.targetSkills, ['backend-review']);
    assert.equal(tasks.get('t1').targets.targetUnresolved, null);
    write(path.join(bench, 'tasks/v3.json'), JSON.stringify({ ...V3, id: 'v3', fixture: 'fx', controlKind: 'none' }));
    assert.throws(() => loadTasks(bench), /invalid task file v3\.json:[\s\S]*twinOf is only for/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a hand-edited task needs a non-Claude recheck before lock', () => {
  const { lockedAt: _unlocked, ...open } = V3;
  const edited = { ...open, handEdited: { family: 'claude', editor: 'worker', log: 'HAND-EDITS.md' } };
  assert.deepEqual(v3Errors(edited), []);
  assert.ok(v3Errors({ ...edited, lockedAt: '2026-11-20' }).some((e) => /recheck/.test(e)));
  const items = ['no-method-or-decoy', 'fixture-lists-no-answer', 'key-matches-fixture', 'solvable-from-fixture'].map((check) => ({ check, verdict: 'pass' }));
  const ok = { ...edited, lockedAt: '2026-11-20', review: { family: 'zhipu', date: '2026-11-20', verdicts: [], recheck: { family: 'zhipu', model: 'glm-5', date: '2026-11-20', items } } };
  assert.deepEqual(v3Errors(ok), []);
  assert.deepEqual(validate(loadSchema('task'), ok), []);
  assert.ok(v3Errors({ ...ok, review: { ...ok.review, recheck: { ...ok.review.recheck, family: 'claude' } } }).some((e) => /non-Claude/.test(e)));
});
