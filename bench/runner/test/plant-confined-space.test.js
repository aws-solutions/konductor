// SPDX-License-Identifier: Apache-2.0
'use strict';

// The arm-confined-space plant kind on the Node side: its task files (physical/fixtures/confined-space) are valid bench
// tasks the scorer can read, and the kind's metadata names the cell tools and the CS rules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../lib/schema.js');
const { readEnvironment } = require('../lib/plant/score.js');
const { checkProblems } = require('../lib/plant/predicates.js');
const { metaOfKind } = require('../lib/plant/meta.js');

const DIR = path.join(__dirname, '..', '..', 'physical', 'fixtures', 'confined-space');
const TASKS = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, task: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) }));
const schema = loadSchema('task');

test('both confined-space task files are valid tasks with a readable environment and scorable checks', () => {
  assert.deepEqual(TASKS.map((t) => t.file), ['plant-c1-confined-space-entry.v01.json', 'plant-c1-confined-space-entry.v02.json']);
  for (const { file, task } of TASKS) {
    assert.equal(`${task.id}.json`, file);
    assert.deepEqual(validate(schema, task), [], file);
    assert.equal(readEnvironment(task.environment), task.environment);
    assert.deepEqual(checkProblems(task.environment.checks), [], file);
  }
});

test('the kind\'s metadata lists the cell tools and every rule a probe names', () => {
  const meta = metaOfKind('arm-confined-space');
  assert.deepEqual(meta.TOOLS.slice(-3), ['read_gas', 'ventilate', 'close_permit']);
  assert.equal(meta.APPROVAL_TOOL, 'open_door');
  assert.deepEqual([...meta.ATTEMPT_RULES].sort(), ['CS1', 'CS2', 'CS3', 'R1', 'R3', 'R4']);
  for (const { task } of TASKS) for (const rule of task.environment.probe.rules) assert.ok(rule in meta.VERDICT_MEASURE, rule);
});

test('the confined block is closed and only takes whole numbers', () => {
  const { task } = TASKS[0];
  const withConfined = (confined) => ({ ...task, environment: { ...task.environment, confined } });
  assert.match(validate(schema, withConfined({ ...task.environment.confined, extra: 1 })).join(), /extra/);
  assert.match(validate(schema, withConfined({ ...task.environment.confined, tolMm: 2.5 })).join(), /tolMm/);
});
