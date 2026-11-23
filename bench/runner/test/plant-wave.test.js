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

test('usage errors exit 64 and --list prints waves 0 to 3', () => {
  assert.equal(run([]).status, 64);
  assert.equal(run(['9']).status, 64);
  const l = run(['--list']);
  assert.equal(l.status, 0);
  for (const w of ['0 plant-p1-overspeed', '1 plant-p1-overspeed', '2 plant-p2', '3 plant-p3']) assert.ok(l.stdout.includes(w), l.stdout);
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
