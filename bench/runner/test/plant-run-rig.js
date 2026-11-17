// SPDX-License-Identifier: Apache-2.0
'use strict';

// One plant trial for runner tests: a signed stub release, its suite preflight, and executeRun with a fake or control
// Kiro CLI against a real gateway, unisolated (--isolate none). Test data only.

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

module.exports = { rig, suiteOf, plantRun, readJsonl, FAST, LOSS_FAST, CONFIG };
