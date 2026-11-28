// SPDX-License-Identifier: Apache-2.0
'use strict';

// A planned early stop end to end (DEBT D-299): `bench.js run --max-tool-calls N` against a fake engine v3 kiro-cli
// that makes more calls than N and then hangs. The prompt-fix reply check of 2026-11-28 stopped every run this way on
// purpose, and the bench called the stop an INFRA FAILURE and exited 5, which stopped the owner script. The stop is the
// planned outcome: exit 0, the run is kept as earlyStopped and booked at the session's measured creditSplit (the D-297
// meter), not the censored floor. No credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cliSetup, runCli } = require('./cli-setup.js');

const READS = Array.from({ length: 6 }, () => ({ toolName: 'read_file', rawInput: {} }));
const ARGS = ['--replicates', '1', '--agent-engine', 'v3', '--run-credit-limit', '6', '--max-tool-calls', '3'];
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ledgerOf = (out) => fs.readFileSync(path.join(out, 'credit-ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'run');

test('a run stopped at --max-tool-calls exits 0, is no infra failure and is booked at its measured creditSplit', () => {
  const s = cliSetup({ toolCalls: READS, creditSplit: [0.6, 1.64], contextUsage: [1], hangAfterContext: true });
  try {
    const r = runCli(s, ARGS);
    const log = fs.readFileSync(path.join(s.out, 'runner.log'), 'utf8');
    assert.equal(r.status, 0, `${r.stderr}\n${log.slice(-800)}`);
    assert.doesNotMatch(log, /INFRA FAILURE/);
    const res = readJson(path.join(s.out, 'vanilla', 't1', '1', 'result.json'));
    assert.ok(res.flags.includes('earlyStopped'), res.flags.join());
    assert.match(res.error, /stopped early: max-tool-calls \(3\)/);
    assert.equal(res.creditMeasured, 1.64);
    assert.equal(res.creditsCharged, 1.64);
    assert.deepEqual(ledgerOf(s.out).map((e) => e.charged), [1.64]);
    assert.equal(readJson(path.join(s.out, 'summary.json')).infraFailure, undefined);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('an early stop with no creditSplit is booked at the censored floor, as before', () => {
  const s = cliSetup({ toolCalls: READS, contextUsage: [1], hangAfterContext: true });
  try {
    const r = runCli(s, ARGS);
    assert.equal(r.status, 0, r.stderr);
    const res = readJson(path.join(s.out, 'vanilla', 't1', '1', 'result.json'));
    assert.equal('creditMeasured' in res, false);
    assert.equal(res.creditsCharged, 1);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
