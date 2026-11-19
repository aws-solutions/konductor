'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_FILES } = require('../src/policy-files');

test('policy inventory has three groups and one boundary', () => {
  assert.equal(POLICY_FILES.length, 4);
  assert.ok(POLICY_FILES.includes('iam/groups/on-call.json'));
  assert.ok(POLICY_FILES.includes('iam/permissions-boundary.json'));
});
