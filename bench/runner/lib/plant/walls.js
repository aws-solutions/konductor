// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plant walls on the runner side (13.2, 13.5): what the sandbox is given for a plant run, the host checks that run
// before any trial, and the wall prober's preflight run. Never relaxes a wall to let a suite start: a check that cannot run fails.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { realHomes } = require('../isolate.js');
const { writePlantAgent } = require('./agent-file.js');
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

/** The row results that did not hold, plus any row the prober never reported. */
function failedRows(results) {
  const reported = new Set(results.map((r) => r.row));
  const missing = prober.ROWS.filter((r) => !reported.has(r.id)).map((r) => ({ row: r.id, held: false, detail: 'the prober did not report this row' }));
  return [...results.filter((r) => r.held === false), ...missing];
}

/** Parses the prober's stdout: its JSON lines, ignoring anything else. */
function parseProberOutput(text) {
  return text.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((r) => r.row && r.row !== 'summary');
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

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

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

/**
 * Runs the wall prober once inside the real sandbox (13.5, SR-12). Builds a small plant rig in a new dir under
 * `scratch` (agent file, read-only shim copy, a stub gw.sock and a sibling socket root, an out-dir sentinel), then runs the
 * prober as the agent with the same isolation a trial gets. `makeIso(scratchRoot, plantRun)` returns that isolation.
 * `suite` is preparePlantSuite's result; `hide`-and-mask facts come from `iso.masked`. Returns `{results, problems}`:
 * `problems` lists every prober row that did not hold and every host-side fact that changed (sentinel, shim, socket).
 */
async function runWallProber({ suite, scratch, outDir, makeIso, realHome = realHomes()[0] }) {
  const rig = fs.mkdtempSync(path.join(scratch, 'wall-'));
  const home = path.join(rig, 'home');
  const plantDir = path.join(rig, 'plant');
  const own = fs.mkdtempSync(path.join(suite.socketParent, 's-'));
  const sibling = fs.mkdtempSync(path.join(suite.socketParent, 's-'));
  const sentinelDir = fs.mkdtempSync(path.join(outDir, 'wall-sentinel-'));
  const stubs = [];
  try {
    fs.mkdirSync(plantDir);
    const shim = path.join(plantDir, 'shim.js');
    fs.copyFileSync(SHIM_FILE, shim);
    const proberCopy = path.join(rig, 'wall-prober-kiro');
    fs.copyFileSync(PROBER_FILE, proberCopy);
    const sockets = [path.join(own, 'gw.sock'), path.join(sibling, 'gw.sock')];
    for (const s of sockets) stubs.push(await listenStub(s));
    writePlantAgent(home, { shimPath: shim, socketPath: sockets[0], nodeBin: process.execPath });
    const sentinel = path.join(sentinelDir, 'gateway.jsonl');
    fs.writeFileSync(sentinel, 'sentinel\n');
    const before = { shim: sha256File(shim), sentinel: sha256File(sentinel), sibling: fs.statSync(sockets[1]).ino };
    fs.chmodSync(shim, 0o444);
    fs.chmodSync(plantDir, 0o555);
    const iso = makeIso(rig, { plantDir, socketRoot: own });
    const masked = iso.masked || [];
    const config = {
      maskedPaths: masked, siblingSockets: [sockets[1]], outSentinel: sentinel, realHome, homeAliases: [os.homedir()],
      homeCaches: ['.cache', '.npm', '.local/share'].map((d) => path.join(realHome, d)), scratch: rig, gateway: false,
      writableAllowed: [rig, ...masked], allow: releaseAllowlist(suite.release),
    };
    fs.writeFileSync(path.join(home, '.kiro', 'wall-prober.json'), JSON.stringify(config));
    const w = iso.wrap(process.execPath, [proberCopy]);
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: path.join(rig, 'tmp'), WALL_PROBER_CONFIG: path.join(home, '.kiro', 'wall-prober.json') };
    fs.mkdirSync(env.TMPDIR);
    const out = await collect(spawn(w.file, w.args, { env, stdio: ['ignore', 'pipe', 'inherit'] }), PROBER_TIMEOUT_MS);
    const results = parseProberOutput(out.stdout);
    const problems = failedRows(results).map((r) => `${r.row}: ${r.detail}`);
    if (sha256File(shim) !== before.shim) problems.push('the shim copy changed');
    if (sha256File(sentinel) !== before.sentinel) problems.push('the out dir sentinel changed');
    if (stubs[1].connections > 0) problems.push('the sibling socket was connected to');
    if (fs.statSync(sockets[1]).ino !== before.sibling) problems.push('the sibling socket was replaced');
    return { results, problems };
  } finally {
    for (const s of stubs) s.server.close();
    for (const d of [plantDir, rig]) fs.chmodSync(d, 0o700);
    fs.rmSync(rig, { recursive: true, force: true });
    for (const d of [own, sibling, sentinelDir]) fs.rmSync(d, { recursive: true, force: true });
  }
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
  return { cgroup, checklist: checklist(run.results) };
}

module.exports = {
  plantWalls, detectCgroup, withCgroup, requireCheckoutHidden, requireMasksOutsideScratch, requireNoWritableSubmounts,
  checklist, failedRows, parseProberOutput, releaseAllowlist, listenStub, runWallProber, preflightWalls, WallsRefused, CGROUP_PROPERTIES,
};
