// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/plant-wave.sh: the owner's one-command counted-set wave. Free checks only: usage, the wave table, the
// refusals that fire before any spend, and, when a cedarpy Python 3.12 and the private counted-set folder are present
// on the host, a full `bench run --prepare-only` with a stub kiro-cli and a throwaway key (no agent, no model, no
// credits). In CI, where that folder and cedarpy are absent, the prepare-only case skips.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'plant-wave.sh');
const TOOL = path.join(__dirname, '..', '..', 'physical', 'ci', 'plant-release.js');
const run = (args, env = {}) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });

/** A directory that passes the script's `PLANT_CS` check (release/tasks exists), for the refusals that come after it. */
function stubCs() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-wave-cs-'));
  fs.mkdirSync(path.join(d, 'release', 'tasks'), { recursive: true });
  return d;
}

/**
 * A cedarpy Python 3.12 (BENCH_ARM_PYTHON) and the private counted-set folder (PLANT_CS), or null when either is not
 * given or not there (then the full case skips). No host path is assumed (D-182).
 */
function liveEnv() {
  const venv = process.env.BENCH_ARM_PYTHON;
  const cs = process.env.PLANT_CS;
  if (!venv || !cs || !fs.existsSync(venv) || !fs.existsSync(path.join(cs, 'release', 'tasks'))) return null;
  if (spawnSync(venv, ['-c', 'import cedarpy'], { stdio: 'ignore' }).status !== 0) return null;
  return { venv, cs };
}

test('plant-wave.sh is valid bash and shellcheck-clean when shellcheck exists', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  if (spawnSync('shellcheck', ['--version']).status === 0) {
    const r = spawnSync('shellcheck', ['-S', 'warning', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
  }
});

test('usage errors exit 64 and --list prints waves 0 to 4', () => {
  assert.equal(run([]).status, 64);
  assert.equal(run(['9']).status, 64);
  const l = run(['--list']);
  assert.equal(l.status, 0);
  for (const w of ['0 plant-p1-overspeed', '1 plant-p1-overspeed', '2 plant-p2', '3 plant-p3', '4 plant-n 12 2 unshare normal 3 w4', '4 plant-p 37 2 unshare heldback 1 w4']) assert.ok(l.stdout.includes(w), l.stdout);
});

/**
 * A stub counted set with `open` release tasks, `held` held-back tasks and `normal` normal tasks (file names only; the
 * plan reads no task content), in a new dir. Returns `{cs, normal}`; `t.after` removes it.
 */
function planCs(t, { open = [], held = [], normal = [] }) {
  const cs = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-wave-plan-'));
  t.after(() => fs.rmSync(cs, { recursive: true, force: true }));
  const put = (dir, ids) => { fs.mkdirSync(dir, { recursive: true }); for (const id of ids) fs.writeFileSync(path.join(dir, `${id}.json`), `{"id":"${id}"}\n`); };
  put(path.join(cs, 'release', 'tasks'), open);
  put(path.join(cs, 'held-back', 'tasks'), held);
  put(path.join(cs, 'normal'), normal);
  return { cs, normal: path.join(cs, 'normal') };
}

test('--plan is free: it prints each part with its tasks, trials, ceiling and expected credits, and the paid command', (t) => {
  const { cs } = planCs(t, { open: ['plant-p2-guard-no-approval.v01', 'plant-p5-injected-text.v01', 'plant-p7-jam-link-loss.v01', 'plant-p1-overspeed.v01'] });
  const r = run(['2', '--plan'], { PLANT_CS: cs, PLANT_KBIN: '/no/such/kiro', PLANT_VENV: '/no/such/python' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /part main: 3 tasks x 2 arms x 1 replicate = 6 trials; ceiling 134 credits; expected about 2\.2/);
  assert.match(r.stdout, /wave 2 total: 6 trials, ceiling 134 credits, expected about 2\.2 credits/);
  assert.match(r.stdout, /paid run \(owner\): bash .*plant-wave\.sh 2/);
});

test('wave 4 --plan lists the normal part (3 replicates) and the held-back part, with the held-back hash', (t) => {
  const { cs, normal } = planCs(t, { held: ['plant-p1-overspeed.v36', 'plant-p2-guard-no-approval.v36'], normal: ['plant-n1-target-speed.v01', 'plant-n2-stop-jam.v01', 'plant-n3-approved-guard.v01'] });
  const r = run(['4', '--plan'], { PLANT_CS: cs, PLANT_NORMAL: normal });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /part normal: 3 tasks x 2 arms x 3 replicates = 18 trials; ceiling 12 credits/);
  assert.match(r.stdout, /part heldback: 2 tasks x 2 arms x 1 replicate = 4 trials; ceiling 37 credits/);
  assert.match(r.stdout, /wave 4 total: 22 trials, ceiling 49 credits/);
  assert.match(r.stdout, /held-back sha256 [0-9a-f]{64}/);
  assert.match(r.stdout, /PLANT_HELDBACK_SHA256 is not set/);
});

test('wave 4 stops before any work without PLANT_NORMAL or the held-back folder', (t) => {
  const { cs } = planCs(t, { held: ['plant-p1-overspeed.v36'] });
  const r = run(['4', '--plan'], { PLANT_CS: cs });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: wave 4 needs PLANT_NORMAL/);
  const bare = planCs(t, { normal: ['plant-n1-target-speed.v01'] });
  fs.rmSync(path.join(bare.cs, 'held-back'), { recursive: true });
  const r2 = run(['4', '--plan'], { PLANT_CS: bare.cs, PLANT_NORMAL: bare.normal });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /STOP: wave 4 needs .*held-back\/tasks/);
});

test('wave 4 stops when PLANT_HELDBACK_SHA256 does not match the held-back folder', (t) => {
  const { cs, normal } = planCs(t, { held: ['plant-p1-overspeed.v36'], normal: ['plant-n1-target-speed.v01'] });
  const r = run(['4', '--plan'], { PLANT_CS: cs, PLANT_NORMAL: normal, PLANT_HELDBACK_SHA256: '0'.repeat(64) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: the held-back folder .* is not the one recorded at freeze/);
});

test('the held-back hash is the make-fields.py tar hash: same for the same files, other when a file changes, blind to mtime', (t) => {
  const HELPER = path.join(__dirname, '..', '..', 'scripts', 'lib', 'heldback_sha.py');
  const { cs } = planCs(t, { held: ['plant-p1-overspeed.v36'] });
  const dir = path.join(cs, 'held-back');
  const hash = () => execFileSync('python3', [HELPER, dir], { encoding: 'utf8' }).trim();
  const a = hash();
  assert.match(a, /^[0-9a-f]{64}$/);
  fs.utimesSync(path.join(dir, 'tasks', 'plant-p1-overspeed.v36.json'), new Date(0), new Date(0));
  assert.equal(hash(), a);
  fs.writeFileSync(path.join(dir, 'tasks', 'plant-p1-overspeed.v36.json'), '{"id":"changed"}\n');
  assert.notEqual(hash(), a);
});

test('a missing PLANT_CS stops before any work', () => {
  const r = run(['0', '--prepare-only'], { PLANT_CS: '/no/such/counted-set' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: set PLANT_CS .*\/no\/such\/counted-set has none/);
});

test('an unset PLANT_CS stops: the script assumes no host path for the private folder (D-182)', () => {
  const r = run(['0', '--prepare-only']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: set PLANT_CS to the private counted-set folder \(it must hold release\/tasks\)$/m);
});

test('a version-manager shim as PLANT_VENV stops', () => {
  const cs = stubCs();
  const shim = path.join(cs, 'shims');
  fs.mkdirSync(shim);
  const py = path.join(shim, 'python3.12');
  fs.writeFileSync(py, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const r = run(['0', '--prepare-only'], { PLANT_CS: cs, PLANT_VENV: py });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: PLANT_VENV is a version-manager shim/);
  fs.rmSync(cs, { recursive: true, force: true });
});

test('stub kiro-cli + throwaway key: full prepare-only passes (skips without a cedarpy venv)', (t) => {
  const live = liveEnv();
  // As arm-python.js: in the counted suite (BENCH_REQUIRE_ARM=1) a missing venv or counted set is an error, not a skip.
  if (!live && process.env.BENCH_REQUIRE_ARM === '1') assert.fail(`BENCH_REQUIRE_ARM=1 but the live case cannot run: set BENCH_ARM_PYTHON to a cedarpy Python and PLANT_CS to the counted set (now ${process.env.PLANT_CS || 'unset'})`);
  if (!live) return t.skip('no cedarpy Python 3.12 and counted-set folder on this host');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-wave-'));
  // stub kiro-cli: answers --version 3.5.0 and whoami ok; never launched by prepare-only
  const kiro = path.join(d, 'kiro-cli');
  fs.writeFileSync(kiro, '#!/bin/sh\n[ "$1" = --version ] && { echo "kiro-cli 3.5.0"; exit 0; }\n[ "$1" = whoami ] && exit 0\nexit 0\n', { mode: 0o755 });
  // throwaway key + its own pinned-keys file (the runner never sees it; prepare-only does no intake, verify uses --keys)
  execFileSync('node', [TOOL, 'keygen', '--out', path.join(d, 'key')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(d, 'keys.json'), '[]');
  execFileSync('node', [TOOL, 'pin', '--public', path.join(d, 'key', 'public.pem'), '--keys', path.join(d, 'keys.json')], { stdio: 'ignore' });
  const r = run(['0', '--prepare-only'], {
    PLANT_CS: live.cs, PLANT_VENV: live.venv, PLANT_KBIN: kiro,
    PLANT_KEY: path.join(d, 'key', 'private.pem'), PLANT_KEYS: path.join(d, 'keys.json'), PLANT_R: path.join(d, 'r'),
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /release intake: ok/);
  assert.match(r.stdout, /policy test: ok/);
  assert.match(r.stdout, /prepare-only passed/);
  fs.rmSync(d, { recursive: true, force: true });
});
