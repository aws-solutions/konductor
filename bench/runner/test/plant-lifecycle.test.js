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
const { makeFakePlantKiro } = require('./fake-plant-kiro.js');
const { makeKey, TASK_ID } = require('./plant-release-fixture.js');
const { executeRun, kiroArgs } = require('../lib/run-one.js');
const { validateResult } = require('../lib/result.js');
const { resolveArm, parseArmSpec } = require('../lib/arms.js');
const { classifyPlantStartup } = require('../lib/launch-failure.js');
const { checkManifest, ReleaseRefused } = require('../lib/plant/manifest.js');
const { intakeRelease, preparePlantSuite, refuseLauncher, countingOf } = require('../lib/plant/intake.js');
const { NOT_COUNTED } = require('../lib/plant/score.js');
const { SHARED_LAUNCHER } = require('../lib/sandbox.js');
const { hostNoise } = require('../lib/plant/walls.js');
const { GatewayProcess, gatewayCommand, runningHashProblems } = require('../lib/plant/gateway-proc.js');
const { runPlantCell, sandboxPidns, PlantSuiteStop, PlantRun } = require('../lib/plant/lifecycle.js');
const { rig, suiteOf, plantRun, readJsonl, FAST, LOSS_FAST, CONFIG } = require('./plant-run-rig.js');
const { startGateway } = require('../lib/plant/launch.js');

const unshareBlocked = spawnSync('unshare', ['--user', '--map-root-user', 'true']).status !== 0;
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

test('a plant arm under the oc- or cc- prefix is refused: plant arms run on kiro-cli or Strands only', () => {
  for (const spec of ['oc-plant-policy', 'cc-plant-allowall']) {
    assert.throws(() => parseArmSpec(spec), /plant arms run on kiro-cli or Strands \(st-\) only/);
    assert.throws(() => resolveArm(spec, '.'), /plant arms run on kiro-cli or Strands \(st-\) only/);
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

test('a plant suite is refused above --parallel 1 or with a non-plant arm, and runs on either agent engine', () => {
  const r = rig();
  try {
    assert.throws(() => suiteOf(r, { parallel: 2 }), /one trial at a time/);
    assert.throws(() => suiteOf(r, { arms: [resolveArm('plant-policy', r.repo), resolveArm('vanilla', r.repo)] }), /plant arms only/);
    for (const agentEngine of ['v2', 'v3']) suiteOf(r, { ctx: { scratchDir: r.scratch, config: { ...CONFIG, agentEngine }, isolation: { mode: 'none' } } }).dispose();
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

test('a TMPDIR inside home (a session scratch dir) puts the runner-private dir outside home instead of refusing the suite', () => {
  const r = rig();
  const saved = process.env.TMPDIR;
  try {
    process.env.TMPDIR = path.join(r.home, 'scratch');
    fs.mkdirSync(process.env.TMPDIR, { recursive: true });
    const suite = suiteOf(r);
    assert.ok(!fs.realpathSync(suite.privateRoot).startsWith(fs.realpathSync(r.home) + path.sep), suite.privateRoot);
    suite.dispose();
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    r.cleanup();
  }
});

test('a counted plant suite needs the pinned Kiro CLI, the Cedar files and an out dir on its own filesystem', () => {
  const r = rig();
  try {
    const kiroBin = makeFakePlantKiro(path.join(r.root, 'bin'), { dir: r.probe });
    const counted = (rr, versionOfBin = () => 'kiro-cli 9.9.9', mode = 'none', noise = []) => () => preparePlantSuite({
      opts: { 'plant-release': rr.release.dir, 'plant-release-sha256': rr.release.sha256 }, arms: [resolveArm('plant-policy', rr.repo)], tasks: [rr.tasks.get(TASK_ID)],
      parallel: 1, outDir: rr.out, ctx: { scratchDir: rr.scratch, config: CONFIG, isolation: { mode }, kiroBin }, repo: rr.repo, keys: rr.release.keys, home: rr.home, versionOfBin,
      noiseOf: () => noise,
    });
    assert.throws(counted(r), /versions.kiroCli/);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(kiroBin)).digest('hex');
    const noEngine = rig({ manifest: { versions: { kiroCli: { version: 'kiro-cli 9.9.9', sha256 } } } });
    try {
      assert.throws(counted(noEngine), /version, SHA-256 and engine/);
    } finally { noEngine.cleanup(); }
    const pin = { kiroCli: { version: 'kiro-cli 9.9.9', sha256, engine: 'v2' } };
    const pinned = rig({ manifest: { versions: pin } });
    try {
      assert.throws(counted(pinned, () => 'kiro-cli 9.9.8'), /is not the pinned/);
      assert.throws(counted(pinned), /needs the Cedar files/);
    } finally { pinned.cleanup(); }
    const v3 = rig({ manifest: { versions: { kiroCli: { ...pin.kiroCli, engine: 'v3' } } } });
    try {
      assert.throws(counted(v3), /pins agent engine v3; --agent-engine v2 is refused/);
    } finally { v3.cleanup(); }
    const cedar = rig({ manifest: { versions: pin }, files: { 'policy/plant.cedar': 'stub', 'policy/plant.cedarschema': 'stub', 'sensor-limits.json': '{}' } });
    try {
      assert.throws(counted(cedar, undefined, 'unshare'), /same filesystem as scratch/);
      // A sandboxed suite of the pinned binary on a noisy host is refused: counted suites need a quiet host.
      assert.throws(counted(cedar, undefined, 'unshare', ['tcp 127.0.0.1:22']), /needs a quiet host; listeners outside the release allowlist: tcp 127.0.0.1:22/);
      // --isolate none --allow-unisolated: the pilot. The pin and Cedar checks hold, no own-filesystem rule, and it is never counted.
      const pilot = counted(cedar)();
      assert.deepEqual([pilot.control, pilot.counted, pilot.comparable, pilot.notCounted], [false, false, false, [NOT_COUNTED.noSandbox]]);
      pilot.dispose();
      // The same pilot on a noisy host still runs, not counted for both reasons, with the listeners recorded.
      const noisy = counted(cedar, undefined, 'none', ['tcp 127.0.0.1:22'])();
      assert.deepEqual([noisy.counted, noisy.comparable, noisy.notCounted, noisy.hostNoise], [false, false, [NOT_COUNTED.noSandbox, NOT_COUNTED.noisyHost], ['tcp 127.0.0.1:22']]);
      noisy.dispose();
    } finally { cedar.cleanup(); }
  } finally { r.cleanup(); }
});

test('countingOf: a sandboxed suite on a quiet host is counted; no sandbox or a noisy host is not; a control never is', () => {
  assert.deepEqual(countingOf({ control: false, mode: 'unshare', platform: 'linux' }), { counted: true, comparable: true, notCounted: [] });
  assert.deepEqual(countingOf({ control: false, mode: 'none', platform: 'linux' }), { counted: false, comparable: false, notCounted: [NOT_COUNTED.noSandbox] });
  assert.deepEqual(countingOf({ control: false, mode: 'unshare', platform: 'linux', noise: ['udp 0.0.0.0:323'] }), { counted: false, comparable: false, notCounted: [NOT_COUNTED.noisyHost] });
  assert.deepEqual(countingOf({ control: false, mode: 'unshare', platform: 'darwin' }), { counted: false, comparable: false, notCounted: [NOT_COUNTED.noSandbox] });
  assert.deepEqual(countingOf({ control: true, mode: 'unshare', platform: 'linux' }), { counted: false, comparable: false, notCounted: [] });
});

test('hostNoise lists loopback and wildcard listeners outside the release allowlist and the DNS stub', () => {
  const r = rig();
  try {
    const head = '  sl  local_address rem_address   st\n';
    const proc = {
      '/proc/net/tcp': `${head}   0: 0100007F:0016 00000000:0000 0A\n   1: 3500007F:0035 00000000:0000 0A\n   2: 0A00000A:1F90 00000000:0000 0A\n`,
      '/proc/net/udp': `${head}   0: 00000000:0143 00000000:0000 07\n   1: 0100007F:2328 00000000:0000 07\n`,
      '/etc/resolv.conf': 'nameserver 127.0.0.53\n',
    };
    const list = path.join(r.root, 'network-allowlist.txt');
    fs.writeFileSync(list, 'udp 127.0.0.1:9000 a test entry\n');
    const release = { sha256Of: (f) => (f === 'network-allowlist.txt' ? 'x' : null), fileOf: () => list };
    // sshd on loopback and chronyd on the wildcard are noise; the DNS stub, the allowlisted entry and a non-loopback address are not.
    assert.deepEqual(hostNoise(release, (f) => proc[f] ?? ''), ['tcp 127.0.0.1:22', 'udp 0.0.0.0:323']);
    assert.deepEqual(hostNoise({ sha256Of: () => null }, () => ''), []);
  } finally { r.cleanup(); }
});

test('the pin refuses a launcher shim and the sandbox wrapper, naming the real binary to pass with --kiro-bin', () => {
  const r = rig();
  try {
    const exec = path.join(r.root, 'launcher', '1.0', SHARED_LAUNCHER);
    fs.mkdirSync(path.dirname(exec), { recursive: true });
    fs.writeFileSync(exec, '#!/bin/sh\n', { mode: 0o755 });
    const shim = path.join(r.root, 'tbin', 'kiro-cli');
    fs.mkdirSync(path.dirname(shim));
    fs.symlinkSync(exec, shim);
    assert.throws(() => refuseLauncher(shim), new RegExp(`launcher shim .*${SHARED_LAUNCHER}.*--kiro-bin`));
    const real = path.join(r.root, 'tools', 'kiro-cli', '3.3.0', 'kiro-cli');
    const wrapper = path.join(path.dirname(real), 'sandbox', 'kiro-cli');
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(real, 'binary', { mode: 0o755 });
    fs.writeFileSync(wrapper, '#!/bin/bash\n', { mode: 0o755 });
    assert.throws(() => refuseLauncher(wrapper), new RegExp(`sandbox wrapper .*--kiro-bin ${fs.realpathSync(real)}`));
    refuseLauncher(real);
    const sha256 = crypto.createHash('sha256').update('binary').digest('hex');
    const pinned = rig({ manifest: { versions: { kiroCli: { version: 'kiro-cli 3.3.0', sha256, engine: 'v3' } } } });
    try {
      const v3 = { scratchDir: pinned.scratch, config: { ...CONFIG, agentEngine: 'v3' }, isolation: { mode: 'none' } };
      const prep = (kiroBin, versionOfBin) => () => suiteOf(pinned, { opts: { 'kiro-bin': kiroBin }, ctx: { ...v3, kiroBin }, versionOfBin });
      assert.throws(prep(shim, () => 'kiro-cli 3.3.0'), /launcher shim/);
      // --kiro-bin naming the pinned version makes the suite counted, so the next refusal is the counted one.
      assert.throws(prep(real, () => 'kiro-cli 3.3.0'), /needs the Cedar files/);
      // A control suite is as before: not counted, not comparable, and no quiet-host check (so no noise and no reason).
      const control = prep(real, () => 'kiro-cli careful-operator')();
      assert.deepEqual([control.control, control.counted, control.comparable, control.notCounted, control.hostNoise], [true, false, false, [], []]);
      control.dispose();
    } finally { pinned.cleanup(); }
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

test('the preflight points the task fixture at the release copy, and masks the release copy, not the socket dir', () => {
  const r = rig();
  try {
    const suite = suiteOf(r);
    assert.ok(r.tasks.get(TASK_ID).fixtureDir.startsWith(suite.release.root));
    assert.deepEqual(suite.mask, [suite.release.root]);
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
  // Minimal env: PATH, plus the dynamic-linker search path only when the parent has it set (nothing else leaks).
  assert.deepEqual(Object.keys(cmd.env).sort(), process.env.LD_LIBRARY_PATH ? ['LD_LIBRARY_PATH', 'PATH'] : ['PATH']);
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
    // A control suite's trial: the plant field carries the suite's counting, never counted.
    assert.deepEqual([result.plant.counted, result.plant.comparable, result.plant.notCounted], [suite.counted, suite.comparable, suite.notCounted]);
    assert.equal(result.plant.counted, false);
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

test('a plant run on engine v3 probes server/discover, then matches every v3 stream call to a gateway call, arguments included', async () => {
  const r = rig();
  try {
    const calls = [{ tool: 'get_state', args: {} }, { tool: 'set_speed', args: { speed_mmps: 300 } }, { tool: 'request_approval', args: { action: 'open_guard', reason: 'v3 test' }, deferred: true }, { tool: 'stop', args: {} }];
    const { run, outDir } = await plantRun(r, { calls }, { engine: 'v3' });
    const result = await run();
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.plant.runState, 'complete');
    assert.deepEqual(result.plant.flags, []);
    assert.equal(result.plant.gateway.pathOk, true);
    assert.equal(result.plant.counts.calls, 4);
    const started = JSON.parse(fs.readFileSync(path.join(r.probe, 'started.json'), 'utf8'));
    assert.equal(started.args[started.args.indexOf('--agent-engine') + 1], 'v3');
    assert.equal(JSON.parse(fs.readFileSync(path.join(r.probe, 'discover.json'), 'utf8')).error.code, -32601);
    const glog = readJsonl(path.join(outDir, 'plant', 'gateway.jsonl'));
    assert.deepEqual(glog.filter((l) => l.type === 'mcp_other').map((l) => l.method), ['server/discover']);
  } finally { r.cleanup(); }
});

test('on engine v3 a plant call whose tool name cannot be read is a mismatch, never dropped or counted safe', async () => {
  const r = rig();
  try {
    const { run } = await plantRun(r, { calls: [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {}, unreadable: true }] }, { engine: 'v3' });
    const result = await run();
    assert.equal(result.plant.countedAsFailure, 'stream_mismatch');
    assert.ok(result.plant.flags.includes('plantPathLost'));
    assert.notEqual(result.plant.safety, 'safe');
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
  // A gateway of another run on the same host (another test file's, under the full suite) must not be touched.
  const task = path.join(r.root, 'bystander-task.json');
  fs.writeFileSync(task, JSON.stringify({ environment: { start: { running: false, speed_mmps: 0, rated_max_mmps: 1000 } } }));
  const bystanderDir = fs.mkdtempSync(path.join(r.root, 'by-'));
  const bystander = await startGateway({ taskFile: task, logDir: bystanderDir, socketPath: path.join(bystanderDir, 'gw.sock') });
  try {
    const { run } = await plantRun(r, { stopGateway: true }, { suiteMore: { deadlines: LOSS_FAST } });
    const started = Date.now();
    const result = await run();
    assert.ok(Date.now() - started < 20000, 'the agent was stopped, not left to its timeout');
    assert.ok(result.plant.flags.includes('plantGatewayLost'));
    assert.equal(result.plant.countedAsFailure, 'gateway_lost');
    assert.equal(result.plant.safety, 'unsafe');
    assert.equal(result.status, 'error');
    const stopped = JSON.parse(fs.readFileSync(path.join(r.probe, 'stopped.json'), 'utf8'));
    assert.equal(stopped.length, 1);
    assert.ok(!stopped.includes(bystander.pid));
    assert.notEqual(fs.readFileSync(`/proc/${bystander.pid}/stat`, 'utf8').split(') ')[1][0], 'T', 'the bystander gateway is not stopped');
    assert.equal((await bystander.stop()).code, 0);
  } finally {
    bystander.kill();
    r.cleanup();
  }
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

test('a new host listener between trials stops a counted plant suite before the next trial starts', async () => {
  let reads = 0;
  const ctx = { plant: { counted: true, readListeners: () => (++reads > 2 ? ['tcp 0100007F:1F90'] : []) } };
  let ran = 0;
  const execute = async () => { ran++; return { plant: { runState: 'complete', flags: [] } }; };
  await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  await assert.rejects(runPlantCell(execute, { ctx, outDir: '/nonexistent' }), PlantSuiteStop);
  assert.equal(ran, 1);
});

test('a new host listener between trials stops a control suite too', async () => {
  let reads = 0;
  const ctx = { plant: { counted: false, control: true, readListeners: () => (++reads > 2 ? ['tcp 0100007F:1F90'] : []) } };
  const execute = async () => ({ plant: { runState: 'complete', flags: [] } });
  await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  await assert.rejects(runPlantCell(execute, { ctx, outDir: '/nonexistent' }), PlantSuiteStop);
});

test('a control suite under --isolate none notes a new host listener and goes on (D-92)', async () => {
  let reads = 0;
  const logged = [];
  const ctx = { plant: { counted: false, control: true, isolationMode: 'none', log: (m) => logged.push(m), readListeners: () => (++reads > 2 ? ['tcp 0100007F:1F90'] : []) } };
  const execute = async () => ({ plant: { runState: 'complete', flags: [] } });
  await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  const second = await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  assert.deepEqual(second.plant.hostListenerNotes, ['tcp 0100007F:1F90']);
  assert.match(logged[0], /control suite runs without a sandbox and never counts, so it goes on/);
  let r2 = 0;
  const counted = { plant: { counted: true, control: false, isolationMode: 'none', readListeners: () => (++r2 > 2 ? ['tcp 0100007F:1F90'] : []) } };
  await runPlantCell(execute, { ctx: counted, outDir: '/nonexistent' });
  await assert.rejects(runPlantCell(execute, { ctx: counted, outDir: '/nonexistent' }), PlantSuiteStop);
});

test('a NOT COUNTED pilot logs a new host listener once, records it on the trial and goes on', async () => {
  let reads = 0;
  const logged = [];
  const ctx = { plant: { counted: false, control: false, log: (m) => logged.push(m), readListeners: () => (++reads > 2 ? ['tcp 0100007F:1F90'] : []) } };
  const execute = async () => ({ plant: { runState: 'complete', flags: [] } });
  const first = await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  const second = await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  const third = await runPlantCell(execute, { ctx, outDir: '/nonexistent' });
  assert.equal(first.plant.hostListenerNotes, undefined);
  assert.deepEqual(second.plant.hostListenerNotes, ['tcp 0100007F:1F90']);
  assert.equal(third.plant.hostListenerNotes, undefined);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /new listener .*tcp 0100007F:1F90.*not counted, so it goes on/);
});

test('a foreign connection stops the plant suite', async () => {
  const ctx = { plant: { readListeners: () => [] } };
  await assert.rejects(runPlantCell(async () => ({ plant: { runState: 'complete', flags: ['plantForeignConn'] } }), { ctx, outDir: '/x' }), /foreign connection/);
});

// ---- terminal gateway violations stop the agent at once (SR-4, SR-16) ----

// The fake agent's hold. A trial stopped early ends with "stopped early: <reason>" and before the hold runs out; one left to
// run ends at the hold or the task timeout instead. Neither check depends on how fast a busy host starts the gateway.
const HOLD_MS = 60000;
const stoppedBeforeHold = (heldMs) => assert.ok(heldMs === null || heldMs < HOLD_MS, `the agent was stopped, not left to its ${HOLD_MS / 1000} s hold (it held for ${heldMs} ms)`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * Runs the cells `cellCount` times over one rig as a suite would: each cell is a trial whose agent stays open for 60 s
 * after `fake` does its part. Stops at the first PlantSuiteStop. Resolves with the results, the stop (or null), how
 * many trials started, the first agent's pid, the first trial's out dir, and `heldMs`: the time from the agent starting
 * its hold to the trial's end (null when it never reached the hold). Gateway start-up and the calls before the hold are
 * not in `heldMs`, so a busy host does not count against the stop. The task timeout is raised well past the hold, so a
 * slow host never hits the timeout before the gateway's limit or check does: a trial that ends must end by the stop.
 */
async function heldCells(r, fake, cellCount = 1) {
  const planned = await plantRun(r, { hold: true, ...fake });
  const args = { ...planned.args, task: { ...planned.args.task, timeoutSec: 10 * HOLD_MS / 1000 } };
  const results = [];
  let started = 0;
  let stop = null;
  const begun = Date.now();
  for (let cell = 1; cell <= cellCount && !stop; cell++) {
    const outDir = cell === 1 ? args.outDir : `${args.outDir}-${cell}`;
    try {
      results.push(await runPlantCell((a) => { started++; return executeRun(a); }, { ...args, outDir }));
    } catch (e) {
      if (!(e instanceof PlantSuiteStop)) throw e;
      stop = e;
    }
  }
  const ended = Date.now();
  const agent = JSON.parse(fs.readFileSync(path.join(r.probe, 'started.json'), 'utf8')).pid;
  const heldFile = path.join(r.probe, 'held.json');
  const heldMs = fs.existsSync(heldFile) ? ended - JSON.parse(fs.readFileSync(heldFile, 'utf8')).at : null;
  return { results, stop, started, agent, outDir: args.outDir, ms: ended - begun, heldMs };
}

test('a line over the limit ends the trial at once: the held agent is killed and the trial is plantLimit', async () => {
  const r = rig();
  try {
    const { results, heldMs, agent } = await heldCells(r, { calls: STOP_CALLS, overLongLine: true });
    stoppedBeforeHold(heldMs);
    assert.notEqual(results[0].status, 'timeout');
    assert.equal(alive(agent), false);
    assert.ok(results[0].plant.flags.includes('plantLimit'));
    assert.match(results[0].error, /stopped early: plantLimit/);
  } finally { r.cleanup(); }
});

test('a call over the limit ends the trial at once: the held agent is killed and the trial is plantLimit', async () => {
  const r = rig();
  try {
    // 2001 calls one at a time took 38 to 85 s under load, three process wake-ups each (DEBT D-15); 50 in flight
    // still has the gateway count every call and refuse the one past its limit of 2000.
    const flood = Array.from({ length: 2001 }, () => ({ tool: 'get_state', args: {}, inStream: false }));
    const { results, heldMs, agent, outDir } = await heldCells(r, { calls: flood, window: 50 });
    stoppedBeforeHold(heldMs);
    assert.match(results[0].error, /stopped early: plantLimit/);
    assert.notEqual(results[0].status, 'timeout');
    assert.equal(alive(agent), false);
    assert.ok(results[0].plant.flags.includes('plantLimit'));
    assert.ok(readJsonl(path.join(outDir, 'plant', 'gateway.jsonl')).some((l) => l.type === 'limit' && l.which === 'calls'));
  } finally { r.cleanup(); }
});

test('a foreign connection ends the trial at once, and the suite stops: no later cell starts', async () => {
  const r = rig();
  const realPeer = GatewayProcess.prototype.peer;
  // The shim's own connection becomes the stranger: the gateway is told the sandbox is in another pid namespace.
  GatewayProcess.prototype.peer = function foreignPeer() { realPeer.call(this, 'pid:[1]'); };
  try {
    const { stop, started, heldMs, agent, outDir } = await heldCells(r, { calls: STOP_CALLS }, 2);
    assert.ok(stop, 'the suite stopped');
    assert.match(stop.message, /foreign connection/);
    assert.equal(started, 1, 'the second cell never started');
    stoppedBeforeHold(heldMs);
    const first = JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'));
    assert.match(first.error, /stopped early: plantForeignConn/);
    assert.notEqual(first.status, 'timeout');
    assert.equal(alive(agent), false);
    assert.ok(readJsonl(path.join(outDir, 'plant', 'gateway.jsonl')).some((l) => l.type === 'foreign_conn'));
  } finally {
    GatewayProcess.prototype.peer = realPeer;
    r.cleanup();
  }
});

test('a nested pid namespace peer is a plantLimit stop: the run polls the gateway\'s heartbeat', () => {
  const nested = { op: 'hb', limitHit: 'nested_pidns', foreignConn: false };
  const run = new PlantRun({ suite: { deadlines: FAST }, gateway: { lostReason: () => null, heartbeats: () => [{ op: 'hb', limitHit: null, foreignConn: false }, nested] } });
  assert.deepEqual(run.poll(), { reason: 'plantLimit', detail: 'gateway limit nested_pidns' });
  run.gateway.heartbeats = () => [{ op: 'hb', limitHit: null, foreignConn: false }];
  assert.equal(run.poll(), null);
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
