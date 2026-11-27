// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fairMustLoad, RULES } = require('../lib/load-fairness.js');
const { loadCheckOf } = require('../lib/load-check.js');
const { loadTaskFiles } = require('../../scenarios/files.js');

test('fairMustLoad: k-existing-design-review is met by a k-architect spawn; backend-development stays only on a stack fixture', () => {
  assert.deepEqual(fairMustLoad('t2-dr-rate-limits', ['risk-management', 'k-existing-design-review']), ['risk-management', 'k-architect']);
  assert.deepEqual(fairMustLoad('t9-impl-cart-summary', ['backend-development', 'code-review']), ['code-review']);
  assert.deepEqual(fairMustLoad('t4-iam-ci-deploy-role-twin', ['backend-development']), ['backend-development']);
  assert.deepEqual(fairMustLoad('t2-dr-rate-limits', ['k-architect', 'k-existing-design-review']), ['k-architect'], 'no unit twice');
});

test('loadCheckOf applies the fairness rules: a k-architect spawn meets the design-review SOP', () => {
  const order = { order: [{ name: 'k-architect', kind: 'agent', at: 3, failed: false }], firstWriteAt: null };
  const lc = loadCheckOf({ order, extraction: { skillsLoaded: [] }, task: { id: 't2-dr-rate-limits', loadCheck: { mustLoad: ['k-existing-design-review', 'backend-development'] } }, arm: {} });
  assert.deepEqual(lc.mustLoad, [{ unit: 'k-architect', loaded: true, beforeFirstWrite: true }]);
});

// The keep list must match the fixtures: a task keeps backend-development only when its fixture names its stack.
test('the backend-development keep list matches the fixtures that use Lambda or DynamoDB', () => {
  const pack = path.join(__dirname, '..', '..', 'scenarios');
  const stack = /lambda|dynamodb|aws-sdk|serverless/i;
  const usesStack = (dir) => {
    if (!fs.existsSync(dir)) return false;
    for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (e.isFile() && stack.test(fs.readFileSync(path.join(e.parentPath ?? e.path, e.name), 'utf8'))) return true;
    }
    return false;
  };
  for (const { file, task } of loadTaskFiles(pack)) {
    const must = task.loadCheck?.mustLoad ?? task.targetSkills ?? [];
    if (!must.includes('backend-development')) continue;
    const keep = RULES.stackSkills['backend-development'].includes(task.id);
    assert.equal(keep, usesStack(path.join(path.dirname(file), 'fixtures', String(task.fixture))), task.id);
  }
});
