// SPDX-License-Identifier: Apache-2.0
'use strict';

// A run that could not log in never ran a turn: it is charged nothing and flagged as infrastructure, not as a timeout.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authFailureText, neverStartedTurn, classifyAuthFailure } = require('../lib/auth-failure.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');
const { runAll } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const { readLedger } = require('../lib/credit-ledger.js');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');

const ev = (type, data) => ({ type, data });
const ran = () => aggregateStream([
  ev('metadata', { sessionId: 's1', turnDurationMs: 500, meteringUsage: [{ value: 1, unit: 'credit' }] }),
  ev('runFinished', { status: 'success', stopReason: 'end_turn', finalText: 'done', finalTextTruncated: false }),
]);
const failed = { timedOut: false, exitCode: 1, wallClockMs: 200, error: null };

test('the three observed login messages are recognised, other errors are not', () => {
  assert.match(authFailureText('Error: Not logged in'), /Not logged in/);
  assert.match(authFailureText('x\nAuthentication failed: try again\ny'), /Authentication failed/);
  assert.match(authFailureText('Host refresh callback returned token already expired'), /already expired/);
  assert.equal(authFailureText('connection reset by peer', '', null), null);
});

test('a stream with no metering, tool call or finished run never started a turn', () => {
  assert.equal(neverStartedTurn(null), true);
  assert.equal(neverStartedTurn(aggregateStream([ev('runStarted', { engine: 'v2' })])), true);
  assert.equal(neverStartedTurn(ran()), false);
  assert.equal(neverStartedTurn(aggregateStream([ev('sessionUpdate', { update: { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'x', _meta: { kiro: { toolName: 'fs_read' } } } })])), false);
});

test('only a failed, never-started run with a login message is an auth failure', () => {
  const texts = ['Error: Not logged in\n'];
  assert.ok(classifyAuthFailure({ agg: null, exec: failed, texts }));
  assert.equal(classifyAuthFailure({ agg: ran(), exec: failed, texts }), null, 'a turn ran');
  assert.equal(classifyAuthFailure({ agg: null, exec: { ...failed, timedOut: true }, texts }), null, 'a timeout stays a timeout');
  assert.equal(classifyAuthFailure({ agg: null, exec: { timedOut: false, exitCode: 0, error: null }, texts }), null, 'exit 0');
  assert.equal(classifyAuthFailure({ agg: null, exec: failed, texts: ['segfault'] }), null, 'no login message');
});

const ARM = { id: 'v1.2.0', label: 'v1.2.0', ref: 'v1.2.0', commitSha: 'abc', harness: 'kiro-cli-v2', agent: 'konductor' };
const base = { arm: ARM, task: { id: 't1' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine: 'v2' }, session: null, checks: [], transcript: null, env: { kiroCliVersion: 'k', modelListSnapshotPath: null } };

test('an auth failure is not credit-censored and has no lower bound; a real timeout still is', () => {
  const auth = buildResult({ ...base, exec: failed, agg: null, meta: { authFailure: 'Not logged in', infraError: 'login not valid' } });
  assert.equal(auth.status, 'error');
  assert.equal(auth.creditsCensored, false);
  assert.equal(auth.creditsLowerBound, null);
  assert.equal(auth.authFailure, 'Not logged in');
  assert.deepEqual(validateResult(auth), []);
  const timeout = buildResult({ ...base, exec: { timedOut: true, exitCode: null, wallClockMs: 5000 }, agg: null });
  assert.equal(timeout.creditsCensored, true);
  assert.equal(timeout.authFailure, null);
});

const ARM_RUN = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

test('runAll charges a login failure 0, marks its ledger line infra, and does not count it as censored', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, { dir: probe, exitCode: 1, stderrText: 'Error: Not logged in' });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const outDir = path.join(root, 'out');
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
    };
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    let out;
    try {
      out = await runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM_RUN], prepared: new Map(), prepErrors: new Map(), replicates: 2, parallel: 1, budgetCredits: null, censoredFloor: 5, seed: 1, outDir, ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {} });
    } finally { process.env.PATH = prev; }
    assert.equal(out.results.length, 2);
    for (const r of out.results) {
      assert.match(r.authFailure, /Not logged in/);
      assert.equal(r.creditsCensored, false);
      assert.equal(r.creditsCharged, 0);
      assert.match(r.infraError, /login not valid/);
    }
    assert.equal(out.charged, 0);
    const led = readLedger(outDir);
    assert.ok(led.entries.every((e) => e.infra === 'auth' && e.charged === 0 && e.censored === false));
    assert.equal(led.totals.total, 0);
    assert.ok(!led.totals.censored);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
