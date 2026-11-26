// SPDX-License-Identifier: Apache-2.0
'use strict';

// One plant trial for runner tests: a signed stub release, its suite preflight, and executeRun with a fake or control
// agent (Kiro CLI, Claude Code, or Strands on the scripted model) against a real gateway, unisolated (--isolate none).
// Test data only.

const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakePlantKiro } = require('./fake-plant-kiro.js');
const { writeRelease, TASK_ID } = require('./plant-release-fixture.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { resolveArm } = require('../lib/arms.js');
const { preparePlantSuite } = require('../lib/plant/intake.js');
const { DEADLINES } = require('../lib/plant/gateway-proc.js');
const { HARNESSES } = require('../lib/harness/index.js');
const cc = HARNESSES['claude-code'];
const strands = HARNESSES.strands;

// Generous on purpose: a test about a limit, a launch failure or a foreign connection must not turn into a gateway that
// never got ready or lost its heartbeat because the host was busy (the full suite runs many gateways at once). A test
// about heartbeat loss sets its own short heartbeatLossMs (LOSS_FAST).
const FAST = { ...DEADLINES, readyMs: 60000, heartbeatLossMs: 30000, finalMs: 5000 };
const LOSS_FAST = { ...FAST, heartbeatLossMs: 2500 };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

function chmodTree(dir) {
  try { fs.chmodSync(dir, 0o700); } catch { return; }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) chmodTree(path.join(dir, e.name));
}

/** A run root with a bench dir, a signed stub release, its tasks loaded, and dirs for scratch, out and repo. */
function rig(releaseOpts = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const release = writeRelease(path.join(root, 'release'), releaseOpts);
  const dirs = Object.fromEntries(['scratch', 'out', 'repo', 'probe', 'home'].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d);
  const tasks = loadTasks(bench, { extraDirs: [path.join(release.dir, 'tasks')] });
  const suites = [];
  const cleanup = () => {
    for (const s of suites) s.dispose();
    chmodTree(root);
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, bench, release, tasks, suites, ...dirs, cleanup };
}

/**
 * The suite preflight for rig `r` on task `taskId`. `opts` and `more` replace flags and arguments. The host listener
 * check reads no listeners unless `more.readListeners` gives some: under the full suite other test files open loopback
 * ports between this rig's trials, which would stop the suite with a PlantSuiteStop that has nothing to do with the test.
 */
function suiteOf(r, { opts = {}, taskId = TASK_ID, ...more } = {}) {
  const suite = preparePlantSuite({
    opts: { 'plant-release': r.release.dir, 'plant-release-sha256': r.release.sha256, 'kiro-bin': path.join(r.root, 'bin', 'kiro-cli'), ...opts },
    arms: [resolveArm('plant-policy', r.repo)], tasks: [r.tasks.get(taskId)], parallel: 1, outDir: r.out,
    ctx: { scratchDir: r.scratch, config: CONFIG, isolation: { mode: 'none' } }, repo: r.repo, keys: r.release.keys, home: r.home, deadlines: FAST, readListeners: () => [], ...more,
  });
  r.suites.push(suite);
  return suite;
}

/**
 * One plant trial of `arm` on task `taskId`: with a fake Kiro CLI configured by `fake`, or with the executable `kiroBin`
 * when given (then `fake` is unused). `envKeep` names env variables passed to the agent; `suiteMore` reaches preparePlantSuite;
 * `engine` is the agent engine the trial runs on.
 */
async function plantRun(r, fake, { arm = 'plant-policy', suiteMore = {}, kiroBin = null, taskId = TASK_ID, envKeep = [], engine = CONFIG.agentEngine } = {}) {
  const bin = kiroBin ?? makeFakePlantKiro(path.join(r.root, 'bin'), { dir: r.probe, ...fake });
  const authDb = path.join(r.root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const suite = suiteOf(r, { taskId, ...suiteMore });
  const ctx = {
    config: { ...CONFIG, agentEngine: engine }, scratchDir: r.scratch, authDb, envKeep, envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null }, kiroBin: bin,
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
  };
  const outDir = path.join(r.out, arm, taskId, '1');
  const args = { arm: resolveArm(arm, r.repo), task: r.tasks.get(taskId), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 };
  return { args, suite, outDir, run: () => executeRun(args) };
}

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const CC_CONFIG = { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5', effort: 'high' };
// Fake keys: a Claude Code run takes its credentials from the environment, and the fakes never use them.
const CC_CREDS = { AWS_ACCESS_KEY_ID: 'AKIAFAKEPLANT0000000', AWS_SECRET_ACCESS_KEY: 'fake-plant-secret-0000000000', AWS_SESSION_TOKEN: 'fake-plant-token-000000000000' };

/**
 * One Claude Code plant trial of `arm` (a `cc-plant-*` id) on task `taskId` with the claude binary `claudeBin` (a fake
 * Claude Code or a plant control): its suite preflight and executeRun, with fake keys in the environment for the run.
 * Returns `{result, outDir}`.
 */
async function claudePlantRun(r, claudeBin, { arm = 'cc-plant-policy', taskId = TASK_ID } = {}) {
  const claude = cc.resolveClaude({ binOverride: claudeBin });
  const a = resolveArm(arm, r.repo);
  const suite = suiteOf(r, { taskId, opts: { 'kiro-bin': undefined }, arms: [a], ctx: { scratchDir: r.scratch, config: CC_CONFIG, isolation: { mode: 'none' }, claude } });
  const ctx = {
    config: CC_CONFIG, scratchDir: r.scratch, claude, claudeTmpBases: [r.scratch], envKeep: [], runBudgetUsd: 0.5,
    envInfo: { kiroCliVersion: null, harnessVersion: claude.version, modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
  };
  const outDir = path.join(r.out, arm, taskId, '1');
  const saved = Object.fromEntries(Object.keys(CC_CREDS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, CC_CREDS);
  try {
    return { outDir, result: await executeRun({ arm: a, task: r.tasks.get(taskId), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 }) };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/**
 * One Strands plant trial of `arm` (an `st-plant-*` id) on task `taskId`: `python` has strands-agents, `script` is the
 * fake model's turns file, `agentFile` an agent file or null for a plain Agent. Its out dir is under `outName`.
 * `plantPython` runs the gateway (an arm task needs one with mujoco; default python3).
 * Returns `{result, gateway, suite, ctx, outDir}`.
 */
async function strandsPlantRun(r, { python, script, agentFile = null, arm = 'st-plant-policy', taskId = TASK_ID, outName = 'plain', plantPython = null }) {
  const config = { ...CONFIG, model: `fake:${script}`, effort: 'default' };
  const opts = plantPython ? { 'plant-python': plantPython } : {};
  const suite = suiteOf(r, { taskId, opts, arms: [resolveArm(arm, r.repo)], ctx: { scratchDir: r.scratch, config, isolation: { mode: 'none' } } });
  const ctx = {
    config, scratchDir: r.scratch, envKeep: [], envInfo: { kiroCliVersion: null, harnessVersion: 'test', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
    strands: strands.resolveStrands({ python, agentFile }),
  };
  const outDir = path.join(r.out, arm, outName, taskId);
  const result = await executeRun({ arm: resolveArm(arm, r.repo), task: r.tasks.get(taskId), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 });
  return { result, gateway: readJsonl(path.join(outDir, 'plant', 'gateway.jsonl')), suite, ctx, outDir };
}

module.exports = { rig, suiteOf, plantRun, claudePlantRun, strandsPlantRun, readJsonl, FAST, LOSS_FAST, CONFIG, CC_CONFIG };
