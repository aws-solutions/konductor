// SPDX-License-Identifier: Apache-2.0
'use strict';

// The task validator rules for the autonomy tier, on synthetic task objects and scores.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { shapeProblems, evidenceProblems, NO_QUESTIONS, PROCESS_CRITERIA } = require('../../tasks/validate-autonomy.js');

const RUBRIC = [
  ...PROCESS_CRITERIA.map((id) => ({ id, criterion: `criterion ${id}`, weight: 1 })),
  { id: 'works', criterion: 'The change works.', weight: 2 },
];

function task(over = {}) {
  return {
    id: 'autonomy-demo', class: 'autonomy', target: null, fixture: 'f', hidden: 'autonomy-demo', timeoutSec: 600, tiers: ['autonomy'],
    prompt: 'Add a request timeout to the client in src/client.js and make sure node --test passes.',
    checks: [
      { type: 'tests', cmd: 'node --test intended/*.test.js', min: 3, group: 'intended' },
      { type: 'tests', cmd: 'node --test invariants/*.test.js', min: 2, group: 'invariant' },
    ],
    rubric: RUBRIC,
    autonomy: {
      clarifications: [
        { id: 'unit', topic: 'timeout unit', keywords: ['seconds?', 'milliseconds?'], answer: 'Seconds.' },
        { id: 'scope', topic: 'limit scope', keywords: ['per (user|account)'], answer: 'Per account.' },
      ],
    },
    exampleQuestions: ['Should the timeout be in seconds or milliseconds?', 'Is the limit per user or per account?'],
    ...over,
  };
}

function hiddenRoot(groups = ['intended', 'invariants']) {
  const root = tmp();
  for (const g of groups) write(path.join(root, 'autonomy-demo', g, 'a.test.js'), '\n');
  return root;
}

const problems = (t, opts = {}) => {
  const root = opts.root ?? hiddenRoot();
  try { return shapeProblems(t, { hiddenRoot: root }); } finally { if (!opts.root) fs.rmSync(root, { recursive: true, force: true }); }
};
const has = (list, re) => list.some((p) => re.test(p));

test('a well-formed autonomy task has no problems', () => {
  assert.deepEqual(problems(task()), []);
});

test('the uniform no-questions sentence must be absent', () => {
  assert.ok(has(problems(task({ prompt: `Add a timeout. ${NO_QUESTIONS}` })), /no-questions sentence/));
  assert.ok(has(problems(task({ prompt: `${NO_QUESTIONS} Add a timeout.` })), /no-questions sentence/));
});

test('the prompt must not say whether the user is around, or mention clarifications, scripted answers, grading, agents, skills or benchmarks', () => {
  for (const bad of [
    'I am not available today, so add a timeout.',
    'I am unavailable; add a timeout.',
    'Ask me whatever you need, then add a timeout.',
    'Do not ask me anything; add a timeout.',
    'There are clarifications for this. Add a timeout.',
    'The answers are scripted. Add a timeout.',
    'Hidden tests check this. Add a timeout.',
    'You will be graded on this. Add a timeout.',
    'Use your skills to add a timeout.',
    'This agent should add a timeout.',
    'For the benchmark, add a timeout.',
  ]) assert.ok(problems(task({ prompt: bad })).length > 0, bad);
});

test('class, tier, timeout and the autonomy block must agree', () => {
  assert.ok(has(problems(task({ tiers: ['autonomy', 'full'] })), /tiers/));
  assert.ok(has(problems(task({ timeoutSec: 300 })), /timeoutSec/));
  assert.ok(has(problems(task({ timeoutSec: 1200 })), /timeoutSec/));
  const t = task();
  delete t.autonomy;
  assert.ok(has(problems(t), /autonomy block/));
  assert.ok(has(problems(task({ class: 'hard' })), /autonomy block|class/));
});

test('the rubric must carry the three process criteria', () => {
  const missing = RUBRIC.filter((r) => r.id !== PROCESS_CRITERIA[1]);
  assert.ok(has(problems(task({ rubric: missing })), new RegExp(PROCESS_CRITERIA[1])));
});

test('at most four clarifications, unique ids, answers present', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, topic: 't', keywords: [`k${i}`], answer: 'a' }));
  assert.ok(has(problems(task({ autonomy: { clarifications: many }, exampleQuestions: many.map((_, i) => `k${i}?`) })), /at most 4 clarifications/));
  const dup = [{ id: 'x', topic: 't', keywords: ['a'], answer: 'a' }, { id: 'x', topic: 't', keywords: ['b'], answer: 'b' }];
  assert.ok(has(problems(task({ autonomy: { clarifications: dup }, exampleQuestions: ['a?', 'b?'] })), /duplicate clarification id/));
});

test('keywords must compile', () => {
  const bad = task({ autonomy: { clarifications: [{ id: 'u', topic: 't', keywords: ['(unclosed'], answer: 'a' }] }, exampleQuestions: ['(unclosed?'] });
  assert.ok(has(problems(bad), /does not compile/));
});

test('each clarification must match at least one example question, and each example question at least one clarification', () => {
  assert.ok(has(problems(task({ exampleQuestions: ['Is the limit per user or per account?'] })), /clarification "unit" matches none of the example questions/));
  assert.ok(has(problems(task({ exampleQuestions: ['Should the timeout be in seconds or milliseconds?', 'Is the limit per user or per account?', 'What colour should the logo be?'] })), /example question .* matches no clarification/));
  assert.ok(has(problems(task({ exampleQuestions: undefined })), /exampleQuestions/));
});

test('a no-question-needed task has no clarifications; a task that needs asking has at least one', () => {
  const nq = task({ autonomy: { clarifications: [], noQuestionNeeded: true }, exampleQuestions: ['What colour should the logo be?'] });
  assert.deepEqual(problems(nq), []);
  const wrong = task({ autonomy: { ...task().autonomy, noQuestionNeeded: true } });
  assert.ok(has(problems(wrong), /noQuestionNeeded.*no clarifications/));
  assert.ok(has(problems(task({ autonomy: { clarifications: [] }, exampleQuestions: [] })), /at least one clarification/));
});

test('both test groups need a check, every tests check needs a group, and the hidden folders must exist', () => {
  assert.ok(has(problems(task({ checks: [{ type: 'tests', cmd: 'x', min: 1, group: 'intended' }] })), /invariant/));
  assert.ok(has(problems(task({ checks: [{ type: 'tests', cmd: 'x', min: 1 }, { type: 'tests', cmd: 'y', min: 1, group: 'invariant' }] })), /group/));
  assert.ok(has(problems(task({ checks: [...task().checks, { type: 'cmd', cmd: 'true', expectExit: 0, group: 'intended' }] })), /group applies to tests checks/));
  const root = hiddenRoot(['intended']);
  try { assert.ok(has(problems(task(), { root }), /invariants/)); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- evidence ----

const g = (passed, total) => ({ passed, total });
const GOOD = {
  reference: { intended: g(3, 3), invariant: g(2, 2) },
  again: { intended: g(3, 3), invariant: g(2, 2) },
  fixture: { intended: g(0, 3), invariant: g(2, 2) },
  partials: [{ name: 'ms', intended: g(2, 3), invariant: g(2, 2) }, { name: 'user', intended: g(1, 3), invariant: g(2, 2) }],
};

test('good evidence has no problems', () => {
  assert.deepEqual(evidenceProblems(task(), GOOD), []);
});

test('the reference must pass every intended and invariant test, deterministically', () => {
  assert.ok(has(evidenceProblems(task(), { ...GOOD, reference: { intended: g(2, 3), invariant: g(2, 2) } }), /reference solution passes 2\/3 intended/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, reference: { intended: g(3, 3), invariant: g(1, 2) } }), /reference solution passes 1\/2 invariant/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, again: { intended: g(2, 3), invariant: g(2, 2) } }), /not deterministic/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, reference: { intended: g(4, 4), invariant: g(2, 2) }, again: { intended: g(4, 4), invariant: g(2, 2) } }), /declare min 3/));
});

test('the untouched fixture must fail at least one intended test', () => {
  assert.ok(has(evidenceProblems(task(), { ...GOOD, fixture: { intended: g(3, 3), invariant: g(2, 2) } }), /untouched fixture passes all intended/));
});

test('two alternative-interpretation partials must each fail an intended test and pass every invariant', () => {
  assert.ok(has(evidenceProblems(task(), { ...GOOD, partials: [GOOD.partials[0]] }), /at least 2 partial/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, partials: [GOOD.partials[0], { name: 'full', intended: g(3, 3), invariant: g(2, 2) }] }), /partial "full" passes every intended test/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, partials: [GOOD.partials[0], { name: 'bad', intended: g(1, 3), invariant: g(1, 2) }] }), /partial "bad" fails invariant/));
  assert.ok(has(evidenceProblems(task(), { ...GOOD, partials: [GOOD.partials[0], { name: 'zero', intended: { unparsed: true } , invariant: g(2, 2) }] }), /partial "zero".*unreadable/));
});
