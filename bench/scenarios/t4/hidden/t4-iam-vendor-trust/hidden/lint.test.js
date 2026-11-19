'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lint } = require('./iam-eval');

const root = path.join(__dirname, '..');
const policy = (name) => JSON.parse(fs.readFileSync(path.join(root, 'infra', 'roles', name), 'utf8'));

for (const name of [
  'monitoring-trust.json',
  'monitoring-permissions.json',
  'backup-trust.json',
  'partner-ci-trust.json',
  'deploy-trust.json'
]) {
  test(`${name} has a valid policy document`, () => {
    assert.deepEqual(lint(policy(name)), []);
  });
}
