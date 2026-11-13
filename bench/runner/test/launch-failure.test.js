// SPDX-License-Identifier: Apache-2.0
'use strict';

// A run whose agent binary could not be launched never ran a turn: it is charged nothing and flagged as infrastructure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchFailureText, classifyLaunchFailure } = require('../lib/launch-failure.js');
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
const gone = { timedOut: false, exitCode: 127, wallClockMs: 200, error: null };
const NO_FILE = ['sh: 1: /opt/tools/kiro-cli: No such file or directory\n'];

test('exec failure messages are recognised, other text is not', () => {
  assert.match(launchFailureText(NO_FILE[0]), /No such file or directory/);
  assert.match(launchFailureText('x\nspawn kiro-cli ENOENT\ny'), /ENOENT/);
  assert.match(launchFailureText('sh: 1: /opt/tools/kiro-cli: Permission denied'), /Permission denied/);
  assert.equal(launchFailureText('connection reset by peer', '', null), null);
});

test('exit 127 with no turn is a launch failure, with or without a message', () => {
  assert.match(classifyLaunchFailure({ agg: null, exec: gone, texts: NO_FILE }), /No such file/);
  assert.match(classifyLaunchFailure({ agg: null, exec: gone, texts: [''] }), /127/);
  assert.match(classifyLaunchFailure({ agg: null, exec: { timedOut: false, exitCode: 126, wallClockMs: 50, error: null }, texts: ['sh: kiro-cli: Permission denied'] }), /Permission denied/);
  assert.match(classifyLaunchFailure({ agg: null, exec: { timedOut: false, exitCode: null, wallClockMs: 5, error: 'spawn /x/kiro-cli ENOENT' }, texts: [] }), /ENOENT/);
});

test('a turn that ran, a timeout, a slow failure, exit 0 or an unrelated exit is never a launch failure', () => {
  assert.equal(classifyLaunchFailure({ agg: ran(), exec: gone, texts: NO_FILE }), null, 'a turn ran');
  assert.equal(classifyLaunchFailure({ agg: ran(), exec: { ...gone, exitCode: 1 }, texts: ['cat: x: No such file or directory'] }), null, 'the model printed it in a real turn');
  assert.equal(classifyLaunchFailure({ agg: null, exec: { ...gone, timedOut: true, exitCode: null }, texts: NO_FILE }), null, 'a timeout stays a timeout');
  assert.equal(classifyLaunchFailure({ agg: null, exec: { ...gone, wallClockMs: 60000 }, texts: NO_FILE }), null, 'too slow to be an exec failure');
  assert.equal(classifyLaunchFailure({ agg: null, exec: { ...gone, exitCode: 0 }, texts: NO_FILE }), null, 'exit 0');
  assert.equal(classifyLaunchFailure({ agg: null, exec: { ...gone, exitCode: 1 }, texts: NO_FILE }), null, 'an ordinary failure');
  assert.equal(classifyLaunchFailure({ agg: null, exec: { ...gone, exitCode: 126 }, texts: ['segfault'] }), null, '126 needs an exec message');
});

const ARM = { id: 'v1.2.0', label: 'v1.2.0', ref: 'v1.2.0', commitSha: 'abc', harness: 'kiro-cli-v2', agent: 'konductor' };
const base = { arm: ARM, task: { id: 't1' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine: 'v2' }, session: null, checks: [], transcript: null, env: { kiroCliVersion: 'k', modelListSnapshotPath: null } };

test('a launch failure is not credit-censored; a real timeout still is, with a lower bound', () => {
  const r = buildResult({ ...base, exec: gone, agg: null, meta: { launchFailure: 'exit code 127', infraError: 'agent binary could not be launched' } });
  assert.equal(r.status, 'error');
  assert.equal(r.creditsCensored, false);
  assert.equal(r.creditsLowerBound, null);
  assert.equal(r.launchFailure, 'exit code 127');
  assert.equal(r.authFailure, null);
  assert.ok(r.infraError);
  assert.deepEqual(validateResult(r), []);
  const timeout = buildResult({ ...base, exec: { timedOut: true, exitCode: null, wallClockMs: 600000, error: null }, agg: null, meta: {} });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.creditsCensored, true);
  assert.equal(timeout.launchFailure, null);
});

const ARM_RUN = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

async function runChunk(cfg, replicates, extra = {}) {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, { dir: probe, ...cfg });
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
    try {
      const out = await runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM_RUN], prepared: new Map(), prepErrors: new Map(), replicates, parallel: 1, budgetCredits: null, censoredFloor: 5, seed: 1, outDir, ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {}, ...extra });
      return { out, ledger: readLedger(outDir) };
    } finally { process.env.PATH = prev; }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('runAll charges a launch failure 0, marks its ledger line infra launch, and does not count it as censored', async () => {
  const { out, ledger } = await runChunk({ missingBinary: true }, 2);
  assert.equal(out.results.length, 2);
  for (const r of out.results) {
    assert.match(r.launchFailure, /No such file or directory/);
    assert.equal(r.authFailure, null);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.creditsCharged, 0);
    assert.match(r.infraError, /agent binary could not be launched/);
  }
  assert.equal(out.charged, 0);
  assert.ok(ledger.entries.every((e) => e.infra === 'launch' && e.charged === 0 && e.censored === false));
  assert.equal(ledger.totals.total, 0);
  assert.ok(!ledger.totals.censored);
});
