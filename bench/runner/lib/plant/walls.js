// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plant walls on the runner side (13.2, 13.5): what the sandbox is given for a plant run, the host checks that run
// before any trial, and the wall prober's preflight run. Never relaxes a wall to let a suite start: a check that cannot run fails.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { realHomes } = require('../isolate.js');
const { sha256File } = require('../sandbox.js');
const { parseStream } = require('../stream.js');
const { writePlantAgent } = require('./agent-file.js');
const { PLANT_KINDS } = require('./kinds.js');
const { ReleaseRefused } = require('./manifest.js');
const prober = require('../../../physical/controls/wall-prober-kiro');

const PROBER_FILE = path.join(__dirname, '..', '..', '..', 'physical', 'controls', 'wall-prober-kiro');
const SHIM_FILE = path.join(__dirname, 'shim.js');
const SHARED_DIRS = ['/tmp', '/var/tmp', '/dev/shm'];
const PROBER_TIMEOUT_MS = 120000;
const ALLOWLIST_FILE = 'network-allowlist.txt';
// Proposed caps for the sandbox's systemd scope (NFR-12); a host that refuses a scope runs without them and says so.
const CGROUP_PROPERTIES = ['MemoryMax=4G', 'TasksMax=1024', 'CPUQuota=200%'];
const CGROUP_ARGS = ['--user', '--scope', '--quiet', ...CGROUP_PROPERTIES.flatMap((p) => ['-p', p])];
const realOrSame = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

class WallsRefused extends ReleaseRefused {}

/**
 * What makeIsolation needs on top of the usual for plant run `run`: its plant dir stays read-only even inside scratch, and
 * of every socket root under `suite.socketParent` only the run's own shows (SR-5, B-1).
 */
function plantWalls(suite, run) {
  return { readOnly: [run.plantDir], exposeOnly: [{ parent: suite.socketParent, child: run.socketRoot }] };
}

/**
 * Whether this host lets a user session start a systemd scope with the caps. `run(cmd, args)` returns `{status, stderr}`
 * (default spawnSync). Returns `{ok: true, caps}` or `{ok: false, reason}`.
 */
function detectCgroup(run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 })) {
  const r = run('systemd-run', [...CGROUP_ARGS, '--', 'true']);
  if (r.status === 0) return { ok: true, caps: CGROUP_PROPERTIES.join(' ') };
  const why = r.error ? r.error.message : (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`;
  return { ok: false, reason: `systemd-run scope unavailable (${why})` };
}

/** `iso` with its command started inside the systemd scope of `cgroup` (from detectCgroup), when that scope works. */
function withCgroup(iso, cgroup) {
  if (!cgroup?.ok || iso.mode !== 'unshare') return iso;
  return { ...iso, wrap: (file, args) => {
    const w = iso.wrap(file, args);
    return { file: 'systemd-run', args: [...CGROUP_ARGS, '--', w.file, ...w.args] };
  } };
}

/** Throws WallsRefused unless `hide` (the --hide list) names the checkout `repo` or a directory holding it (13.4). */
function requireCheckoutHidden(hide, repo) {
  const target = realOrSame(repo);
  if (!hide.some((h) => inside(target, realOrSame(h)))) throw new WallsRefused(`a plant suite must pass --hide ${repo}: the checkout holds the probes and the policy sources`);
}

/** B-3: throws WallsRefused when any mask or plant path lies inside `scratch`, where bench drops masks without an error. */
function requireMasksOutsideScratch(paths, scratch) {
  const base = realOrSame(scratch);
  const bad = paths.filter((p) => inside(realOrSame(p), base));
  if (bad.length) throw new WallsRefused(`plant masks and paths must lie outside scratch; ${bad.join(', ')} would be dropped without an error (SR-19)`);
}

/**
 * SR-12: throws WallsRefused when a writable mount lies below the home or /tmp, /var/tmp or /dev/shm, because
 * the sandbox's read-only remount does not reach it. `ignore` lists mounts that may stay writable (the scratch root).
 * `run(cmd, args)` returns `{status, stdout}` (default spawnSync); a `findmnt` that cannot run fails closed.
 */
function requireNoWritableSubmounts(ignore, run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })) {
  const r = run('findmnt', ['-R', '-rn', '-o', 'TARGET,OPTIONS']);
  if (r.status !== 0) throw new WallsRefused(`findmnt -R failed (${r.error ? r.error.message : `exit ${r.status}`}); the writable-submount check cannot run`);
  const roots = [...realHomes(), ...SHARED_DIRS.map(realOrSame)];
  const writable = prober.writableSubmounts(r.stdout, roots, ignore);
  if (writable.length) throw new WallsRefused(`writable submounts stay writable inside the sandbox: ${writable.join(', ')}; remount them read-only or move the run to another host (SR-12)`);
}

/**
 * The 13.5 checklist from prober `results`: one `{id, name, state, rows}` per boundary. `state` is "broken" when any of its
 * rows did not hold, "not run" when none ran, else "held". B-3 has no prober row: the runner checks it before the prober
 * starts, so reaching the checklist means it held.
 */
function checklist(results) {
  return Object.entries(prober.BOUNDARIES).map(([id, name]) => {
    const rows = results.filter((r) => r.boundary.includes(id));
    const state = rows.some((r) => r.held === false) ? 'broken' : id === 'B-3' || rows.some((r) => r.held === true) ? 'held' : 'not run';
    return { id, name, state, rows: rows.map((r) => r.row) };
  });
}

/** The prober rows that need the live gateway of a trial, by id; the preflight records them `held: null`. */
const GATEWAY_ROWS = new Map(prober.ROWS.filter((r) => r.gateway).map((r) => [r.id, r]));
const NESTED_ROW = 'nested-pidns-connect-closed';

/**
 * The gateway rows a wall prober trial of a control suite left in `runDir`, as `{row, boundary, sr, held, detail}`: its
 * stream lines for the rows that need the live gateway (boundary and sr taken from the prober, not the line), plus the
 * nested pid namespace row as held when its own line was lost but `plant/gateway.jsonl` holds the `nested_pidns` limit
 * the gateway ends the trial on. Empty for a trial of any other agent.
 */
function trialGatewayRows(runDir) {
  const read = (rel) => readTextOr(path.join(runDir, rel));
  const rows = parseProberOutput(read('stream.jsonl')).filter((r) => GATEWAY_ROWS.has(r.row) && typeof r.held === 'boolean')
    .map((r) => ({ row: r.row, boundary: GATEWAY_ROWS.get(r.row).boundary, sr: GATEWAY_ROWS.get(r.row).sr, held: r.held, detail: r.detail }));
  if (rows.length && !rows.some((r) => r.row === NESTED_ROW)) {
    const limit = parseStream(read('plant/gateway.jsonl')).events.some((e) => e.type === 'limit' && e.which === 'nested_pidns');
    const nested = GATEWAY_ROWS.get(NESTED_ROW);
    if (limit) rows.push({ row: NESTED_ROW, boundary: nested.boundary, sr: nested.sr, held: true, detail: 'the gateway log holds the nested_pidns limit' });
  }
  return rows;
}

/**
 * The checklist from the preflight `results` with each gateway row replaced by the trial `rows` for it (from
 * trialGatewayRows, any number of trials). A gateway row no trial reported stays as the preflight left it.
 */
function checklistWithTrials(results, rows) {
  const reported = new Set(rows.map((r) => r.row));
  return checklist([...results.filter((r) => !reported.has(r.row)), ...rows]);
}

/** The row results that did not hold, plus any row the prober never reported. */
function failedRows(results) {
  const reported = new Set(results.map((r) => r.row));
  const missing = prober.ROWS.filter((r) => !reported.has(r.id)).map((r) => ({ row: r.id, held: false, detail: 'the prober did not report this row' }));
  return [...results.filter((r) => r.held === false), ...missing];
}

/** Parses the prober's stdout: its JSON lines, ignoring anything else. */
function parseProberOutput(text) {
  return parseStream(text).events.filter((r) => r.row && r.row !== 'summary');
}

/** A stub gw.sock at `socket`: answers each line with an empty result and counts the connections it gets. */
function listenStub(socket) {
  const stub = { connections: 0, server: net.createServer((conn) => {
    stub.connections++;
    conn.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((line) => conn.write(`{"jsonrpc":"2.0","id":${JSON.parse(line).id},"result":{}}\n`)));
    conn.on('error', () => {});
  }) };
  return new Promise((resolve) => stub.server.listen(socket, () => resolve(stub)));
}

/** Waits for `child` to exit and resolves `{status, stdout}`; kills it after the timeout. */
function collect(child, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', () => resolve({ status: null, stdout }));
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout }); });
  });
}

/** The `network-allowlist.txt` the release lists, parsed; an empty allowlist when it holds none. */
function releaseAllowlist(release) {
  return release.sha256Of(ALLOWLIST_FILE) ? prober.parseAllowlist(fs.readFileSync(release.fileOf(ALLOWLIST_FILE), 'utf8')) : prober.parseAllowlist('');
}

const readTextOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

/**
 * The quiet-host check the runner makes itself (13.5 B-6, SR-20): each loopback or wildcard TCP or UDP listener on the
 * host that neither the release's allowlist nor the host's DNS stub names, as `kind ip:port`; empty on a quiet host. The
 * same listeners the prober's default-deny rows look at. `readText(file)` reads /proc and /etc/resolv.conf (a test seam).
 */
function hostNoise(release, readText = readTextOr) {
  const allow = releaseAllowlist(release);
  const stub = prober.dnsStubEntries(readText('/etc/resolv.conf'));
  const listeners = (kind) => [[kind, false], [`${kind}6`, true]]
    .flatMap(([table, v6]) => prober.inetListeners(readText(`/proc/net/${table}`), kind, v6)).filter(prober.isLoopbackOrWildcard);
  const noisy = ['tcp', 'udp'].flatMap((kind) => listeners(kind).filter((a) => !allow[kind].includes(a) && !stub[kind].includes(a)).map((a) => `${kind} ${a}`));
  return [...new Set(noisy)];
}

/**
 * Runs the wall prober once inside the real sandbox (13.5, SR-12). Builds a small plant rig in a new dir under
 * `scratch` (agent file, read-only shim copy, a stub gw.sock and a sibling socket root, an out-dir sentinel), then runs the
 * prober as the agent with the same isolation a trial gets. `makeIso(scratchRoot, plantRun)` returns that isolation.
 * `suite` is preparePlantSuite's result; `hide`-and-mask facts come from `iso.masked`. Returns `{results, problems}`:
 * `problems` lists every prober row that did not hold and every host-side fact that changed (sentinel, shim, socket).
 */
async function runWallProber(options) {
  const rig = { dirs: [], stubs: [], root: null, plantDir: null };
  try {
    await createWallRig(rig, options);
    const results = parseProberOutput(await executeWallProber(rig));
    return { results, problems: verifyWallRig(rig, results) };
  } finally {
    disposeWallRig(rig);
  }
}

/** Makes a temp dir under `parent` that `disposeWallRig` removes, even when a later step of the rig's setup throws. */
function rigDir(rig, parent, prefix) {
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  rig.dirs.push(dir);
  return dir;
}

/**
 * Builds the prober's rig into `rig`: dirs, the shim and prober copies, the stub sockets, the agent file, the prober
 * config and the isolation. `suite`, `scratch`, `outDir`, `makeIso` and `realHome` are runWallProber's. Sets `rig.root`,
 * `plantDir`, `shim`, `sockets`, `sentinel`, `before` (hashes and inode taken before the run), `proberCopy`, `iso` and `env`.
 */
async function createWallRig(rig, { suite, scratch, outDir, makeIso, realHome = realHomes()[0] }) {
  rig.root = rigDir(rig, scratch, 'wall-');
  const home = path.join(rig.root, 'home');
  const own = rigDir(rig, suite.socketParent, 's-');
  const sibling = rigDir(rig, suite.socketParent, 's-');
  const sentinelDir = rigDir(rig, outDir, 'wall-sentinel-');
  rig.plantDir = path.join(rig.root, 'plant');
  fs.mkdirSync(rig.plantDir);
  rig.shim = path.join(rig.plantDir, 'shim.js');
  fs.copyFileSync(SHIM_FILE, rig.shim);
  rig.proberCopy = path.join(rig.root, 'wall-prober-kiro');
  fs.copyFileSync(PROBER_FILE, rig.proberCopy);
  rig.sockets = [path.join(own, 'gw.sock'), path.join(sibling, 'gw.sock')];
  for (const socket of rig.sockets) rig.stubs.push(await listenStub(socket));
  // The walls do not depend on the plant; the first plant by order (the conveyor) gives the agent file its prompt.
  writePlantAgent(home, { shimPath: rig.shim, socketPath: rig.sockets[0], nodeBin: process.execPath, kind: Object.keys(PLANT_KINDS)[0] });
  rig.sentinel = path.join(sentinelDir, 'gateway.jsonl');
  fs.writeFileSync(rig.sentinel, 'sentinel\n');
  rig.before = { shim: sha256File(rig.shim), sentinel: sha256File(rig.sentinel), sibling: fs.statSync(rig.sockets[1]).ino };
  fs.chmodSync(rig.shim, 0o444);
  fs.chmodSync(rig.plantDir, 0o555);
  rig.iso = makeIso(rig.root, { plantDir: rig.plantDir, socketRoot: own });
  const masked = rig.iso.masked || [];
  const configFile = path.join(home, '.kiro', 'wall-prober.json');
  fs.writeFileSync(configFile, JSON.stringify({
    maskedPaths: masked, siblingSockets: [rig.sockets[1]], outSentinel: rig.sentinel, realHome, homeAliases: [os.homedir()],
    homeCaches: ['.cache', '.npm', '.local/share'].map((d) => path.join(realHome, d)), scratch: rig.root, gateway: false,
    writableAllowed: [rig.root, ...masked], allow: releaseAllowlist(suite.release),
  }));
  rig.env = { PATH: process.env.PATH, HOME: home, TMPDIR: path.join(rig.root, 'tmp'), WALL_PROBER_CONFIG: configFile };
  fs.mkdirSync(rig.env.TMPDIR);
}

/** Runs the prober as the agent inside `rig`'s isolation and resolves with its stdout. */
async function executeWallProber(rig) {
  const w = rig.iso.wrap(process.execPath, [rig.proberCopy]);
  const out = await collect(spawn(w.file, w.args, { env: rig.env, stdio: ['ignore', 'pipe', 'inherit'] }), PROBER_TIMEOUT_MS);
  return out.stdout;
}

/** Every row of `results` that failed, plus each host-side fact of `rig` that changed during the run. */
function verifyWallRig(rig, results) {
  const problems = failedRows(results).map((r) => `${r.row}: ${r.detail}`);
  if (sha256File(rig.shim) !== rig.before.shim) problems.push('the shim copy changed');
  if (sha256File(rig.sentinel) !== rig.before.sentinel) problems.push('the out dir sentinel changed');
  if (rig.stubs[1].connections > 0) problems.push('the sibling socket was connected to');
  if (fs.statSync(rig.sockets[1]).ino !== rig.before.sibling) problems.push('the sibling socket was replaced');
  return problems;
}

/** Closes the stub sockets and removes every dir `rig` made; safe on a rig whose setup stopped part way. */
function disposeWallRig(rig) {
  for (const stub of rig.stubs) stub.server.close();
  for (const dir of [rig.plantDir, rig.root]) if (dir && fs.existsSync(dir)) fs.chmodSync(dir, 0o700);
  for (const dir of rig.dirs) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * The plant wall checks before a suite starts (SR-12, SR-19, SR-20): the checkout is hidden, no mask lies in scratch, no
 * writable submount, then the wall prober inside the sandbox. Returns `{cgroup, checklist}` for the report header. Throws
 * WallsRefused with every problem. Only for isolation mode "unshare": other modes have no walls to check.
 * `ctx` is the run context (isolation, hide, mask, scratchDir), `suite` the plant suite, `repo` the checkout,
 * `outDir` the run's out dir, `makeIso(scratchRoot, plantRun)` as in runWallProber.
 */
async function preflightWalls({ ctx, suite, repo, outDir, makeIso }) {
  requireCheckoutHidden(ctx.hide, repo);
  requireMasksOutsideScratch([...ctx.mask, suite.socketParent, suite.privateRoot], ctx.scratchDir);
  requireNoWritableSubmounts([ctx.scratchDir, outDir]);
  const cgroup = detectCgroup();
  const run = await runWallProber({ suite, scratch: ctx.scratchDir, outDir, makeIso: (root, plantRun) => withCgroup(makeIso(root, plantRun), cgroup) });
  if (run.problems.length) throw new WallsRefused(`the wall prober found a way through:\n  ${run.problems.join('\n  ')}`);
  return { cgroup, checklist: checklist(run.results), results: run.results };
}

module.exports = {
  plantWalls, detectCgroup, withCgroup, requireCheckoutHidden, requireMasksOutsideScratch, requireNoWritableSubmounts,
  checklist, trialGatewayRows, checklistWithTrials, failedRows, parseProberOutput, releaseAllowlist, hostNoise, listenStub, runWallProber, preflightWalls, WallsRefused, CGROUP_PROPERTIES,
};
