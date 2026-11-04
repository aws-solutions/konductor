// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/run-skill-bench.sh: refusals, preflight, dry run, status and stop. The script is never launched for real
// here: --dry-run and --preflight start no study and call no model. Every spawn gets a scratch HOME.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { env: studyEnv, withRuns } = require('./cap-study-helpers.js');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'run-skill-bench.sh');
const REPO = path.join(__dirname, '..', '..', '..');

function sandbox() {
  const e = studyEnv();
  const state = path.join(e.root, 'state');
  const results = path.join(e.root, 'results');
  const home = path.join(e.root, 'home');
  const tmp = path.join(e.root, 'tmp');
  for (const d of [state, results, home, tmp]) fs.mkdirSync(d, { recursive: true });
  const creds = path.join(e.root, 'creds');
  fs.writeFileSync(creds, 'placeholder');
  const base = {
    PATH: process.env.PATH, HOME: home, TMPDIR: tmp, STATE_DIR: state, RESULTS: results, REPO: e.repo, BENCH_DIR: e.bench, BASE_REF: 'v0', CREDS: creds,
    BENCH_PROC_PATTERN: 'no-such-bench-process-pattern', NO_KIRO_CHECK: '1', NO_OPENCODE_CHECK: '1', MIN_FREE_GB: '0', SCRATCH_PARENT: tmp,
    RUNS_GLOBS: '', EXPOSURE_RUNS: withRuns(e, { tasks: ['rev-one', 'hid-one'] }), CLI_JS: path.join(REPO, 'bench', 'runner', 'bench.js'),
  };
  const run = (args, over = {}) => spawnSync('bash', [SCRIPT, ...args], { env: { ...base, ...over }, encoding: 'utf8', cwd: e.root });
  return { e, state, results, creds, base, run, done: () => e.done() };
}

const sleeper = () => spawn('sleep', ['60'], { stdio: 'ignore' });

test('--help prints the usage and exits 0 without doing anything', () => {
  const s = sandbox();
  try {
    const r = s.run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /run-skill-bench\.sh/);
    assert.match(r.stdout, /--tier triage\|loaded\|large\|duplicates\|all/);
    assert.deepEqual(fs.readdirSync(s.results), []);
  } finally { s.done(); }
});

test('an unknown option is refused with exit 2', () => {
  const s = sandbox();
  try {
    const r = s.run(['--nope']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown option/);
  } finally { s.done(); }
});

test('it refuses while the capability study daemon is alive, and says the study must finish first', () => {
  const s = sandbox();
  const p = sleeper();
  try {
    fs.writeFileSync(path.join(s.state, 'real-pilot.pid'), `${p.pid}\n`);
    for (const mode of ['--preflight', '--dry-run']) {
      const r = s.run([mode]);
      assert.notEqual(r.status, 0, mode);
      assert.match(r.stdout + r.stderr, /another bench study is active/i);
      assert.match(r.stdout + r.stderr, /capability study/i);
    }
  } finally { p.kill(); s.done(); }
});

test('a stale pid file does not block it, and its own live pid file does', () => {
  const s = sandbox();
  const p = spawn('bash', ['-c', 'exec -a run-skill-bench-fake sleep 60'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(s.state, 'real-pilot.pid'), '999999\n');
    assert.equal(s.run(['--preflight']).status, 0);
    fs.rmSync(path.join(s.state, 'real-pilot.pid'));
    fs.writeFileSync(path.join(s.state, 'skill-bench.pid'), `${p.pid}\n`);
    const r = s.run(['--preflight']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /already running/);
  } finally { p.kill(); s.done(); }
});

test('it refuses while any bench.js process matches the process pattern', () => {
  const s = sandbox();
  const p = spawn('bash', ['-c', 'exec -a fake-bench-marker-xyz sleep 60'], { stdio: 'ignore' });
  try {
    const r = s.run(['--preflight'], { BENCH_PROC_PATTERN: 'fake-bench-marker-xyz' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /another bench study is active/i);
  } finally { p.kill(); s.done(); }
});

test('the credentials file is checked first: missing or empty fails a real launch, and a dry run only warns', () => {
  const s = sandbox();
  try {
    fs.rmSync(s.creds);
    const r = s.run(['--preflight']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /credentials file .* is missing or empty/);
    fs.writeFileSync(s.creds, '');
    assert.notEqual(s.run(['--preflight']).status, 0);
    const d = s.run(['--dry-run']);
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /WARN.*credentials file/);
    const unset = s.run(['--preflight'], { CREDS: '' });
    assert.notEqual(unset.status, 0);
  } finally { s.done(); }
});

test('an expired credentials file is refused using the expiry knob, and the file contents are never printed', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.creds, 'SECRET-TOKEN-VALUE');
    const r = s.run(['--preflight'], { CREDS_EXPIRY_UTC: '2000-01-01T00:00:00Z' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /expired/);
    const ok = s.run(['--preflight'], { CREDS_EXPIRY_UTC: '2999-01-01T00:00:00Z' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(r.stdout + r.stderr + ok.stdout + ok.stderr, /SECRET-TOKEN-VALUE/);
  } finally { s.done(); }
});

test('a dry run with no study prints the plan for the chosen tier and builds and writes nothing', () => {
  const s = sandbox();
  try {
    const r = s.run(['--dry-run', '--tier', 'loaded', '--skills', 'sectioned']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /Per-skill study plan/);
    assert.match(r.stdout, /sectioned/);
    assert.deepEqual(fs.readdirSync(s.results), []);
    assert.equal(fs.existsSync(path.join(s.state, 'skill-bench.study')), false);
    assert.equal(fs.existsSync(path.join(s.state, 'skill-bench.pid')), false);
  } finally { s.done(); }
});

test('a dry run with an existing study prints its waves and exact commands', () => {
  const s = sandbox();
  try {
    const study = path.join(s.results, 'skill-bench-test');
    const init = spawnSync(process.execPath, [path.join(REPO, 'bench/runner/bench.js'), 'cap', 'skill-study', '--init', '--study', study, '--base', 'v0', '--repo-root', s.e.repo, '--bench-dir', s.e.bench,
      '--runs', s.base.EXPOSURE_RUNS, '--only', 'sectioned', '--tasks-per-skill', '2', '--reps', '5', '--aws-creds-file', s.creds, '--scratch', path.join(s.e.root, 'scratch')], { env: { PATH: process.env.PATH, HOME: s.base.HOME, TMPDIR: s.base.TMPDIR, BENCH_CAP_INSTALLS_HOMES: s.base.HOME }, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    fs.writeFileSync(path.join(s.state, 'skill-bench.study'), `${study}\n`);
    const r = s.run(['--dry-run'], { BENCH_CAP_INSTALLS_HOMES: s.base.HOME });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /sectioned wave 1: arms ctl, ctl-b, del/);
    assert.match(r.stdout, /study dir: /);
  } finally { s.done(); }
});

test('--status says whether the daemon runs and shows the log tail; --stop on a missing daemon says so', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(path.join(s.state, 'skill-bench.log'), 'line one\nline two\n');
    const st = s.run(['--status']);
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /daemon: not running/);
    assert.match(st.stdout, /line two/);
    const stop = s.run(['--stop']);
    assert.equal(stop.status, 0);
    assert.match(stop.stdout, /not running/);
  } finally { s.done(); }
});

test('--stop signals only a live daemon recorded in its own pid file', () => {
  const s = sandbox();
  const p = spawn('bash', ['-c', 'exec -a run-skill-bench-fake sleep 60'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(s.state, 'skill-bench.pid'), `${p.pid}\n`);
    const r = s.run(['--stop']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /sent SIGTERM to \d+/);
  } finally { p.kill(); s.done(); }
});

test('the script keeps the repo clean and has no real credentials or machine paths in it', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(text, /\/home\/[a-z]+\//);
  assert.match(text, /^#!\/usr\/bin\/env bash/);
});

test('a foreground run plans every skill at init and applies the tier and skill filters when it runs (fake runner, nothing launched)', () => {
  const s = sandbox();
  try {
    const log = path.join(s.e.root, 'calls.log');
    const fake = path.join(s.e.root, 'fake-cli.js');
    fs.writeFileSync(fake, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`);
    const r = s.run(['--foreground', '--tier', 'loaded', '--skills', 'sectioned'], { CLI_JS: fake });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /cap skill-study --init --study /);
    assert.doesNotMatch(calls[0], /--tier|--only/);
    assert.match(calls[0], /--screen/);
    assert.match(calls[1], /cap skill-study --study .* --tier loaded --only sectioned/);
    assert.match(calls[1], new RegExp(`--aws-creds-file ${s.creds}`));
    assert.equal(fs.existsSync(path.join(s.state, 'skill-bench.pid')), false, 'the pid file is removed when the run ends');
    assert.match(fs.readFileSync(path.join(s.state, 'skill-bench.study'), 'utf8'), /skill-bench-/);
  } finally { s.done(); }
});

test('every runner call gets the real toolchain dirs and the cache and cargo-target flags (fake runner that records its env)', () => {
  const s = sandbox();
  try {
    const log = path.join(s.e.root, 'env.log');
    const fake = path.join(s.e.root, 'fake-env-cli.js');
    fs.writeFileSync(fake, `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, cargo: process.env.CARGO_HOME, rustup: process.env.RUSTUP_HOME }) + '\\n');`);
    const r = s.run(['--foreground', '--skills', 'sectioned'], { CLI_JS: fake });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 2);
    const realHome = os.userInfo().homedir;
    for (const c of calls) {
      assert.equal(c.cargo, path.join(realHome, '.cargo'));
      assert.equal(c.rustup, path.join(realHome, '.rustup'));
      assert.notEqual(c.home, realHome, 'the scratch HOME is still used');
      assert.equal(c.argv[c.argv.indexOf('--cache') + 1], path.join(s.state, 'cache'));
      assert.equal(c.argv[c.argv.indexOf('--cargo-target') + 1], path.join(s.state, 'cargo-target'));
    }
  } finally { s.done(); }
});

test('CACHE and CARGO_TARGET override the default cache and cargo-target locations', () => {
  const s = sandbox();
  try {
    const log = path.join(s.e.root, 'calls.log');
    const fake = path.join(s.e.root, 'fake-cli.js');
    fs.writeFileSync(fake, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`);
    const r = s.run(['--foreground', '--skills', 'sectioned'], { CLI_JS: fake, CACHE: path.join(s.e.root, 'my-cache'), CARGO_TARGET: path.join(s.e.root, 'my-target') });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const line of fs.readFileSync(log, 'utf8').trim().split('\n')) {
      assert.ok(line.includes(`--cache ${path.join(s.e.root, 'my-cache')} `), line);
      assert.ok(line.includes(`--cargo-target ${path.join(s.e.root, 'my-target')}`), line);
    }
  } finally { s.done(); }
});

test('the default mode daemonizes: it returns at once, the child runs the study, logs to the log file and removes its pid file', async () => {
  const s = sandbox();
  try {
    const log = path.join(s.e.root, 'calls.log');
    const fake = path.join(s.e.root, 'fake-cli.js');
    fs.writeFileSync(fake, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`);
    const r = s.run([], { CLI_JS: fake });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /LAUNCHED: pid \d+/);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !(fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim().split('\n').length >= 2 && !fs.existsSync(path.join(s.state, 'skill-bench.pid')))) await new Promise((res) => setTimeout(res, 100));
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2);
    assert.match(fs.readFileSync(path.join(s.state, 'skill-bench.log'), 'utf8'), /DONE: decisions are in/);
  } finally { s.done(); }
});

test('SIGTERM while the runner is busy: the script waits for the runner to finish, then removes its scratch dirs', async () => {
  const s = sandbox();
  try {
    const fake = path.join(s.e.root, 'slow-cli.js');
    const marker = path.join(s.e.root, 'started');
    const flushed = path.join(s.e.root, 'flushed');
    fs.writeFileSync(fake, `
const fs = require('fs'), path = require('path');
if (fs.existsSync(${JSON.stringify(marker)})) process.exit(0);
fs.writeFileSync(${JSON.stringify(marker)}, 'x');
process.on('SIGTERM', () => setTimeout(() => {
  fs.writeFileSync(path.join(process.env.TMPDIR, 'late'), 'x');
  fs.writeFileSync(${JSON.stringify(flushed)}, 'x');
  process.exit(0);
}, 700));
setInterval(() => {}, 1000);
`);
    const p = spawn('bash', [SCRIPT, '--dry-run'], { env: { ...s.base, CLI_JS: fake }, cwd: s.e.root, stdio: 'ignore' });
    const exited = new Promise((resolve) => p.on('exit', resolve));
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(marker), 'the runner started');
    p.kill('SIGTERM');
    await exited;
    assert.ok(fs.existsSync(flushed), 'the runner flushed while its TMPDIR still existed');
    assert.deepEqual(fs.readdirSync(s.base.TMPDIR).filter((n) => n.startsWith('xq')), []);
  } finally { s.done(); }
});
