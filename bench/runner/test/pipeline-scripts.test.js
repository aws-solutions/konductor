// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/{run-real-pilot,run-after-capability,run-judging,monitor}.sh against a fake runner and a fake state
// directory. No model, no network, no real credentials. Every spawn gets a scratch HOME and a TMPDIR without "bench".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sandbox, pilotEnv, SCRIPTS, out, read, until, opts } = require('./pipeline-helpers.js');

const SCRIPT_NAMES = ['run-real-pilot.sh', 'run-after-capability.sh', 'run-judging.sh', 'monitor.sh'];
const HAS_SHELLCHECK = spawnSync('shellcheck', ['--version']).status === 0;

// ---------------------------------------------------------------- syntax and usage

for (const name of SCRIPT_NAMES) {
  test(`${name}: bash -n passes, it starts with a bash shebang and is executable`, () => {
    const file = path.join(SCRIPTS, name);
    assert.equal(spawnSync('bash', ['-n', file]).status, 0);
    assert.match(fs.readFileSync(file, 'utf8'), /^#!\/usr\/bin\/env bash\n/);
    assert.ok(fs.statSync(file).mode & 0o111, 'executable bit');
  });

  test(`${name}: shellcheck reports no warnings`, { skip: HAS_SHELLCHECK ? false : 'shellcheck is not installed' }, () => {
    const r = spawnSync('shellcheck', ['-x', '-S', 'warning', path.join(SCRIPTS, name)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
  });

  test(`${name}: --help prints the usage and exits 0; an unknown option exits 2`, opts, () => {
    const s = sandbox();
    try {
      const h = s.spawn(name, ['--help']);
      assert.equal(h.status, 0, out(h));
      assert.ok(h.stdout.includes(name.replace(/\.sh$/, '')), h.stdout.slice(0, 200));
      assert.doesNotMatch(h.stdout, /^set -u/m);
      const bad = s.spawn(name, ['--no-such-option'], { STUDY: s.root });
      assert.equal(bad.status, 2, out(bad));
      assert.match(out(bad), /unknown option/);
    } finally { s.done(); }
  });
}

// ---------------------------------------------------------------- run-real-pilot.sh

test('run-real-pilot: a dry run prints the plan from the task file, the default arms and the exact commands, and writes no study', opts, () => {
  const s = sandbox();
  try {
    const r = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s));
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /ARMS : vanilla,main/);
    assert.match(r.stdout, /TASKS: 2 task dirs x 6 runs = 12 runs/);
    assert.match(r.stdout, /1\. real-real-one {2}runs=6 timeout=60s/);
    assert.match(r.stdout, /--suite pilot --tasks lite-one --arms vanilla\\?,main --profile detailed/);
    assert.match(r.stdout, /--real-cache \S+realrepos/);
    assert.equal(fs.existsSync(path.join(s.state, 'real-pilot.study')), false);
    assert.deepEqual(fs.readdirSync(s.results), []);
    assert.deepEqual(s.callLines(), [], 'the fake runner was not called');
  } finally { s.done(); }
});

test('run-real-pilot: ORCH_DIR adds the arm under test and the A/A repeat, and the run count follows', opts, () => {
  const s = sandbox();
  try {
    const wt = s.dir('wt');
    s.git(['worktree', 'add', '-q', '--detach', wt]);
    const r = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { ORCH_DIR: wt }));
    assert.equal(r.status, 0, out(r));
    assert.ok(r.stdout.includes(`ARMS : vanilla,orch-all=dir:${wt},main`), r.stdout);
    assert.match(r.stdout, /2 task dirs x 8 runs = 16 runs/);
    assert.match(r.stdout, /ORCH_DIR HEAD [0-9a-f]{8} \(EXPECT_ORCH_SHA unset, pinned at launch\)/);
  } finally { s.done(); }
});

test('run-real-pilot: pins refuse a wrong branch or commit, and an unset pin is not checked', opts, () => {
  const s = sandbox();
  try {
    const wrongBranch = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { EXPECT_BRANCH: 'no-such-branch' }));
    assert.notEqual(wrongBranch.status, 0);
    assert.match(out(wrongBranch), /branch is 'work', expected no-such-branch/);
    const wrongMain = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { EXPECT_MAIN_SHA: 'deadbee' }));
    assert.notEqual(wrongMain.status, 0);
    assert.match(out(wrongMain), /origin\/main is '[0-9a-f]{7}', expected deadbee/);
    const ok = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { EXPECT_BRANCH: 'work' }));
    assert.equal(ok.status, 0, out(ok));
  } finally { s.done(); }
});

test('run-real-pilot: a missing task file, real-repo cache or cargo target is a preflight failure with a hint', opts, () => {
  const s = sandbox();
  try {
    const r = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { TASKS_FILE: path.join(s.root, 'nope.txt'), CARGO_TARGET: path.join(s.root, 'no-cargo'), REAL_CACHE: path.join(s.root, 'no-cache') }));
    assert.notEqual(r.status, 0);
    assert.match(out(r), /no tasks: .*nope\.txt is missing or empty/);
    assert.match(out(r), /cargo target missing: .*no-cargo \(create it or set CARGO_TARGET\)/);
    const r2 = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { REAL_CACHE: path.join(s.root, 'no-cache') }));
    assert.match(out(r2), /real-repo cache missing for real-one \(node bench\/real\/fetch\.js --cache /);
  } finally { s.done(); }
});

test('run-real-pilot: autonomy tasks are skipped until the marker proves the tier, and AUTONOMY=1 forces them on', opts, () => {
  const s = sandbox();
  try {
    s.write('tasks.txt', 'pilot|lite-one|60|lite|100\npilot|autonomy-one|60|auton|100\n');
    const r = s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s));
    assert.match(r.stdout, /TASKS: 1 task dirs/);
    assert.match(r.stdout, /SKIPPED \(autonomy tier unsupported on engine v3\): autonomy-one/);
    fs.writeFileSync(path.join(s.state, 'real-pilot.autonomy-v3'), 'supported: test\n');
    assert.match(s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s)).stdout, /TASKS: 2 task dirs/);
    fs.rmSync(path.join(s.state, 'real-pilot.autonomy-v3'));
    assert.match(s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { AUTONOMY: '1' })).stdout, /TASKS: 2 task dirs/);
    assert.match(s.spawn('run-real-pilot.sh', ['--dry-run'], pilotEnv(s, { AUTONOMY: '0' })).stdout, /TASKS: 1 task dirs/);
  } finally { s.done(); }
});

test('run-real-pilot: a foreground run with the fake runner completes every task, writes the pre-judge reports, and a rerun skips complete dirs', opts, () => {
  const s = sandbox();
  try {
    const env = pilotEnv(s);
    const r = s.spawn('run-real-pilot.sh', ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /DONE: 2\/2 task dirs complete/);
    const study = fs.readFileSync(path.join(s.state, 'real-pilot.study'), 'utf8').trim();
    for (const d of ['real-real-one', 'pilot-lite-one']) assert.ok(fs.existsSync(path.join(study, d, 'summary.json')), d);
    const calls = s.callLines();
    assert.equal(calls.filter((c) => c.startsWith('run ') && !c.includes('--prepare-only')).length, 2);
    assert.ok(calls.some((c) => c.startsWith('run --suite real --tasks real-one ') && c.includes('--prepare-only')), 'prepare-only used the first task');
    assert.ok(calls.some((c) => /^report .*--verdict orchestrator-pass/.test(c)));
    assert.ok(calls.some((c) => /^report .*--verdict platform/.test(c)));
    assert.equal(fs.existsSync(path.join(s.state, 'real-pilot.pid')), false, 'the pid file is removed');
    assert.deepEqual(fs.readdirSync(s.tmp), [], 'scratch dirs are removed');
    const again = s.spawn('run-real-pilot.sh', ['--foreground'], env);
    assert.equal(again.status, 0, out(again));
    assert.match(again.stdout, /resuming study/);
    assert.match(read(path.join(s.state, 'real-pilot.log')) + again.stdout, /already complete, skipping/);
    const status = s.spawn('run-real-pilot.sh', ['--status'], env);
    assert.equal(status.status, 0);
    assert.match(status.stdout, /tasks done: 2\/2/);
    assert.match(status.stdout, /daemon: not running/);
  } finally { s.done(); }
});

test('run-real-pilot: the default mode daemonizes, logs to the state dir and removes its pid file', { ...opts, timeout: 60000 }, async () => {
  const s = sandbox();
  try {
    const env = pilotEnv(s);
    const r = s.spawn('run-real-pilot.sh', [], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /LAUNCHED: pid \d+/);
    const log = path.join(s.state, 'real-pilot.log');
    assert.ok(await until(() => /DONE: 2\/2/.test(read(log)) && !fs.existsSync(path.join(s.state, 'real-pilot.pid'))), read(log));
    assert.match(s.spawn('run-real-pilot.sh', ['--stop'], env).stdout, /not running/);
  } finally { s.done(); }
});

test('run-real-pilot: SMOKE=1 runs the first real task, skips the probe without PROBE_BENCH, and never touches a study dir', opts, () => {
  const s = sandbox();
  try {
    const r = s.spawn('run-real-pilot.sh', [], pilotEnv(s, { SMOKE: '1' }));
    assert.match(out(r), /smoke 1\/3: real task real-one/);
    assert.match(out(r), /smoke 2\/3: skipped, PROBE_BENCH is not set/);
    assert.match(out(r), /smoke 3\/3: skipped, no auton task/);
    assert.ok(s.callLines().some((c) => c.startsWith('run --suite real --tasks real-one --arms vanilla --profile quick --replicates 1')));
    assert.equal(fs.existsSync(path.join(s.state, 'real-pilot.study')), false);
    assert.equal(fs.existsSync(path.join(s.state, 'real-pilot.autonomy-v3')), false, 'the marker is left alone without a probe');
  } finally { s.done(); }
});
