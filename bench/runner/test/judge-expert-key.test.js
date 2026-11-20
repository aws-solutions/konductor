// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-62: a task's expertKey reaches the judge as one rubric criterion per item, its weak answers are in the prompt,
// and an item scores only when the judge's quote is found in the output. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const { judgedRubric, EXPERT_WEIGHT } = require('../lib/expert-rubric.js');
const { rubricPrompt } = require('../../judge/prompts.js');
const { validateRubricReply } = require('../../judge/validate.js');
const { dualCriteria, matchersFor } = require('../../judge/views.js');
const { rubricScore } = require('../../judge/score.js');
const { taskRevision } = require('../../judge/revision.js');

const KEY = {
  items: [
    { id: 'cause', text: 'Names the retained objects as the cause.', source: 'x' },
    { id: 'tradeoff', text: 'Says memory grows with endpoint count.', source: 'x' },
  ],
  weakAnswers: ['Made it faster.', 'All checks pass.', 'Used less memory.'],
};
const RUBRIC = [{ id: 'report', weight: 1, criterion: 'Reports the measurement.' }];

test('judgedRubric adds one expert: criterion per item sharing the default weight, and leaves keyless rubrics alone', () => {
  const r = judgedRubric(RUBRIC, KEY);
  assert.deepEqual(r.map((c) => c.id), ['report', 'expert:cause', 'expert:tradeoff']);
  assert.equal(r[1].weight + r[2].weight, EXPERT_WEIGHT);
  assert.match(r[1].criterion, /retained objects/);
  assert.equal(judgedRubric(RUBRIC, undefined), RUBRIC);
  assert.equal(judgedRubric(undefined, { items: [] }), undefined);
  assert.deepEqual(judgedRubric([], KEY).map((c) => c.id), ['expert:cause', 'expert:tradeoff'], 'a task with rubric [] still gets judged');
});

test('the expert-key placeholder is replaced and its weight is split over the items', () => {
  const r = judgedRubric([...RUBRIC, { id: 'expert-key', weight: 4, criterion: 'Score the share of expertKey items.' }], KEY);
  assert.deepEqual(r.map((c) => c.id), ['report', 'expert:cause', 'expert:tradeoff']);
  assert.deepEqual(r.slice(1).map((c) => c.weight), [2, 2]);
});

test('the rubric prompt shows each expert item and the weak answers, and asks for every expert id', () => {
  const task = { prompt: 'Fix the memory use.', rubric: judgedRubric(RUBRIC, KEY), expertKey: KEY };
  const p = rubricPrompt({ task, answerKey: null, bundleText: 'output' });
  assert.match(p, /expert:cause .*retained objects/);
  assert.match(p, /expert:tradeoff .*endpoint count/);
  assert.match(p, /WEAK ANSWERS[^\n]*\n- Made it faster\.\n- All checks pass\.\n- Used less memory\./);
  assert.match(p, /one entry for each rubric id: report, expert:cause, expert:tradeoff\./);
  assert.doesNotMatch(rubricPrompt({ task: { prompt: 'p', rubric: RUBRIC }, answerKey: null, bundleText: 'o' }), /WEAK ANSWERS/);
  assert.equal(validateRubricReply({ criteria: [{ id: 'report', verdict: 'pass', evidence: 'x' }] }, task.rubric).ok, false, 'a reply that skips the expert items is refused');
});

test('an expert item scores only with a quote found in the output: an unquoted pass fails, a plain criterion drops one level', () => {
  const rubric = judgedRubric(RUBRIC, KEY);
  const output = 'Peak memory was 40 MB. The cause was retained Record objects held per endpoint.';
  const reply = [
    { id: 'report', verdict: 'pass', evidence: 'invented quote about a report' },
    { id: 'expert:cause', verdict: 'pass', evidence: 'The cause was retained Record objects' },
    { id: 'expert:tradeoff', verdict: 'pass', evidence: 'memory grows with the number of endpoints' },
  ];
  const criteria = dualCriteria(reply, matchersFor(output), 'strict');
  assert.deepEqual(criteria.map((c) => c.verdict), ['partial', 'pass', 'fail']);
  // weights: report 1 (partial 0.5), cause 1.5 (pass), tradeoff 1.5 (fail) over 4
  assert.equal(rubricScore(rubric, criteria), (0.5 + 1.5) / 4);
});

test('the judge revision changes with the weak answers only for a task that has them', () => {
  const fixtureDir = __dirname;
  const plain = { prompt: 'p', rubric: RUBRIC, fixtureDir };
  assert.equal(taskRevision({ ...plain, expertKey: { items: [] } }), taskRevision(plain));
  const keyed = { ...plain, expertKey: KEY };
  assert.notEqual(taskRevision(keyed), taskRevision({ ...keyed, expertKey: { ...KEY, weakAnswers: ['Other.'] } }));
});
