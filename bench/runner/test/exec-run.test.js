// SPDX-License-Identifier: Apache-2.0
'use strict';

// executeRun against a fake kiro-cli: no credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const sandbox = require('../lib/sandbox.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

function setup(cfg) {
  const root = tmp();
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
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const task = loadTasks(bench).get('t1');
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  return { root, ctx, task, probe, watch, scratchDir, outDir: path.join(root, 'out', 't1'), cleanup };
}

const dirsUnder = (dir, name) => fs.readdirSync(dir, { recursive: true }).filter((f) => path.basename(String(f)) === name);

test('a normal run records metrics, final text, tool env keys and leaves no credentials behind', async () => {
  const s = setup({});
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.credits, 0.5);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.finalText, 'done');
    assert.equal(r.inFlightAtStart, 0);
    assert.equal(r.isolation, 'none');
    assert.deepEqual(r.homeTripwireHits, []);
    assert.equal(r.checks[0].passed, true);
    assert.equal(r.infraError, null);
    const started = JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8'));
    assert.match(started.cwd, /scratch\/r-[^/]+\/work$/);
    assert.equal(started.envKeys.includes('GITHUB_TOKEN'), false);
    assert.equal(started.envKeys.includes('KONDUCTOR_TELEMETRY'), false, 'vanilla does not see the name');
    assert.ok(started.args.includes('--model'));
    assert.equal(started.args.includes('--require-mcp-startup'), false);
    assert.deepEqual(fs.readdirSync(s.scratchDir), [], 'run root removed');
    assert.deepEqual(dirsUnder(s.root, 'data.sqlite3').filter((f) => String(f).includes('scratch')), []);
  } finally {
    s.cleanup();
  }
});

test('a konductor arm gets --require-mcp-startup', () => {
  const { kiroArgs } = require('../lib/run-one.js');
  const args = kiroArgs({ arm: { agent: 'konductor', vanilla: false }, task: { prompt: 'p' }, config: CONFIG });
  assert.ok(args.includes('--require-mcp-startup'));
  assert.ok(args.includes('--agent'));
  assert.equal(args.at(-1), 'p');
});

test('an answer key in the working directory is an infra error and the agent never starts', async () => {
  const s = setup({});
  const original = sandbox.copyFixture;
  sandbox.copyFixture = (src, dest) => fs.cpSync(src, dest, { recursive: true });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /answer key present/);
    assert.equal(r.creditsCensored, false);
    assert.equal(fs.existsSync(path.join(s.probe, 'started.json')), false);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
  } finally {
    sandbox.copyFixture = original;
    s.cleanup();
  }
});

test('a scratch directory that cannot be created gives an error result instead of rejecting', async () => {
  const s = setup({});
  s.ctx.scratchDir = path.join(s.root, 'does', 'not', 'exist');
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /cannot create run directories/);
    assert.equal(r.credits, null);
  } finally {
    s.cleanup();
  }
});

test('post-processing that throws keeps the finished run credits and marks an infra error', async () => {
  const s = setup({ credits: 0.75 });
  s.ctx.tripwire.roots = [{ dir: s.watch, depth: 2, exclude: 5 }];
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.credits, 0.75);
    assert.equal(r.exitCode, 0);
    assert.equal(r.runFinishedStatus, 'success');
    assert.match(r.infraError, /post-processing failed/);
    assert.equal(r.status, 'error');
    assert.equal(r.creditsCensored, false);
  } finally {
    s.cleanup();
  }
});

test('a socket left in the workspace is skipped by the snapshot and the checks still run', async () => {
  const s = setup({ makeSocket: true, credits: 0.75 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.credits, 0.75);
    assert.equal(r.infraError, null);
    assert.equal(r.status, 'success');
    assert.ok(r.checks.length > 0);
    assert.equal(r.flags.includes('snapshotFailed'), false);
    assert.equal(fs.existsSync(path.join(s.outDir, 'workspace', 'out.txt')), true);
    assert.equal(fs.existsSync(path.join(s.outDir, 'workspace', 'sock')), false);
  } finally {
    s.cleanup();
  }
});

test('a snapshot failure sets a flag and does not skip the checks', async () => {
  const s = setup({ credits: 0.75 });
  fs.mkdirSync(s.outDir, { recursive: true });
  fs.writeFileSync(path.join(s.outDir, 'workspace'), 'a file where the snapshot directory must go');
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.ok(r.flags.includes('snapshotFailed'));
    assert.ok(r.checks.length > 0);
    assert.equal(r.infraError, null);
  } finally {
    s.cleanup();
  }
});

test('a timed-out run is credit-censored and has no turn duration', async () => {
  const s = setup({ sleepSec: 30 });
  s.task.timeoutSec = 1;
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'timeout');
    assert.equal(r.creditsCensored, true);
    assert.equal(r.creditsLowerBound, 0);
    assert.equal(r.turnDurationMs, null);
    const pid = JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8')).pid;
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    s.cleanup();
  }
});

test('the tripwire flags a write into a watched directory during the run', async () => {
  const s = setup({});
  s.task.timeoutSec = 30;
  const writer = setInterval(() => fs.writeFileSync(path.join(s.watch, `hit-${Date.now()}`), 'x'), 10);
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.ok(r.homeTripwireHits.length > 0);
    assert.ok(r.flags.includes('homeTripwire'));
  } finally {
    clearInterval(writer);
    s.cleanup();
  }
});

test('os.tmpdir based scratch roots use a neutral prefix', () => {
  const dir = sandbox.makeScratchRoot();
  try {
    assert.match(path.basename(dir), /^w-[A-Za-z0-9]+$/);
    assert.equal(/konductor|bench/i.test(dir), false);
    assert.ok(dir.startsWith(os.tmpdir()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
