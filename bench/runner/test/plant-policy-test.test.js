// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { cmdPlantPolicyTest, policyTestCommand } = require('../lib/plant/policy-test.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { parseArgs } = require('../bench.js');

function withExitCode(fn) {
  const before = process.exitCode;
  try {
    fn();
    return process.exitCode;
  } finally {
    process.exitCode = before;
  }
}

test('the policy test runs truth_table_run.py isolated, with the release and the interpreter', () => {
  const { file, args } = policyTestCommand({ release: 'rel', python: '/venv/bin/python' });
  assert.equal(file, '/venv/bin/python');
  assert.deepEqual([args[0], path.basename(args[1]), args[2], args[3], args[4], args[5]], ['-I', 'truth_table_run.py', '--release', path.resolve('rel'), '--python', '/venv/bin/python']);
});

test('the exit code is the truth-table run exit code', () => {
  const code = withExitCode(() => cmdPlantPolicyTest({ release: 'rel' }, () => ({ status: 1 })));
  assert.equal(code, 1);
});

test('the interpreter defaults to python3', () => {
  let used;
  withExitCode(() => cmdPlantPolicyTest({ release: 'rel' }, (file) => { used = file; return { status: 0 }; }));
  assert.equal(used, 'python3');
});

test('a missing --release is a usage error and runs nothing', () => {
  let ran = false;
  const code = withExitCode(() => cmdPlantPolicyTest({}, () => { ran = true; return { status: 0 }; }));
  assert.deepEqual([code, ran], [2, false]);
});

test('the command accepts --release and --python and rejects other flags', () => {
  assert.equal(checkArgs('plant-policy-test', parseArgs(['--release', 'r', '--python', 'p'])), null);
  assert.match(checkArgs('plant-policy-test', parseArgs(['--releases', 'r'])), /did you mean --release/);
});
