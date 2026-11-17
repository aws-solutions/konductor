// SPDX-License-Identifier: Apache-2.0
// Tests of the baselines committed under bench/baselines/ (the real ones, not the fixture): the manifest check passes,
// `plan` can read every skill that has one, and each record of bench/exclusions.json names a committed task. They read
// the committed files only and change nothing.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { createLayout } = require('../../../scripts/bench/lib/layout');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const {
  loadExclusions,
  knownTaskIds,
  unmatchedExclusions,
} = require('../../../scripts/bench/lib/baseline');
const {
  verifyBaselines,
} = require('../../../scripts/bench/lib/baseline-manifest');
const helpers = require('./helpers');

const layout = createLayout();
const skills = fs
  .readdirSync(layout.baselinesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * A batch holds eight tasks as written. A trim of easy tasks removes some, down to the task file format's minimum
 * of five, so a committed batch holds five to eight.
 */
const MAX_TASKS_PER_BATCH = 8;
/** The fewest tasks a task file may hold (formats.js, minScenarios). */
const MIN_TASKS_PER_BATCH = 5;
const BATCHES_PER_SKILL = 2;

test('the committed baselines match MANIFEST.json and hold no credential, home path or account number', () => {
  const { problems, fileCount, skillCount } = verifyBaselines(layout);
  assert.deepEqual(problems, []);
  assert.equal(skillCount, skills.length);
  assert.equal(fileCount, skills.length * (1 + 2 * BATCHES_PER_SKILL));
});

test('plan reads every committed skill: ready, or rules stale when SKILL.md changed after the rules were frozen', () => {
  const plan = buildPlan({
    layout,
    config: helpers.exampleConfig(),
    skills,
  });
  assert.deepEqual(
    plan.skills.map((entry) => [entry.skill, entry.problems]),
    skills.map((skill) => [skill, []]),
  );
  for (const entry of plan.skills)
    assert.ok(
      ['ready', 'rules stale'].includes(entry.status),
      `${entry.skill}: ${entry.status}`,
    );
});

// The reading A exclusions of bench/exclusions.json. A record added or removed changes this list on purpose.
const EXCLUDED_IDS = [
  'security-test-generation-rules-1',
  'security-test-generation-rules-3',
  'security-test-generation-rules-8',
];

test('every record of bench/exclusions.json names a task of a committed baseline, and the plan leaves out exactly those tasks', () => {
  const exclusions = loadExclusions(layout);
  const known = knownTaskIds(layout);
  const recorded = [];
  for (const [batch, entry] of Object.entries(exclusions.batches)) {
    assert.deepEqual(unmatchedExclusions(exclusions, batch, known), [], batch);
    recorded.push(...entry.scenarios.map((record) => record.id));
  }
  assert.deepEqual([...recorded].sort(), EXCLUDED_IDS);
  const plan = buildPlan({ layout, config: helpers.exampleConfig(), skills });
  const left = plan.skills.flatMap((entry) =>
    entry.batches.flatMap((batch) => batch.excluded),
  );
  assert.deepEqual(left.sort(), EXCLUDED_IDS);
});

test('every committed skill has two batches of five to eight tasks, and reading A lacks only the excluded ones', () => {
  const plan = buildPlan({
    layout,
    config: helpers.exampleConfig(),
    skills,
  });
  for (const entry of plan.skills) {
    assert.equal(entry.batches.length, BATCHES_PER_SKILL, entry.skill);
    for (const batch of entry.batches) {
      assert.ok(
        batch.tasks >= MIN_TASKS_PER_BATCH &&
          batch.tasks <= MAX_TASKS_PER_BATCH,
        `${entry.skill} ${batch.batch} has ${batch.tasks} tasks`,
      );
      assert.equal(
        batch.tasks_a,
        batch.tasks - batch.excluded.length,
        `${entry.skill} ${batch.batch}`,
      );
    }
  }
});
