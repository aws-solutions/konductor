// SPDX-License-Identifier: Apache-2.0
'use strict';

// The public toy release (DEBT D-82, bench/physical/toy): rebuilt from public text, signed with the toy key the runner
// pins with status "toy", run in control suites only and never in a counted or real-agent suite, and labelled TOY in
// the plant report. The whole-trial case needs a Python with cedarpy (BENCH_ARM_PYTHON or <repo>/.venv) and skips
// without one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeToyRelease, toyPublicKeyB64, RELEASE_ID, TASKS } = require('../../physical/toy/toy-release.js');
const { PINNED_KEYS, keyIdOf, checkManifest, ReleaseRefused } = require('../lib/plant/manifest.js');
const { preparePlantSuite } = require('../lib/plant/intake.js');
const { resolveArm } = require('../lib/arms.js');
const { loadTasks } = require('../lib/tasks.js');
const { makeBench } = require('./helpers.js');
const { executeRun } = require('../lib/run-one.js');
const { HARNESSES } = require('../lib/harness/index.js');
const cc = HARNESSES['claude-code'];
const { cmdPlantReport } = require('../../report/plant.js');
const { policyTestCommand } = require('../lib/plant/policy-test.js');
const { CC_CONFIG } = require('./plant-run-rig.js');

const { PYTHON, HAS_CEDAR, arm } = require('./arm-python.js');
const { mkScratch } = require('./scratch.js');
const CONTROLS = path.join(__dirname, '..', '..', 'physical', 'controls');

/** A toy release and the dirs a suite needs, all under one temp root; `cleanup` removes them. */
function toyRig() {
  const root = mkScratch('toy-rel-');
  const toy = makeToyRelease(root);
  const dirs = Object.fromEntries(['scratch', 'out', 'repo', 'home', 'probe'].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d);
  const tasks = loadTasks(makeBench(path.join(root, 'bench')), { extraDirs: [path.join(toy.dir, 'tasks')] });
  const suites = [];
  const cleanup = () => {
    for (const s of suites) s.dispose();
    spawnSync('chmod', ['-R', 'u+rwX', root]);
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, toy, tasks, suites, ...dirs, cleanup };
}

/** The suite preflight of `armSpec` on toy task `taskId`; `ctx` and `opts` add to the defaults. */
function toySuite(r, { armSpec = 'cc-plant-policy', taskId = TASKS[0].id, ctx = {}, opts = {} } = {}) {
  const suite = preparePlantSuite({
    opts: { 'plant-release': r.toy.dir, 'plant-release-sha256': r.toy.sha256, ...opts }, arms: [resolveArm(armSpec, r.repo)], tasks: [r.tasks.get(taskId)],
    parallel: 1, outDir: r.out, ctx: { scratchDir: r.scratch, config: CC_CONFIG, isolation: { mode: 'none' }, ...ctx }, repo: r.repo, home: r.home, readListeners: () => [],
  });
  r.suites.push(suite);
  return suite;
}

test('a toy release dir under HOME is refused at once, not later by the runner (D-191)', () => {
  const home = mkScratch('toy-home-');
  const saved = process.env.HOME;
  try {
    process.env.HOME = home;
    assert.throws(() => makeToyRelease(path.join(home, 'work')), /under HOME .*the runner refuses plant paths there/);
    assert.equal(fs.existsSync(path.join(home, 'work')), false);
  } finally { process.env.HOME = saved; }
});

test('the toy key is rebuilt from public text and pinned in the runner with status toy, beside the real key', () => {
  const pinned = PINNED_KEYS.find((k) => k.publicKey === toyPublicKeyB64());
  assert.ok(pinned, 'the toy key is pinned');
  assert.equal(pinned.status, 'toy');
  assert.ok(PINNED_KEYS.some((k) => k.status === 'active'), 'the real key stays pinned');
});

test('the toy release verifies against the runner\'s own pinned keys and says it is a toy', () => {
  const r = toyRig();
  try {
    const bytes = fs.readFileSync(path.join(r.toy.dir, 'manifest.json'));
    const checked = checkManifest({ manifestBytes: bytes, signatureText: fs.readFileSync(path.join(r.toy.dir, 'manifest.json.sig'), 'utf8'), expectedSha256: r.toy.sha256 });
    assert.equal(checked.manifest.release, RELEASE_ID);
    assert.equal(checked.keyId, keyIdOf(toyPublicKeyB64()));
    assert.equal(checked.keyStatus, 'toy');
    assert.equal(TASKS.filter((t) => t.environment.probe).length, 2);
  } finally { r.cleanup(); }
});

test('a toy release runs a control suite and is refused for any suite that is not a control', () => {
  const r = toyRig();
  try {
    const control = toySuite(r, { ctx: { claude: cc.resolveClaude({ binOverride: path.join(CONTROLS, 'do-nothing-claude') }) } });
    assert.equal(control.control, true);
    assert.equal(control.toy, true);
    // A real Kiro CLI suite (no --kiro-bin) would be counted: refused before any check of the binary.
    assert.throws(() => toySuite(r, { armSpec: 'plant-policy', ctx: { config: { model: 'm', effort: 'high', agentEngine: 'v2' } } }),
      (e) => e instanceof ReleaseRefused && /toy release plant-toy-v1 runs control suites only/.test(e.message));
  } finally { r.cleanup(); }
});

test('every cell of the toy truth table passes plant-policy-test', { skip: !HAS_CEDAR && 'no Python with cedarpy (set BENCH_ARM_PYTHON)' }, () => {
  const r = toyRig();
  try {
    const { file, args } = policyTestCommand({ release: r.toy.dir, python: PYTHON });
    const run = spawnSync(file, args, { encoding: 'utf8', env: { PATH: process.env.PATH, ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}) } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /11 of 11 cells pass/);
  } finally { r.cleanup(); }
});

test('the toy walkthrough trial: a Claude Code control on the toy release completes, and the plant report says TOY', { skip: !HAS_CEDAR && 'no Python with cedarpy (set BENCH_ARM_PYTHON)' }, async () => {
  const r = toyRig();
  try {
    const claude = cc.resolveClaude({ binOverride: path.join(CONTROLS, 'careful-operator-claude') });
    const task = r.tasks.get('toy-guard-access.v01');
    const suite = toySuite(r, { taskId: task.id, ctx: { claude }, opts: { 'plant-python': PYTHON } });
    const ctx = {
      config: CC_CONFIG, scratchDir: r.scratch, claude, claudeTmpBases: [r.scratch], envKeep: [], runBudgetUsd: 0.5,
      envInfo: { kiroCliVersion: null, harnessVersion: claude.version, modelListSnapshotPath: null, region: 'us-east-1' },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
    };
    const outDir = path.join(r.out, 'cc-plant-policy', task.id, '1');
    const result = await executeRun({ arm: resolveArm('cc-plant-policy', r.repo), task, replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 });
    assert.equal(result.plant.runState, 'complete', result.error);
    assert.equal(result.plant.counts.mismatches, 0);
    assert.deepEqual(result.plant.flags, []);
    assert.equal(result.plant.taskSuccess, true);
    fs.writeFileSync(path.join(r.out, 'run-config.json'), JSON.stringify({ plant: { control: false, counted: false, cgroup: 'not checked' } }));
    const reportDir = path.join(r.root, 'report');
    const [log, err] = [console.log, console.error];
    console.log = console.error = () => {};
    try { cmdPlantReport({ run: r.out, release: r.toy.dir, out: reportDir }); } finally { [console.log, console.error] = [log, err]; process.exitCode = undefined; }
    const md = fs.readFileSync(path.join(reportDir, 'plant-report.md'), 'utf8');
    assert.match(md, /TOY release: signed with the public toy key; its numbers mean nothing about any agent/);
  } finally { r.cleanup(); }
});

test('the toy arm release: toy key, arm tasks and probes, and every policy cell passes', arm, () => {
  const { makeToyArmRelease, ARM_RELEASE_ID, ARM_TASKS } = require('../../physical/toy/toy-release.js');
  const root = mkScratch('toy-arm-');
  try {
    const toy = makeToyArmRelease(root, PYTHON);
    const bytes = fs.readFileSync(path.join(toy.dir, 'manifest.json'));
    const checked = checkManifest({ manifestBytes: bytes, signatureText: fs.readFileSync(path.join(toy.dir, 'manifest.json.sig'), 'utf8'), expectedSha256: toy.sha256 });
    assert.deepEqual([checked.manifest.release, checked.keyStatus], [ARM_RELEASE_ID, 'toy']);
    assert.ok(ARM_TASKS.every((t) => t.environment.kind === 'arm-sim'));
    assert.equal(ARM_TASKS.filter((t) => t.environment.probe).length, 2);
    assert.ok(Object.values(checked.manifest.wheels).every((v) => v === '*'), 'the toy pins its wheels as installed, any version');
    const cmd = policyTestCommand({ release: toy.dir, python: PYTHON });
    const r = spawnSync(cmd.file, cmd.args, { encoding: 'utf8', env: { PATH: process.env.PATH, ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}) } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /(\d+) of \1 cells pass/);
  } finally {
    spawnSync('chmod', ['-R', 'u+rwX', root]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
