// SPDX-License-Identifier: Apache-2.0
'use strict';

// --resume runs only the planned cells an earlier command left without a result, and keeps the rest.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { runAll, planRuns, resumePlan } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { cmdRun } = require('../lib/run-cmd.js');
const { validateResult } = require('../lib/result.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const TASK = { id: 't1' };
const cell = (out, rep, status) => write(path.join(out, 'vanilla', 't1', String(rep), 'result.json'), JSON.stringify({ armId: 'vanilla', taskId: 't1', replicate: rep, status, marker: `old-${rep}` }));

test('resumePlan keeps finished cells, runs missing and never-ran ones, and errored ones only when asked', () => {
  const out = tmp();
  try {
    cell(out, 1, 'success');
    cell(out, 2, 'error');
    cell(out, 3, 'budget_skipped');
    cell(out, 4, 'timeout');
    const plan = planRuns([TASK], [ARM], 5, 1);
    const reps = (p) => p.map((i) => i.replicate).sort();
    assert.deepEqual(reps(resumePlan(plan, out).todo), [3, 5]);
    assert.equal(resumePlan(plan, out).kept, 3);
    assert.deepEqual(reps(resumePlan(plan, out, { errors: true }).todo), [2, 3, 5]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('runAll with resume runs only the missing cells and leaves the kept results untouched', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, { dir: probe });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const out = path.join(root, 'out');
    cell(out, 1, 'success');
    cell(out, 2, 'error');
    // Rep 3 was killed mid-trial: plant logs and no result.json (D-19).
    write(path.join(out, 'vanilla', 't1', '3', 'plant', 'gateway.jsonl'), '{"seq":0}\n');
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, out] },
    };
    const logs = [];
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    let res;
    try {
      res = await runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 3, parallel: 1, budgetCredits: null, censoredFloor: 0, seed: 1, outDir: out, ctx, state: { results: [], spent: 0, charged: 0 }, log: (m) => logs.push(m), resume: { errors: false } });
    } finally { process.env.PATH = prev; }
    assert.deepEqual(res.results.map((r) => r.replicate), [3]);
    const read = (rep) => JSON.parse(fs.readFileSync(path.join(out, 'vanilla', 't1', String(rep), 'result.json'), 'utf8'));
    assert.equal(read(1).marker, 'old-1');
    assert.equal(read(2).marker, 'old-2', 'an errored cell is kept without --resume-errors');
    assert.equal(read(3).armId, 'vanilla');
    assert.equal(read(3).resumedFrom, '3.resumed-1', 'the result names the kept earlier attempt');
    assert.deepEqual(validateResult(read(3)), [], 'resumedFrom is in the result schema');
    assert.equal(fs.readFileSync(path.join(out, 'vanilla', 't1', '3.resumed-1', 'plant', 'gateway.jsonl'), 'utf8'), '{"seq":0}\n', 'the killed attempt is kept, not deleted');
    assert.ok(!fs.existsSync(path.join(out, 'vanilla', 't1', '3', 'plant')), 'the rerun starts in an empty folder');
    assert.ok(logs.some((l) => /resume: 2 of 3 planned cell\(s\) already have a result and are kept; 1 to run/.test(l)), logs.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--resume needs the --out of an earlier run, and --resume-errors needs --resume', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    // --isolate none: the argument checks run after the isolation check, which fails on a host that blocks unshare.
    const base = { suite: 'lite', arms: 'vanilla', 'budget-credits': '1000', 'bench-dir': bench, 'repo-root': root, cache: path.join(root, 'cache'), isolate: 'none', 'allow-unisolated': true };
    await assert.rejects(cmdRun({ ...base, resume: true }), /--resume needs --out DIR of an earlier run/);
    await assert.rejects(cmdRun({ ...base, resume: true, out: path.join(root, 'empty') }), /no run-config\.json in/);
    await assert.rejects(cmdRun({ ...base, 'resume-errors': true, out: path.join(root, 'empty') }), /--resume-errors needs --resume/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
