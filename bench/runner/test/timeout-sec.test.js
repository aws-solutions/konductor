// SPDX-License-Identifier: Apache-2.0
'use strict';

// `run --timeout-sec N` replaces the timeout of every selected task; it must be a positive integer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cliSetup, runCli } = require('./cli-setup.js');
const { describePlan } = require('../lib/orchestrate.js');
const { timeoutSecOpt } = require('../lib/run-cmd.js');

// A run under one second is flagged as an infrastructure failure (exit 5), so the fake run lingers past it.
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('timeoutSecOpt accepts a positive integer only', () => {
  assert.equal(timeoutSecOpt({}), null);
  assert.equal(timeoutSecOpt({ 'timeout-sec': '90' }), 90);
  for (const bad of ['0', '-5', '1.5', 'abc', '', true]) assert.throws(() => timeoutSecOpt({ 'timeout-sec': bad }), /--timeout-sec must be a positive integer/);
});

test('the plan line names the override and uses it for the worst case', () => {
  const tasks = [{ timeoutSec: 60 }, { timeoutSec: 60 }];
  assert.doesNotMatch(describePlan({ tasks, arms: [1], replicates: 1, parallel: 1, budgetCredits: null }).text, /--timeout-sec/);
  const p = describePlan({ tasks: tasks.map((t) => ({ ...t, timeoutSec: 1800 })), arms: [1], replicates: 1, parallel: 1, budgetCredits: null, timeoutSecOverride: 1800 });
  assert.match(p.text, /task timeout overridden to 1800 s by --timeout-sec/);
  assert.equal(p.worstWallSec, 3600);
});

test('run accepts --timeout-sec, applies it to the tasks and records it in run-config and summary', () => {
  const s = cliSetup({ delayMs: 1100 });
  try {
    const r = runCli(s, ['--replicates', '1', '--timeout-sec', '123']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /task timeout overridden to 123 s by --timeout-sec/);
    const cfg = JSON.parse(fs.readFileSync(path.join(s.out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.timeoutSecOverride, 123);
    assert.deepEqual(cfg.timeoutSecByTask, { t1: 123 });
    const summary = JSON.parse(fs.readFileSync(path.join(s.out, 'summary.json'), 'utf8'));
    assert.equal(summary.timeoutSecOverride, 123);
  } finally { rm(s.root); }
});

test('without the flag the task file timeout stands; a bad value is refused before anything starts', () => {
  const s = cliSetup({ delayMs: 1100 });
  try {
    const r = runCli(s, ['--replicates', '1']);
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(s.out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.timeoutSecOverride, null);
    assert.notEqual(cfg.timeoutSecByTask.t1, 123);
  } finally { rm(s.root); }
  const bad = cliSetup({ delayMs: 1100 });
  try {
    const r = runCli(bad, ['--timeout-sec', '0']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--timeout-sec must be a positive integer/);
    assert.equal(fs.existsSync(bad.out), false);
  } finally { rm(bad.root); }
});
