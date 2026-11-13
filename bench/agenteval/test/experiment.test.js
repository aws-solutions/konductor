// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadExperiment, parseExperiment } = require('../lib/experiment.js');

const withFile = (content, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenteval-exp-'));
  try {
    const file = path.join(dir, 'exp.json');
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return fn(file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('a full experiment file is read and its fields renamed', () => {
  const exp = withFile({
    cases: [{ name: 'n', session_id: 's1', input: 'hello there world', expected_output: 'out', expected_trajectory: ['a(1)'], metadata: { difficulty: 'easy' }, expected_assertion: null }],
    evaluators: [{ evaluator_type: 'TrajectoryEvaluator', rubric: 'Score it.' }],
  }, loadExperiment);
  assert.deepEqual(exp.cases, [{ name: 'n', sessionId: 's1', input: 'hello there world', expectedOutput: 'out', expectedTrajectory: ['a(1)'], metadata: { difficulty: 'easy' } }]);
  assert.deepEqual(exp.evaluators, [{ evaluatorType: 'TrajectoryEvaluator', rubric: 'Score it.' }]);
  assert.ok(exp.sourceFile.endsWith('exp.json'));
});

test('null and missing fields are tolerated', () => {
  const exp = parseExperiment({ cases: [{ input: null, expected_trajectory: null, metadata: null }, {}] });
  assert.equal(exp.cases.length, 2);
  assert.deepEqual(exp.cases[1], { name: '', sessionId: null, input: null, expectedOutput: null, expectedTrajectory: null, metadata: null });
  assert.deepEqual(exp.evaluators, []);
  assert.equal(exp.sourceFile, null);
});

test('untyped fields keep any shape', () => {
  const exp = parseExperiment({ cases: [{ input: 7, expected_trajectory: { odd: true }, metadata: 'text' }], evaluators: [null, { rubric: 3 }] });
  assert.equal(exp.cases[0].input, 7);
  assert.deepEqual(exp.cases[0].expectedTrajectory, { odd: true });
  assert.equal(exp.cases[0].metadata, 'text');
  assert.deepEqual(exp.evaluators, [{ evaluatorType: null, rubric: null }]);
});

test('non-objects are rejected with a clear message', () => {
  for (const [raw, want] of [[null, /got null/], [[], /got an array/], ['x', /got string/], [3, /got number/]]) assert.throws(() => parseExperiment(raw), want);
  assert.throws(() => parseExperiment({}), /no "cases" array/);
  assert.throws(() => parseExperiment({ cases: {} }), /no "cases" array/);
  assert.throws(() => parseExperiment({ cases: [{}, 'x'] }), /case 1 must be an object, got string/);
  assert.throws(() => parseExperiment({ cases: [null] }), /case 0 must be an object, got null/);
});

test('a missing file or bad JSON names the file', () => {
  assert.throws(() => loadExperiment('/nonexistent/exp.json'), /cannot read experiment file \/nonexistent\/exp.json/);
  withFile('{not json', (file) => assert.throws(() => loadExperiment(file), /exp\.json is not valid JSON/));
  withFile('[]', (file) => assert.throws(() => loadExperiment(file), /exp\.json: experiment must be a JSON object/));
});
