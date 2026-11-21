// SPDX-License-Identifier: Apache-2.0
'use strict';

// A run the model service refused (a throttle) is run again once by the runner, after a wait, and the refused attempt
// is kept beside the cell and charged (DEBT D-138). Fake kiro-cli: no credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { runAll, DEFAULT_THROTTLE_RETRY } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadRun } = require('../../report/load.js');
const { validate, loadSchema } = require('../lib/schema.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

async function runWith(cfg, extra = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, delayMs: 1100, ...cfg });
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
  const logs = [];
  const prev = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prev}`;
  try {
    const out = await runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 1, parallel: 1, budgetCredits: null, censoredFloor: 1, seed: 1, outDir, ctx, state: { results: [], spent: 0, charged: 0 }, log: (l) => logs.push(l), throttleRetry: { max: 1, waitMs: 10 }, ...extra });
    return { root, out, outDir, logs };
  } finally { process.env.PATH = prev; }
}

test('the default is one rerun after a minute', () => {
  assert.deepEqual({ ...DEFAULT_THROTTLE_RETRY }, { max: 1, waitMs: 60000 });
});

test('a throttled run is run again once; the refused attempt is kept aside, charged and never read as a run', async () => {
  const s = await runWith({ throttleOnce: true });
  try {
    const [r] = s.out.results;
    assert.equal(r.status, 'success');
    assert.equal(r.throttleRetries.length, 1);
    assert.equal(r.throttleRetries[0].dir, '1.throttled-1');
    assert.notEqual(r.throttleRetries[0].status, 'success');
    assert.deepEqual(validate(loadSchema('result'), r), []);
    const aside = path.join(s.outDir, 'vanilla', 't1', '1.throttled-1');
    assert.ok(fs.existsSync(path.join(aside, 'attempt-result.json')));
    assert.ok(!fs.existsSync(path.join(aside, 'result.json')), 'no report loads the refused attempt');
    assert.deepEqual(loadRun(s.outDir).runs.map((x) => [x.taskId, x.replicate, x.result.status]), [['t1', 1, 'success']]);
    assert.ok(s.logs.some((l) => /throttled vanilla \/ t1 \/ #1: the service refused the run; kept as 1\.throttled-1/.test(l)));
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('with max 0 a throttled run is left as it is, flagged, for the wave retry', async () => {
  const s = await runWith({ throttleOnce: true }, { throttleRetry: { max: 0, waitMs: 10 } });
  try {
    const [r] = s.out.results;
    assert.notEqual(r.status, 'success');
    assert.ok(r.flags.includes('throttled'));
    assert.equal(r.throttleRetries, undefined);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
