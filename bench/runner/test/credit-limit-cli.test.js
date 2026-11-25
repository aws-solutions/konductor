// SPDX-License-Identifier: Apache-2.0
'use strict';

// --run-credit-limit-mode end to end: `bench.js run` against a fake kiro-cli writes the mode into run-config.json and
// the outcome into result.json. Soft lets the run finish over the limit; without the flag the limit stays hard.
// No credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cliSetup, runCli } = require('./cli-setup.js');

// Meters 3 credits, then lingers past the runner's 1 s credit poll so the poll sees them while the agent still runs.
const OVER = { credits: 3, lingerMs: 2500, finalText: 'all done' };
const ARGS = ['--replicates', '1', '--agent-engine', 'v2', '--run-credit-limit', '1'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const resultOf = (out) => readJson(path.join(out, 'vanilla', 't1', '1', 'result.json'));

test('soft: run-config.json records runCreditLimitMode and result.json is flagged over the limit with a warning', () => {
  const s = cliSetup(OVER);
  try {
    const r = runCli(s, [...ARGS, '--run-credit-limit-mode', 'soft']);
    assert.equal(r.status, 0, r.stderr);
    const cfg = readJson(path.join(s.out, 'run-config.json'));
    assert.equal(cfg.runCreditLimit, 1);
    assert.equal(cfg.runCreditLimitMode, 'soft');
    const res = resultOf(s.out);
    assert.equal(res.status, 'success', res.error);
    assert.ok(res.flags.includes('creditLimitExceeded'), res.flags.join());
    assert.equal(res.flags.includes('creditLimit'), false);
    assert.equal(res.creditLimitMode, 'soft');
    assert.equal(res.creditLimitWarning, 'per-run credit limit 1 passed at 3.000 credits (soft mode: the run was not stopped)');
    assert.match(fs.readFileSync(path.join(s.out, 'runner.log'), 'utf8'), /warning vanilla \/ t1 \/ #1: per-run credit limit 1 passed/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('without --run-credit-limit-mode the limit is hard: run-config.json has no mode and the run is stopped', () => {
  const s = cliSetup(OVER);
  try {
    runCli(s, ARGS);
    const cfg = readJson(path.join(s.out, 'run-config.json'));
    assert.equal(cfg.runCreditLimit, 1);
    assert.equal('runCreditLimitMode' in cfg, false);
    const res = resultOf(s.out);
    assert.ok(res.flags.includes('creditLimit'), res.flags.join());
    assert.match(res.error, /per-run credit limit 1 reached/);
    assert.equal('creditLimitMode' in res, false);
    assert.equal('creditLimitWarning' in res, false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
