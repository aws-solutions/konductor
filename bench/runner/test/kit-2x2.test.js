// SPDX-License-Identifier: Apache-2.0
'use strict';

// The 2x2 run kits (bench/kit/2x2): syntax of every script, the free commands that need no AWS, no model and no
// sandbox (`split-check`, `missing`, the usage text), the refusals that fire before anything is spent, and `gate` on
// fake results in a throw-away git repo. Nothing here starts bench, a model or a cloud call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { findMarker } = require('../../cap/public.js');

const KIT = path.join(__dirname, '..', '..', 'kit', '2x2');
const PROBE = path.join(__dirname, '..', '..', 'kit', 'probes', 'pr312-skill-access');
const SCRIPTS = fs.readdirSync(KIT).filter((f) => f.endsWith('.sh'));
const KITS = ['run-2x2.sh', 'run-2x2-kiro.sh'];

// Patterns are built from parts so this file does not match itself.
const j = (...p) => p.join('');
const HOST_MARKERS = [
  ['a host path', new RegExp(`${j('/lo', 'cal/home')}|${j('/ho', 'me/')}[a-z]|${j('/var/tmp/k', '2x')}|${j('/var/tmp/k', '3')}`)],
  ['a login name', new RegExp(j('nihit', 'kas'))],
];

// An environment with no AWS, no Kiro and no study variables from the caller's shell.
function cleanEnv(extra = {}) {
  const env = {};
  for (const k of ['PATH', 'HOME', 'LANG']) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}
function sh(script, args, env, opts = {}) {
  return spawnSync('bash', [path.join(KIT, script), ...args], { encoding: 'utf8', env: cleanEnv(env), timeout: 60000, ...opts });
}
const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

test('every kit script passes bash -n, has an SPDX line 2, and names no host path, login or internal tool', () => {
  assert.ok(SCRIPTS.length >= 5, SCRIPTS.join(','));
  const probe = path.join(PROBE, 'run-probe.sh');
  for (const file of [...SCRIPTS.map((f) => path.join(KIT, f)), probe]) {
    const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    assert.match(lines[0], /^#!/, file);
    assert.equal(lines[1], '# SPDX-License-Identifier: Apache-2.0', file);
  }
  const files = [...fs.readdirSync(KIT).map((f) => path.join(KIT, f)), ...fs.readdirSync(PROBE).filter((f) => !fs.statSync(path.join(PROBE, f)).isDirectory()).map((f) => path.join(PROBE, f))];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, re] of HOST_MARKERS) assert.doesNotMatch(text, re, `${file} holds ${name}`);
    text.split('\n').forEach((line, n) => assert.equal(findMarker(line), null, `${file}:${n + 1} names something internal or a credential`));
  }
});

test('shellcheck passes on every kit script when shellcheck is installed', (t) => {
  const has = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  if (has.error || has.status !== 0) return t.skip('shellcheck is not installed');
  const r = spawnSync('shellcheck', ['-S', 'warning', ...SCRIPTS.map((f) => path.join(KIT, f)), path.join(PROBE, 'run-probe.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

for (const kit of KITS) {
  test(`${kit}: split-check recomputes the SR-32 split and passes on the recorded lists`, () => {
    const root = tmp();
    const r = sh(kit, ['split-check'], { S: root });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /split ok: 5 DEV, 17 HELD-OUT, by the recorded hash rule/);
  });

  test(`${kit}: split-check refuses a list edited to move a task from HELD-OUT to DEV`, () => {
    const root = tmp();
    const copy = path.join(root, 'kit');
    fs.mkdirSync(copy);
    for (const f of fs.readdirSync(KIT)) fs.copyFileSync(path.join(KIT, f), path.join(copy, f));
    const file = path.join(copy, kit);
    const text = fs.readFileSync(file, 'utf8');
    // Move the first HELD-OUT task id into the DEV list: the recorded hash rule must refuse it.
    const edited = text.replace('DEV=("sdlc-prod-readiness,sdlc-problem-framing"', 'DEV=("hard-seat-holds,sdlc-prod-readiness,sdlc-problem-framing"');
    assert.notEqual(edited, text, 'the DEV list line was not found; update this test with the kit');
    fs.writeFileSync(file, edited);
    const r = spawnSync('bash', [file, 'split-check'], { encoding: 'utf8', env: cleanEnv({ S: path.join(root, 'study') }) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /split edited: hard-seat-holds listed DEV/);
  });

  test(`${kit}: reads its pins and caps from its study file and refuses one with a constant left unset (D-49)`, () => {
    const text = fs.readFileSync(path.join(KIT, kit), 'utf8');
    for (const re of [/^KBIN_SHA=/m, /^PANEL=/m, /^CAP\d_CR=/m, /^SEED=/m]) assert.doesNotMatch(text, re, `${kit} still sets ${re}`);
    const env = kit === 'run-2x2.sh' ? 'study-2x2.env' : 'study-2x2-kiro.env';
    for (const name of ['KBIN_SHA', 'PANEL', 'RUN_CAP_USD']) {
      const root = tmp();
      const study = path.join(root, 'study.env');
      fs.writeFileSync(study, fs.readFileSync(path.join(KIT, env), 'utf8').replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=`));
      const r = sh(kit, ['split-check'], { S: path.join(root, 's'), STUDY_ENV: study });
      assert.equal(r.status, 2, name);
      assert.match(r.stderr, new RegExp(`${name} is not set in`), name);
    }
  });

  test(`${kit}: with no S or KIT_DIR it refuses to start, and a bare call prints its usage`, () => {
    const none = sh(kit, ['split-check'], {});
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /set S \(the study directory\) or KIT_DIR/);
    const root = tmp();
    const usage = sh(kit, [], { KIT_DIR: path.join(root, 'k') });
    assert.equal(usage.status, 2);
    assert.match(usage.stdout + usage.stderr, /split-check|usage/);
    assert.ok(fs.existsSync(path.join(root, 'k', 'tmp')), 'KIT_DIR stands in for S');
  });

  test(`${kit}: commands that need a worktree refuse without R, and refuse a kit that sits inside R`, () => {
    const root = tmp();
    const env = { S: path.join(root, 'study'), AWSP: 'some-profile-name' };
    for (const cmd of ['check', 'freeze', 'gate']) {
      const r = sh(kit, [cmd, '1'], env);
      assert.equal(r.status, 2, cmd);
      assert.match(r.stderr, /set R to a dedicated konductor git worktree/, cmd);
    }
    // A kit copied into R is refused: freeze checks out another commit in R and would replace the running script.
    const repo = path.join(root, 'r');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    const inside = path.join(repo, 'kit');
    fs.mkdirSync(inside);
    for (const f of fs.readdirSync(KIT)) fs.copyFileSync(path.join(KIT, f), path.join(inside, f));
    const r = spawnSync('bash', [path.join(inside, kit), 'freeze'], { encoding: 'utf8', env: cleanEnv({ ...env, R: repo }) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /run the kit from a copy outside/);
  });
}

test('run-2x2.sh: a paid stage refuses without AWSP and a Claude Code stage refuses without ACK_CC_VERSION', () => {
  const root = tmp();
  const repo = path.join(root, 'r');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  const env = { S: path.join(root, 'study'), R: repo };
  const noProfile = sh('run-2x2.sh', ['stage1', 'kiro'], env);
  assert.equal(noProfile.status, 2);
  assert.match(noProfile.stderr, /set AWSP to your least-privilege Bedrock profile/);
  const noFreeze = sh('run-2x2.sh', ['stage1', 'kiro'], { ...env, AWSP: 'some-profile-name' });
  assert.equal(noFreeze.status, 2);
  assert.match(noFreeze.stderr, /run 'freeze' first/);
});

test('missing lists every planned cell of a fresh study, and drops a cell once its result.json exists', () => {
  const root = tmp();
  const env = { S: root };
  const fresh = sh('run-2x2.sh', ['missing'], env).stdout.trim().split('\n');
  assert.ok(fresh.includes('dev kiro vanilla sdlc-prod-readiness rep 1'));
  assert.ok(fresh.includes('held-sop cc cc-konductor sop-test-coverage-review rep 3'));
  write(path.join(root, 'dev/kiro/vanilla/sdlc-prod-readiness/1/result.json'), '{}');
  const after = sh('run-2x2.sh', ['missing'], env).stdout.trim().split('\n');
  assert.equal(after.length, fresh.length - 1);
  assert.ok(!after.includes('dev kiro vanilla sdlc-prod-readiness rep 1'));
  const kiro = sh('run-2x2-kiro.sh', ['missing'], env).stdout.trim().split('\n');
  assert.equal(kiro.length, 17 * 2 * 3, '17 tasks, two arms, three replicates');
  assert.ok(kiro.every((l) => l.startsWith('rerun kiro ')));
});

// A throw-away konductor repo with one pushed commit and the freeze record the kit reads, for `gate`.
function frozenStudy() {
  const root = tmp();
  const origin = path.join(root, 'origin.git');
  const r = path.join(root, 'r');
  const S = path.join(root, 'study');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, r);
  write(path.join(r, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: Does alpha.\n---\nBody\n');
  git(r, 'add', '.');
  git(r, 'commit', '-q', '-m', 'one');
  git(r, 'branch', '-M', 'main');
  git(r, 'push', '-q', 'origin', 'main');
  const sha = git(r, 'rev-parse', 'HEAD');
  write(path.join(S, 'freeze.env'), `COMMIT=${sha}\nBENCH_SHA=${sha}\nSOP_PARITY=0\n`);
  return { root, r, S, sha };
}
function fakeRun(S, set, harness, arm, over = {}, startup = {}) {
  const dir = path.join(S, set, harness, arm, 'task-a', '1');
  const van = /vanilla/.test(arm);
  write(path.join(dir, 'result.json'), JSON.stringify({ status: 'success', effort: 'high', skillsLoaded: [], credits: 1, ...over }));
  write(path.join(dir, 'startup.json'), JSON.stringify({ homeIsolated: true, realHomeLinks: [], agent: van ? 'kiro_default' : 'konductor', mcpServers: [], steering: [], ...startup }));
}

test('gate: clean results pass, and the gate stops on a konductor skill loaded in a vanilla arm', () => {
  const f = frozenStudy();
  fakeRun(f.S, 'dev', 'kiro', 'vanilla');
  fakeRun(f.S, 'dev', 'kiro', 'konductor', { skillsLoaded: [{ name: 'alpha' }] }, { mcpServers: [{ source: '~/.kiro/agents/konductor.json' }] });
  const env = { S: f.S, R: f.r };
  const ok = sh('run-2x2.sh', ['gate', '1'], env);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /dev\/kiro\/vanilla: 1 runs, effort high, model mismatch 0, tamper 0, konductor skill in vanilla 0, infra 0, timeouts 0, startup not as required 0 ok/);
  assert.match(ok.stdout, /gate: ok for these checks/);
  fakeRun(f.S, 'dev', 'kiro', 'vanilla', { skillsLoaded: [{ name: 'alpha' }] });
  const bad = sh('run-2x2.sh', ['gate', '1'], env);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /konductor skill in vanilla 1,.*STOP/);
  assert.match(bad.stdout, /gate: STOP, do not start the next stage/);
});

test('gate: another effort level, a model mismatch and a vanilla arm with steering each stop it', () => {
  const f = frozenStudy();
  const env = { S: f.S, R: f.r };
  const cases = [
    [{ effort: 'medium' }, {}, /effort medium.*STOP/],
    [{ flags: ['modelMismatch'] }, {}, /model mismatch 1.*STOP/],
    [{}, { steering: ['~/.kiro/steering/x.md'] }, /startup not as required 1.*STOP/],
    [{}, { agent: 'konductor' }, /startup not as required 1.*STOP/],
  ];
  for (const [over, startup, want] of cases) {
    fs.rmSync(path.join(f.S, 'dev'), { recursive: true, force: true });
    fakeRun(f.S, 'dev', 'kiro', 'vanilla', over, startup);
    const r = sh('run-2x2.sh', ['gate', '1'], env);
    assert.equal(r.status, 1, JSON.stringify([over, startup]));
    assert.match(r.stdout, want);
  }
});

test('gate refuses a worktree that is not at the frozen bench commit, or that has changes', () => {
  const f = frozenStudy();
  const env = { S: f.S, R: f.r };
  fakeRun(f.S, 'dev', 'kiro', 'vanilla');
  fs.writeFileSync(path.join(f.r, 'stray.txt'), 'x');
  const dirty = sh('run-2x2.sh', ['gate', '1'], env);
  assert.equal(dirty.status, 2);
  assert.match(dirty.stderr, /has changes/);
  fs.rmSync(path.join(f.r, 'stray.txt'));
  write(path.join(f.S, 'freeze.env'), `COMMIT=${f.sha}\nBENCH_SHA=${'0'.repeat(40)}\nSOP_PARITY=0\n`);
  const moved = sh('run-2x2.sh', ['gate', '1'], env);
  assert.equal(moved.status, 2);
  assert.match(moved.stderr, /worktree HEAD is not the frozen bench commit/);
});

test('gate refuses a run directory recorded at another konductor commit', () => {
  const f = frozenStudy();
  fakeRun(f.S, 'dev', 'kiro', 'vanilla');
  write(path.join(f.S, 'dev/kiro/run-config.json'), JSON.stringify({ commitSha: 'a'.repeat(40) }));
  const r = sh('run-2x2.sh', ['gate', '1'], { S: f.S, R: f.r });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /holds runs of konductor commit a{40}, not the frozen/);
});

test('run-2x2-kiro.sh gate reads the rerun set', () => {
  const f = frozenStudy();
  fakeRun(f.S, 'rerun', 'kiro', 'vanilla');
  const r = sh('run-2x2-kiro.sh', ['gate'], { S: f.S, R: f.r });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /rerun\/kiro\/vanilla: 1 runs/);
});

test('overnight scripts: --status needs only the study dir; every other mode needs a profile name, a ref and a label', () => {
  const root = tmp();
  for (const f of ['overnight.sh', 'overnight-kiro.sh']) {
    const status = sh(f, ['--status'], { S: root });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /state:/);
    const bare = sh(f, ['--dry-run'], { S: root });
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /set AWSP to the NAME of your least-privilege Bedrock profile/);
    const bad = sh(f, ['--bogus'], { S: root });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /usage: overnight/);
  }
  write(path.join(root, 'overnight.STOPPED'), '2026-11-19 07:00:00 a reason\n');
  assert.match(sh('overnight.sh', ['--status'], { S: root }).stdout, /STOPPED: .*a reason/);
});

test('the kit keeps its spend caps and refusals (the approved numbers are not edited by accident)', () => {
  // The approved caps live in each kit's study file since D-49.
  const study = fs.readFileSync(path.join(KIT, 'study-2x2.env'), 'utf8');
  const studyKiro = fs.readFileSync(path.join(KIT, 'study-2x2-kiro.env'), 'utf8');
  for (const text of [study, studyKiro]) {
    assert.match(text, /^CAP1_CR=80 CAP1_CC=13 CAP1_JUDGE=7/m);
    assert.match(text, /^CAP2_CR=440 CAP2_CC=90 CAP2_JUDGE=40/m);
    assert.match(text, /^RUN_CAP_USD=3$/m);
  }
  assert.match(studyKiro, /^CAP3_CR=390 CAP3_JUDGE=20 CEIL3_CR=396 CEIL3_JUDGE=129$/m);
  const full = fs.readFileSync(path.join(KIT, 'run-2x2.sh'), 'utf8');
  assert.match(full, /ack_cc/);
  assert.match(full, /--allow-small-panel/, 'the comment that forbids it');
  assert.doesNotMatch(full, /--allow-small-panel[^)]/, 'the kit never passes --allow-small-panel');
  const kiro = fs.readFileSync(path.join(KIT, 'run-2x2-kiro.sh'), 'utf8');
  for (const text of [full, kiro]) {
    assert.match(text, /--isolate unshare/);
    // the words appear only in the refusal message that tells a person not to use them
    for (const line of text.split('\n').filter((l) => /--isolate none/.test(l))) assert.match(line, /die "/, line);
    assert.match(text, /SPLIT_SALT="konductor-2x2 SR-32 split v1:"/);
  }
});

// D-50: freeze and report run against a fake bench in a throw-away origin and worktree (no AWS, no model, no sandbox).
// The fake bench.js records each call and makes its --out dir; the listing estimate is a stub (kit-tools tests it).
function fakeStudy() {
  const root = tmp();
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  write(path.join(seed, 'README.md'), 'konductor\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'konductor main');
  git(seed, 'checkout', '-q', '-b', 'feat/bench-pilot-nk');
  write(path.join(seed, 'bench/runner/bench.js'), [
    "const fs = require('fs'); const a = process.argv.slice(2);",
    "fs.appendFileSync(process.env.CALLS, JSON.stringify(a) + '\\n');",
    "const i = a.indexOf('--out'); if (i >= 0) fs.mkdirSync(a[i + 1], { recursive: true });",
  ].join('\n'));
  write(path.join(seed, 'bench/judge/pack/load.js'), "exports.loadPack = () => ({ revision: 'r7', criteria: [1, 2, 3] });\n");
  write(path.join(seed, 'bench/profiles/scoring-fractional.json'), '{}\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'bench');
  spawnSync('git', ['clone', '-q', '--bare', seed, origin]);
  const repo = path.join(root, 'r');
  spawnSync('git', ['clone', '-q', origin, repo]);
  const listing = path.join(root, 'listing-stub.js');
  write(listing, "console.log(process.argv.includes('--json') ? '{\"sopsListed\":false}' : 'no konductor skill is name-only');\n");
  const env = { S: path.join(root, 'study'), R: repo, LISTING_JS: listing, CALLS: path.join(root, 'calls.jsonl') };
  return { root, repo, env, main: git(seed, 'rev-parse', 'main'), bench: git(seed, 'rev-parse', 'feat/bench-pilot-nk') };
}
const callsOf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('run-2x2.sh freeze pins the konductor and bench commits once, checks out the bench commit, and a second freeze keeps them', () => {
  const s = fakeStudy();
  const r = sh('run-2x2.sh', ['freeze'], s.env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const frozen = fs.readFileSync(path.join(s.env.S, 'freeze.env'), 'utf8');
  assert.match(frozen, new RegExp(`^COMMIT=${s.main}$`, 'm'));
  assert.match(frozen, new RegExp(`^BENCH_SHA=${s.bench}$`, 'm'));
  assert.match(frozen, /^PACK_REV=r7\/3$/m);
  assert.match(frozen, /^SOP_PARITY=0$/m);
  assert.equal(git(s.repo, 'rev-parse', 'HEAD'), s.bench, 'the worktree is at the frozen bench commit');
  const again = sh('run-2x2.sh', ['freeze'], s.env);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout + again.stderr, /already frozen/);
});

test('run-2x2.sh report 1 builds the DEV tables from the frozen worktree and labels every report dir with the build', () => {
  const s = fakeStudy();
  assert.equal(sh('run-2x2.sh', ['freeze'], s.env).status, 0);
  const r = sh('run-2x2.sh', ['report', '1'], s.env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = callsOf(s.env.CALLS);
  assert.deepEqual(calls.map((c) => c[0]), ['report-2x2', 'report-2x2', 'report', 'report']);
  for (const c of calls) assert.ok(c.includes('--criteria-pack') && c[c.indexOf('--criteria-pack') + 1] === 'quality', c.join(' '));
  assert.ok(calls[0].includes(`${path.join(s.env.S, 'dev', 'kiro')}:konductor`), 'the DEV kiro dir is a cell');
  assert.ok(!calls.some((c) => c[0] === 'calibrate'), 'stage 1 (DEV) exports no calibration sample');
  for (const d of ['report-dev', 'report-dev-fractional', 'report-dev-kiro', 'report-dev-cc']) {
    assert.match(fs.readFileSync(path.join(s.env.S, d, 'BUILD.txt'), 'utf8'), new RegExp(`konductor commit ${s.main}`), d);
  }
});
