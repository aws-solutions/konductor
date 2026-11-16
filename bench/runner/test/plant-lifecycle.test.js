// SPDX-License-Identifier: Apache-2.0
'use strict';

// Step 6: the plant arms, release intake, suite preflight and one plant run end to end against a fake Kiro CLI and a
// real gateway, through bench's unisolated path (--isolate none). No credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakePlantKiro } = require('./fake-plant-kiro.js');
const { writeRelease, makeKey, TASK_ID } = require('./plant-release-fixture.js');
const { executeRun, kiroArgs } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { validateResult } = require('../lib/result.js');
const { resolveArm, parseArmSpec } = require('../lib/arms.js');
const { classifyPlantStartup } = require('../lib/launch-failure.js');
const { checkManifest, ReleaseRefused } = require('../lib/plant/manifest.js');
const { intakeRelease, preparePlantSuite } = require('../lib/plant/intake.js');
const { GatewayProcess, gatewayCommand, runningHashProblems, DEADLINES } = require('../lib/plant/gateway-proc.js');
const { runPlantCell, sandboxPidns, PlantSuiteStop } = require('../lib/plant/lifecycle.js');

const FAST = { ...DEADLINES, readyMs: 8000, heartbeatLossMs: 2500, finalMs: 5000 };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const unshareBlocked = spawnSync('unshare', ['--user', '--map-root-user', 'true']).status !== 0;

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

function chmodTree(dir) {
  try { fs.chmodSync(dir, 0o700); } catch { return; }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) chmodTree(path.join(dir, e.name));
}

/** The suite preflight for rig `r`. `opts` and `more` replace flags and arguments. */
function suiteOf(r, { opts = {}, ...more } = {}) {
  const suite = preparePlantSuite({
    opts: { 'plant-release': r.release.dir, 'plant-release-sha256': r.release.sha256, 'kiro-bin': path.join(r.root, 'bin', 'kiro-cli'), ...opts },
    arms: [resolveArm('plant-policy', r.repo)], tasks: [r.tasks.get(TASK_ID)], parallel: 1, outDir: r.out,
    ctx: { scratchDir: r.scratch, config: CONFIG, isolation: { mode: 'none' } }, repo: r.repo, keys: r.release.keys, home: r.home, deadlines: FAST, ...more,
  });
  r.suites.push(suite);
  return suite;
}

/** Runs one plant trial of `arm` with a fake Kiro CLI configured by `fake`; `suiteMore` reaches preparePlantSuite. */
async function plantRun(r, fake, { arm = 'plant-policy', suiteMore = {} } = {}) {
  const kiroBin = makeFakePlantKiro(path.join(r.root, 'bin'), { dir: r.probe, ...fake });
  const authDb = path.join(r.root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const suite = suiteOf(r, suiteMore);
  const ctx = {
    config: CONFIG, scratchDir: r.scratch, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null }, kiroBin,
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
  };
  const outDir = path.join(r.out, arm, TASK_ID, '1');
  const args = { arm: resolveArm(arm, r.repo), task: r.tasks.get(TASK_ID), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 };
  return { args, suite, outDir, run: () => executeRun(args) };
}

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const STOP_CALLS = [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {} }];

// ---- arms ----

test('plant-policy and plant-allowall parse as plant arms and resolve to kiro-cli with the plant agent and nothing installed', () => {
  assert.deepEqual(parseArmSpec('plant-allowall'), { kind: 'plant', name: 'plant-allowall', plantArm: 'allow-all' });
  const arm = resolveArm('plant-policy', '.');
  assert.equal(arm.runtime, 'kiro-cli');
  assert.equal(arm.agent, 'plant');
  assert.equal(arm.vanilla, true);
  assert.deepEqual(arm.plant, { arm: 'policy' });
});

test('a plant arm under the oc- or cc- prefix is refused: plant arms run on kiro-cli only', () => {
  for (const spec of ['oc-plant-policy', 'cc-plant-allowall']) {
    assert.throws(() => parseArmSpec(spec), /plant arms run on kiro-cli only/);
    assert.throws(() => resolveArm(spec, '.'), /plant arms run on kiro-cli only/);
  }
});

test('the plant arm names are reserved and cannot name a git ref', () => {
  assert.throws(() => parseArmSpec('plant-policy=main'), /reserved/);
});

test('a plant arm runs Kiro CLI with --agent plant and --require-mcp-startup', () => {
  const args = kiroArgs({ arm: resolveArm('plant-policy', '.'), task: { prompt: 'p' }, config: CONFIG });
  assert.equal(args[args.indexOf('--agent') + 1], 'plant');
  assert.ok(args.includes('--require-mcp-startup'));
});

test('exit 3 with no turn is a plantStartup launch failure; another exit or a started turn is not', () => {
  assert.match(classifyPlantStartup({ agg: null, exec: { exitCode: 3, timedOut: false } }), /plantStartup/);
  assert.equal(classifyPlantStartup({ agg: null, exec: { exitCode: 1, timedOut: false } }), null);
  assert.equal(classifyPlantStartup({ agg: { runFinishedStatus: 'success' }, exec: { exitCode: 3, timedOut: false } }), null);
});

// ---- manifest and intake ----

test('a manifest signed by a pinned key is accepted and names its release and key', () => {
  const r = rig();
  try {
    const bytes = fs.readFileSync(path.join(r.release.dir, 'manifest.json'));
    const sig = fs.readFileSync(path.join(r.release.dir, 'manifest.json.sig'), 'utf8');
    const ok = checkManifest({ manifestBytes: bytes, signatureText: sig, expectedSha256: r.release.sha256, keys: r.release.keys });
    assert.equal(ok.manifest.release, 'plant-test');
    assert.equal(ok.keyId, r.release.key.keyId);
  } finally { r.cleanup(); }
});

test('a manifest is refused for a wrong expected hash, a changed byte, an unpinned key or a revoked key', () => {
  const r = rig();
  try {
    const bytes = fs.readFileSync(path.join(r.release.dir, 'manifest.json'));
    const sig = fs.readFileSync(path.join(r.release.dir, 'manifest.json.sig'), 'utf8');
    const check = (over) => () => checkManifest({ manifestBytes: bytes, signatureText: sig, expectedSha256: r.release.sha256, keys: r.release.keys, ...over });
    assert.throws(check({ expectedSha256: '0'.repeat(64) }), /not the expected/);
    const changed = Buffer.from(bytes.toString().replace('plant-test', 'plant-tesu'));
    assert.throws(check({ manifestBytes: changed, expectedSha256: crypto.createHash('sha256').update(changed).digest('hex') }), /signature does not verify/);
    assert.throws(check({ keys: [makeKey().pinned] }), /not pinned/);
    assert.throws(check({ keys: [{ ...r.release.key.pinned, status: 'revoked' }] }), /revoked/);
  } finally { r.cleanup(); }
});

test('a manifest with a path that leaves the release or a maxParallel above 1 is refused', () => {
  for (const [manifest, why] of [[{ files: [{ path: '../x', sha256: '0'.repeat(64) }] }, /plain relative path/], [{ maxParallel: 2 }, /maxParallel/]]) {
    const r = rig({ manifest });
    try {
      assert.throws(() => intakeRelease({ dir: r.release.dir, expectedSha256: r.release.sha256, privateRoot: r.scratch, keys: r.release.keys }), why);
    } finally { r.cleanup(); }
  }
});

test('intake refuses a symlink, a hard link, a fifo, an unlisted file and a file whose hash changed', () => {
  const cases = [
    [(dir) => fs.symlinkSync('/etc/hostname', path.join(dir, 'link')), /link is a symlink/],
    [(dir) => fs.linkSync(path.join(dir, 'refusal-rule.json'), path.join(dir, 'hard')), /a hard link/],
    [(dir) => spawnSync('mkfifo', [path.join(dir, 'pipe')]), /not a regular file/],
    [(dir) => fs.writeFileSync(path.join(dir, 'extra.txt'), 'x'), /does not list: extra.txt/],
    [(dir) => fs.appendFileSync(path.join(dir, 'refusal-rule.json'), ' '), /refusal-rule.json does not match/],
  ];
  for (const [spoil, why] of cases) {
    const r = rig();
    try {
      spoil(r.release.dir);
      assert.throws(() => intakeRelease({ dir: r.release.dir, expectedSha256: r.release.sha256, privateRoot: r.scratch, keys: r.release.keys }), why);
      assert.deepEqual(fs.readdirSync(r.scratch), [], 'a refused intake leaves no copy');
    } finally { r.cleanup(); }
  }
});

test('intake works on a read-only copy, and a later change to the original does not reach it', () => {
  const r = rig();
  try {
    const rel = intakeRelease({ dir: r.release.dir, expectedSha256: r.release.sha256, privateRoot: r.scratch, keys: r.release.keys });
    fs.writeFileSync(path.join(r.release.dir, 'refusal-rule.json'), 'changed');
    assert.notEqual(fs.readFileSync(rel.fileOf('refusal-rule.json'), 'utf8'), 'changed');
    assert.equal(fs.statSync(rel.fileOf('refusal-rule.json')).mode & 0o777, 0o400);
    assert.equal(fs.statSync(rel.root).mode & 0o777, 0o500);
  } finally { r.cleanup(); }
});

// ---- suite preflight ----

test('a plant suite is refused above --parallel 1, with a non-plant arm, or on agent engine v3', () => {
  const r = rig();
  try {
    assert.throws(() => suiteOf(r, { parallel: 2 }), /one trial at a time/);
    assert.throws(() => suiteOf(r, { arms: [resolveArm('plant-policy', r.repo), resolveArm('vanilla', r.repo)] }), /plant arms only/);
    assert.throws(() => suiteOf(r, { ctx: { scratchDir: r.scratch, config: { ...CONFIG, agentEngine: 'v3' }, isolation: { mode: 'none' } } }), /engine v2/);
  } finally { r.cleanup(); }
});

test('a plant suite is refused when the out dir or the release lies inside scratch, home or the repo', () => {
  const r = rig();
  try {
    const inScratch = path.join(r.scratch, 'out');
    fs.mkdirSync(inScratch);
    assert.throws(() => suiteOf(r, { outDir: inScratch }), /out dir .* lies inside scratch/);
    assert.throws(() => suiteOf(r, { home: r.root }), /plant release .* lies inside home/);
    assert.throws(() => suiteOf(r, { repo: r.root }), /lies inside repo/);
  } finally { r.cleanup(); }
});

test('a counted plant suite needs the pinned Kiro CLI, the Cedar files and an out dir on its own filesystem', () => {
  const r = rig();
  try {
    const kiroBin = makeFakePlantKiro(path.join(r.root, 'bin'), { dir: r.probe });
    const counted = (rr, versionOfBin = () => 'kiro-cli 9.9.9') => () => preparePlantSuite({
      opts: { 'plant-release': rr.release.dir, 'plant-release-sha256': rr.release.sha256 }, arms: [resolveArm('plant-policy', rr.repo)], tasks: [rr.tasks.get(TASK_ID)],
      parallel: 1, outDir: rr.out, ctx: { scratchDir: rr.scratch, config: CONFIG, isolation: { mode: 'none' }, kiroBin }, repo: rr.repo, keys: rr.release.keys, home: rr.home, versionOfBin,
    });
    assert.throws(counted(r), /versions.kiroCli/);
    const pin = { kiroCli: { version: 'kiro-cli 9.9.9', sha256: crypto.createHash('sha256').update(fs.readFileSync(kiroBin)).digest('hex') } };
    const pinned = rig({ manifest: { versions: pin } });
    try {
      assert.throws(counted(pinned, () => 'kiro-cli 9.9.8'), /is not the pinned/);
      assert.throws(counted(pinned), /needs the Cedar files/);
    } finally { pinned.cleanup(); }
    const cedar = rig({ manifest: { versions: pin }, files: { 'policy/plant.cedar': 'stub', 'policy/plant.cedarschema': 'stub', 'sensor-limits.json': '{}' } });
    try {
      assert.throws(counted(cedar), /same filesystem as scratch/);
    } finally { cedar.cleanup(); }
  } finally { r.cleanup(); }
});

test('a plant task must be the release copy of itself, with a seed', () => {
  const r = rig({ manifest: { seeds: {} } });
  try {
    assert.throws(() => suiteOf(r), /no integer seed/);
  } finally { r.cleanup(); }
  const r2 = rig();
  try {
    r2.tasks.get(TASK_ID).extraDir = r2.bench;
    assert.throws(() => suiteOf(r2), /must be the release's tasks/);
  } finally { r2.cleanup(); }
});

test('the preflight points the task fixture at the release copy, and masks the runner-private dir', () => {
  const r = rig();
  try {
    const suite = suiteOf(r);
    assert.ok(r.tasks.get(TASK_ID).fixtureDir.startsWith(suite.release.root));
    assert.deepEqual(suite.mask, [suite.privateRoot]);
    assert.equal(suite.counted, false);
    assert.equal(suite.comparable, false);
    suite.dispose();
    assert.equal(fs.existsSync(suite.privateRoot), false);
  } finally { r.cleanup(); }
});

// ---- gateway process ----

test('the gateway starts under sh with core dumps off and a PATH-only env, and the token is in neither', () => {
  const cmd = gatewayCommand('python3');
  assert.match(cmd.args[1], /ulimit -c 0/);
  assert.deepEqual(Object.keys(cmd.env), ['PATH']);
  const token = 'f'.repeat(64);
  const gw = new GatewayProcess({ python: 'python3', stdoutPath: '/dev/null', stderrPath: '/dev/null', makeToken: () => token });
  assert.ok(!JSON.stringify(gatewayCommand(gw.python)).includes(token));
});

test('a shim that connects before peer is held unanswered, then served once peer arrives', async () => {
  const r = rig();
  try {
    const suite = suiteOf(r);
    const logDir = path.join(r.out, 'plant');
    fs.mkdirSync(logDir);
    const socket = path.join(suite.socketParent, 'gw.sock');
    const gw = new GatewayProcess({ python: 'python3', stdoutPath: path.join(logDir, 'o'), stderrPath: path.join(logDir, 'e'), deadlines: FAST });
    const taskFile = suite.tasks.fileOf(TASK_ID);
    await gw.start({ release: 'plant-test', files: { [taskFile]: suite.release.sha256Of(`tasks/${TASK_ID}.json`) }, task: taskFile, arm: 'policy', seed: 1, socket, logDir, testMode: false });
    const conn = net.createConnection(socket);
    const replies = [];
    conn.on('data', (d) => replies.push(...d.toString().split('\n').filter(Boolean)));
    conn.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(replies.length, 0, 'held until peer');
    gw.peer(fs.readlinkSync('/proc/self/ns/pid'));
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(JSON.parse(replies[0]).id, 0);
    conn.destroy();
    assert.ok((await gw.stop()).lastSeq >= 0);
  } finally { r.cleanup(); }
});

test('the running-hash check finds an earlier log line rewritten after its heartbeat', () => {
  const lines = ['{"seq":0}\n', '{"seq":1}\n'];
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const hb = { n: 1, lastSeq: 0, logSha256: { gateway: sha(lines[0]), world: sha('') } };
  const final = { lastSeq: 1, lines: { gateway: 2, world: 0 }, logSha256: { gateway: sha(lines.join('')), world: sha('') } };
  assert.deepEqual(runningHashProblems({ heartbeats: [hb], final, gatewayText: lines.join(''), worldText: '' }), []);
  const rewritten = `{"seq":9}\n${lines[1]}`;
  const problems = runningHashProblems({ heartbeats: [hb], final, gatewayText: rewritten, worldText: '' });
  assert.ok(problems.some((p) => /hb 1: gateway.jsonl up to seq 0/.test(p)));
  assert.ok(problems.some((p) => /final running hash/.test(p)));
});

// ---- one run, end to end ----

test('a plant run starts the gateway, serves the agent, settles, checks the logs and writes the plant field', async () => {
  const r = rig();
  try {
    const { run, suite, outDir } = await plantRun(r, { calls: STOP_CALLS });
    const result = await run();
    assert.deepEqual(validateResult(result), []);
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.plant.runState, 'complete');
    assert.equal(result.plant.arm, 'policy');
    assert.equal(result.plant.release, 'plant-test');
    assert.equal(result.plant.manifestSha256, r.release.sha256);
    assert.deepEqual(result.plant.flags, []);
    assert.equal(result.plant.gateway.runningHashOk, true);
    assert.equal(result.plant.gateway.pathOk, true);
    assert.equal(result.plant.counts.calls, 2);
    assert.equal(result.plant.taskSuccess, true);
    const glog = readJsonl(path.join(outDir, 'plant', 'gateway.jsonl'));
    assert.ok(glog.some((l) => l.type === 'settle'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'installed-agent.json'), 'utf8')).name, 'plant');
    assert.deepEqual(fs.readdirSync(suite.socketParent), [], 'the socket root is removed');
    const started = JSON.parse(fs.readFileSync(path.join(r.probe, 'started.json'), 'utf8'));
    assert.ok(started.args.includes('--require-mcp-startup'));
  } finally { r.cleanup(); }
});

test('the run token never appears in any argv, env, file or log the host can see', async () => {
  const r = rig();
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const { run, suite, outDir } = await plantRun(r, { calls: STOP_CALLS, dump: true }, { suiteMore: { makeToken: () => token } });
    const result = await run();
    assert.equal(result.plant.runState, 'complete', 'the gateway accepted the token on fd 3');
    const dump = JSON.parse(fs.readFileSync(path.join(r.probe, 'dump.json'), 'utf8'));
    assert.ok(dump.procs.length >= 1, 'the gateway process was found and searched');
    assert.ok(Object.keys(dump.files).some((f) => f.endsWith('plant.json')), 'the run root was searched');
    const seen = [JSON.stringify(dump)];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else seen.push(fs.readFileSync(p, 'latin1')); } };
    walk(r.out);
    walk(r.probe);
    assert.ok(seen.length > 5);
    for (const text of seen) assert.ok(!text.includes(token), 'token leaked');
    assert.ok(fs.existsSync(path.join(outDir, 'plant', 'gateway.stderr')));
  } finally { r.cleanup(); }
});

test('a stream call the gateway never saw is a mismatch: plantPathLost, infra-incomplete, status error', async () => {
  const r = rig();
  try {
    const { run, suite } = await plantRun(r, { calls: [...STOP_CALLS, { tool: 'open_guard', args: {}, inGateway: false }] });
    const result = await run();
    assert.equal(result.plant.runState, 'infra_incomplete');
    assert.ok(result.plant.flags.includes('plantPathLost'));
    assert.equal(result.plant.countedAsFailure, 'stream_mismatch');
    assert.equal(result.status, 'error');
    assert.match(result.infraError, /plant infra_incomplete/);
  } finally { r.cleanup(); }
});

test('a gateway that stops heartbeating mid-run is lost: the agent is killed, the trial is a failure and never safe', async () => {
  const r = rig();
  try {
    const { run, suite } = await plantRun(r, { stopGateway: true });
    const started = Date.now();
    const result = await run();
    assert.ok(Date.now() - started < 20000, 'the agent was stopped, not left to its timeout');
    assert.ok(result.plant.flags.includes('plantGatewayLost'));
    assert.equal(result.plant.countedAsFailure, 'gateway_lost');
    assert.equal(result.plant.safety, 'unsafe');
    assert.equal(result.status, 'error');
  } finally { r.cleanup(); }
});

test('Kiro CLI exit 3 is a plantStartup launch failure, rerun at most twice with earlier attempts kept', async () => {
  const r = rig();
  try {
    const { args, suite, outDir } = await plantRun(r, { exit3: true });
    const runs = [];
    const result = await runPlantCell(async (a) => { const res = await executeRun(a); runs.push(res); return res; }, args);
    assert.equal(runs.length, 3);
    assert.equal(result.plant.runState, 'launch_failure');
    assert.ok(result.plant.flags.includes('plantStartup'));
    assert.match(result.launchFailure, /plant launch failure/);
    assert.deepEqual(fs.readdirSync(path.join(outDir, 'launch-attempts')).sort(), ['1', '2']);
    assert.ok(fs.existsSync(path.join(outDir, 'launch-attempts', '1', 'result.json')));
  } finally { r.cleanup(); }
});

test('a gateway that never sends ready is plantGatewayStart and the agent is never started', async () => {
  const r = rig();
  try {
    const { run, suite } = await plantRun(r, { calls: STOP_CALLS }, { suiteMore: { opts: { 'plant-python': path.join(r.root, 'no-python') } } });
    const result = await run();
    assert.equal(result.plant.runState, 'launch_failure');
    assert.ok(result.plant.flags.includes('plantGatewayStart'));
    assert.equal(result.plant.gateway.ready, false);
    assert.equal(fs.existsSync(path.join(r.probe, 'started.json')), false);
  } finally { r.cleanup(); }
});

test('a new host listener between trials stops the plant suite before the next trial starts', async () => {
  let reads = 0;
  const ctx = { plant: { readListeners: () => (++reads > 2 ? ['tcp 0100007F:1F90'] : []) } };
  let ran = 0;
  const execute = async () => { ran++; return { plant: { runState: 'complete', flags: [] } }; };
  await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  await assert.rejects(runPlantCell(execute, { ctx, outDir: '/nonexistent' }), PlantSuiteStop);
  assert.equal(ran, 1);
});

test('a foreign connection stops the plant suite', async () => {
  const ctx = { plant: { readListeners: () => [] } };
  await assert.rejects(runPlantCell(async () => ({ plant: { runState: 'complete', flags: ['plantForeignConn'] } }), { ctx, outDir: '/x' }), /foreign connection/);
});

test('under unshare the peer is the pid namespace of the sandbox, not the runner', { skip: unshareBlocked && 'user namespaces are blocked on this host (unshare --user fails), so bench\'s sandbox cannot start' }, async () => {
  const child = spawn('unshare', ['--user', '--map-root-user', '--pid', '--fork', 'sleep', '5']);
  try {
    const pidns = await sandboxPidns(child.pid, 'unshare', 5000);
    assert.ok(pidns && pidns !== fs.readlinkSync('/proc/self/ns/pid'));
  } finally { child.kill('SIGKILL'); }
});

test('a refused release is a ReleaseRefused error', () => {
  const r = rig();
  try {
    assert.throws(() => suiteOf(r, { keys: [] }), ReleaseRefused);
  } finally { r.cleanup(); }
});
