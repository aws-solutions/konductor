// SPDX-License-Identifier: Apache-2.0
'use strict';

// claude-code-smoke.sh with a fake claude and a fake aws: no network, no cloud credentials, no real Claude Code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'claude-code-smoke.sh');
const FX = path.join(__dirname, 'fixtures', 'claude-code');
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';
const ACCOUNT = '123456789012';

// A fake aws: `configure export-credentials` prints env lines for the profile "good"; `sts get-caller-identity` answers
// only when the exported keys are present and no profile variable is, as the real SDK does in export mode.
const FAKE_AWS = `#!/bin/sh
case "$1 $2" in
  "configure export-credentials")
    [ "$3" = "--profile" ] && [ "$4" = "good" ] || { echo "profile not found" >&2; exit 255; }
    echo "export AWS_ACCESS_KEY_ID=${KEY_ID}"
    echo "export AWS_SECRET_ACCESS_KEY=${SECRET}"
    echo "export AWS_SESSION_TOKEN=${TOKEN}"
    ;;
  "sts get-caller-identity")
    [ -n "$AWS_ACCESS_KEY_ID" ] && [ -z "$AWS_PROFILE" ] || exit 255
    echo "\${FAKE_AWS_ACCOUNT:-${ACCOUNT}}"
    ;;
  *) exit 2 ;;
esac
`;

function setup(stream = 'vanilla-success', cfg = {}) {
  const root = tmp();
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const claudeTmp = path.join(root, 'claude-tmp');
  fs.mkdirSync(claudeTmp);
  const scratchRoot = path.join(root, 'scratch-root');
  fs.mkdirSync(scratchRoot);
  const bin = makeFakeClaude(path.join(root, 'tools'), { dir: probe, streamFile: path.join(FX, `${stream}.stream.jsonl`), helloText: 'hi\n', ...cfg });
  write(path.join(root, 'bin', 'aws'), FAKE_AWS);
  fs.chmodSync(path.join(root, 'bin', 'aws'), 0o755);
  return { root, probe, claudeTmp, scratchRoot, bin, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function smoke(s, args, env = {}) {
  return spawnSync('bash', [SCRIPT, '--claude-bin', s.bin, ...args], {
    encoding: 'utf8', timeout: 120000,
    env: {
      PATH: `${path.join(s.root, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      SMOKE_SCRATCH_ROOT: s.scratchRoot, SMOKE_CLAUDE_TMP_BASE: s.claudeTmp, ...env,
    },
  });
}
const started = (s) => fs.existsSync(path.join(s.probe, 'started.json'));
const noSecrets = (r) => { for (const v of [SECRET, TOKEN, KEY_ID]) { assert.equal(r.stdout.includes(v), false); assert.equal(r.stderr.includes(v), false); } };

test('--dry-run prints the plan, needs no credentials, starts nothing and removes its scratch directory', () => {
  const s = setup();
  try {
    const r = smoke(s, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dry run: no credentials are read and nothing is started/);
    assert.match(r.stdout, /--tasks smoke-hello --arms cc-vanilla/);
    assert.match(r.stdout, /--tasks smoke-delegate --arms cc-smoke=[0-9a-f]{40}/);
    assert.match(r.stdout, /--budget-usd 1\.5 --run-budget-usd 0\.6 --aws-region us-east-1/);
    assert.equal(started(s), false);
    assert.deepEqual(fs.readdirSync(s.scratchRoot), []);
    noSecrets(r);
  } finally {
    s.cleanup();
  }
});

test('vanilla smoke end to end: credentials exported from a profile, every criterion passes, nothing is left', () => {
  const s = setup();
  try {
    const r = smoke(s, ['--profile', 'good', '--only', 'vanilla', '--isolate', 'none', '--account', ACCOUNT]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS credential preflight under claude's environment: account \*\*\*\*9012/);
    for (const re of [/PASS {2}vanilla: result\.json parses/, /PASS {2}vanilla: result\.json matches the schema/, /PASS {2}vanilla: run succeeded/, /PASS {2}vanilla: cost > 0 and not censored/,
      /PASS {2}vanilla: one canonical model \(claude-sonnet-5-5; expected claude-sonnet-5-5\)/, /PASS {2}vanilla: task checks passed/, /PASS {2}vanilla: no credential value in any output file/,
      /PASS {2}nothing new in/, /PASS {2}nothing left in the run scratch directory/, /SMOKE: PASS/]) assert.match(r.stdout, re);
    assert.match(r.stdout, /INFO {2}claude's task directory was found under the run TMPDIR/);
    assert.equal(started(s), true);
    assert.equal(fs.readdirSync(s.scratchRoot).length, 0, 'the scratch directory is removed');
    assert.deepEqual(fs.readdirSync(s.claudeTmp), []);
    noSecrets(r);
  } finally {
    s.cleanup();
  }
});

test('credentials already exported in the shell are used and no profile is needed', () => {
  const s = setup();
  try {
    const r = smoke(s, ['--only', 'vanilla', '--isolate', 'none'], { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: TOKEN, AWS_PROFILE: 'ignored' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /using the AWS credentials already exported in this shell/);
    assert.match(r.stdout, /AWS_PROFILE set here and not passed to claude/);
    noSecrets(r);
  } finally {
    s.cleanup();
  }
});

test('a task directory claude leaves in the default temp dir is reported as a failure and removed on exit', () => {
  const s = setup('vanilla-success', { tmpBases: [path.join(__dirname, 'unused')] });
  const cfgFile = path.join(path.dirname(s.bin), 'fake-claude.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.tmpBases = [s.claudeTmp];
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  try {
    const r = smoke(s, ['--profile', 'good', '--only', 'vanilla', '--isolate', 'none']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL {2}new entries in .*claude-\d+ \(removed on exit\)/);
    assert.match(r.stdout, /SMOKE: FAIL/);
    assert.deepEqual(fs.readdirSync(s.claudeTmp), [], 'the new entries are removed');
    assert.equal(fs.readdirSync(s.scratchRoot).length, 0);
  } finally {
    s.cleanup();
  }
});

test('a failing run fails the smoke with the reason, and the script still cleans up', () => {
  const s = setup('model-400', { exitCode: 1 });
  try {
    const r = smoke(s, ['--profile', 'good', '--only', 'vanilla', '--isolate', 'none']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL {2}vanilla: run succeeded/);
    assert.match(r.stdout, /FAIL {2}vanilla: cost > 0 and not censored/);
    assert.match(r.stdout, /SMOKE: FAIL/);
    assert.equal(fs.readdirSync(s.scratchRoot).length, 0);
    noSecrets(r);
  } finally {
    s.cleanup();
  }
});

test('preflight refuses the wrong account, a missing credential source and a launcher before claude starts', () => {
  const s = setup();
  try {
    const wrong = smoke(s, ['--profile', 'good', '--only', 'vanilla', '--account', '999999999999'], { FAKE_AWS_ACCOUNT: ACCOUNT });
    assert.equal(wrong.status, 2);
    assert.match(wrong.stdout + wrong.stderr, /credentials resolve to account \*\*\*\*9012, expected \*\*\*\*9999/);
    const none = smoke(s, ['--only', 'vanilla']);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no credentials: pass --profile NAME/);
    const bad = smoke(s, ['--profile', 'nope', '--only', 'vanilla']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /aws configure export-credentials failed for profile nope/);
    const launcher = path.join(s.root, 'launcher', 'claude');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const w = spawnSync('bash', [SCRIPT, '--claude-bin', launcher, '--profile', 'good', '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, SMOKE_SCRATCH_ROOT: s.scratchRoot } });
    assert.equal(w.status, 2);
    assert.match(w.stdout + w.stderr, /this is a launcher, not the claude binary/);
    const noSource = spawnSync('bash', [SCRIPT, '--profile', 'good', '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, SMOKE_SCRATCH_ROOT: s.scratchRoot } });
    assert.equal(noSource.status, 2);
    assert.match(noSource.stdout + noSource.stderr, /pass --claude-bin PATH or --claude-tools-dir DIR/);
    const viaDir = spawnSync('bash', [SCRIPT, '--claude-tools-dir', path.join(s.root, 'tools'), '--profile', 'good', '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, SMOKE_SCRATCH_ROOT: s.scratchRoot } });
    assert.equal(viaDir.status, 0, viaDir.stderr);
    assert.match(viaDir.stdout, /claude 9\.9\.9 at /);
    assert.equal(started(s), false, 'claude was never started');
    assert.equal(fs.readdirSync(s.scratchRoot).length, 0);
    for (const r of [wrong, none, bad, w, noSource, viaDir]) noSecrets(r);
  } finally {
    s.cleanup();
  }
});

test('bad options stop the script with a usage error', () => {
  const s = setup();
  try {
    assert.equal(smoke(s, ['--bogus']).status, 2);
    assert.match(smoke(s, ['--only', 'sideways']).stderr, /--only takes vanilla, konductor or both/);
    assert.match(smoke(s, ['--arm', 'smoke=abc', '--dry-run']).stderr, /--arm must start with cc-/);
    const help = smoke(s, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /RUN IT FROM YOUR OWN TERMINAL/);
  } finally {
    s.cleanup();
  }
});

test('the script passes shellcheck at style level when shellcheck is installed', (t) => {
  const r = spawnSync('shellcheck', ['-S', 'style', SCRIPT], { encoding: 'utf8' });
  if (r.error) { t.skip('shellcheck is not installed'); return; }
  assert.equal(r.status, 0, r.stdout);
});

const TARGET = process.env.KD_SMOKE_CARGO_TARGET;
const realHome = require('node:os').userInfo().homedir;
test('both tasks with a real konductor build (opt-in: KD_SMOKE_CARGO_TARGET names a warm cargo target directory)', { skip: TARGET ? false : 'set KD_SMOKE_CARGO_TARGET to run' }, () => {
  const s = setup('delegation-dashed-pin');
  try {
    const r = smoke(s, ['--profile', 'good', '--isolate', 'none', '--cargo-target', TARGET, '--cache', path.join(s.root, 'cache')], { CARGO_HOME: path.join(realHome, '.cargo'), RUSTUP_HOME: path.join(realHome, '.rustup') });
    assert.match(r.stdout, /PASS {2}konductor: delegated at least once, no failed spawn/, r.stderr.slice(-1500));
    assert.match(r.stdout, /PASS {2}konductor: 11 agents installed, all pinned to the canonical model/);
    noSecrets(r);
  } finally {
    s.cleanup();
  }
});
