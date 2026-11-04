// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/run-after-capability.sh: the chain, phase by phase, against a fake runner, a fake aws and a throwaway git
// repo. Nothing is judged for real and nothing leaves the sandbox.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox, makePatch, chain, out, read, until, opts } = require('./pipeline-helpers.js');

const SCRIPT = 'run-after-capability.sh';

const state = (s) => Object.fromEntries(read(path.join(s.state, 'after-capability.state')).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('the chain refuses to launch or dry-run without CREDS, naming the variable', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    delete env.AC_CREDS;
    for (const mode of ['--dry-run', '--foreground', '']) {
      const r = s.spawn(SCRIPT, mode ? [mode] : [], env);
      assert.equal(r.status, 1, `${mode}: ${out(r)}`);
      assert.match(out(r), /CREDS is not set: point CREDS \(or AC_CREDS\) at the scoped AWS credentials file/);
    }
    assert.equal(fs.existsSync(path.join(s.state, 'after-capability.state')), false, 'nothing was started');
    const viaPlain = s.spawn(SCRIPT, ['--dry-run'], { ...env, CREDS: s.creds });
    assert.equal(viaPlain.status, 0, out(viaPlain));
  } finally { s.done(); }
});

test('a dry run prints the plan and the checks, skips the optional phases without patches, and changes nothing', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    const r = s.spawn(SCRIPT, ['--dry-run'], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /P2 PATCH {7}skipped: no patches given \(set PATCHES\)/);
    assert.match(r.stdout, /P3 AUTONOMY {4}skipped: RERUN_AUTONOMY is not 1/);
    assert.match(r.stdout, /--aws-profile bench --aws-region us-east-1/);
    assert.match(r.stdout, /all checks passed/);
    assert.deepEqual(fs.readdirSync(s.state).sort(), ['real-pilot.log', 'real-pilot.study'], 'no state, log or pid file was written');
    assert.equal(s.git(['status', '--porcelain']), '');
    assert.doesNotMatch(out(r), /placeholder/, 'the credentials contents are never printed');
  } finally { s.done(); }
});

test('profile and region are parameters, and a failing aws check is a warning for a dry run', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s, { AC_AWS_PROFILE: 'other', AC_AWS_REGION: 'eu-west-1', AC_CREDS_EXPIRY_UTC: '2999-01-01T00:00:00Z' });
    const bad = s.write('bin2/aws', '#!/bin/sh\necho "An error occurred (ExpiredToken) when calling" >&2\nexit 255\n', 0o755);
    const r = s.spawn(SCRIPT, ['--dry-run'], { ...env, AC_AWS: bad });
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /--aws-profile other --aws-region eu-west-1/);
    assert.match(r.stdout, /check WARN: the credentials check fails right now \(An error occurred \(ExpiredToken\)\)/);
    assert.match(r.stdout, /expected to expire about 2999-01-01T00:00:00Z/);
  } finally { s.done(); }
});

test('with PATCHES, a dry run proves they apply in order to a pristine archive of HEAD, and a patch that does not apply fails it', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    const p2 = makePatch(s, 'p2', { 'bench/two.txt': 'two\n' }, { subject: 'feat(bench): two' });
    const { env } = chain(s, { PATCHES: `${p1},${p2}` });
    const r = s.spawn(SCRIPT, ['--dry-run'], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /P2 PATCH .*p1\.patch .*p2\.patch in order/);
    assert.match(r.stdout, /2 local commit\(s\)/);
    assert.match(r.stdout, /P3 AUTONOMY {4}move .*pilot-autonomy-\*/, 'the rerun defaults on once patches are given');
    assert.match(r.stdout, /the patches apply in order to a pristine archive of HEAD/);
    fs.writeFileSync(p2, 'diff --git a/nothing b/nothing\n--- a/nothing\n+++ b/nothing\n@@ -1 +1 @@\n-x\n+y\n');
    const bad = s.spawn(SCRIPT, ['--dry-run'], env);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /the patches do not apply to a pristine archive of HEAD/);
  } finally { s.done(); }
});

test('a full run with no patches skips P2 and P3, judges, runs the skill bench, and ends DONE; a rerun skips every phase', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    const st = state(s);
    assert.equal(st.FINAL, 'DONE');
    assert.deepEqual([st.P1, st.P2, st.P3, st.P4, st.P5, st.P6], ['done', 'skipped', 'skipped', 'done', 'done', 'done']);
    assert.match(st.P2_note, /no patches given/);
    const calls = s.callLines();
    assert.equal(calls.filter((c) => c.startsWith('judge ')).length, 2, 'one judge call per task dir');
    assert.ok(calls.some((c) => /^judge --run \S+real-one --judge-backend opencode --opencode-bin \S+ --aws-creds-file \S+ --aws-profile bench --aws-region us-east-1 --profile detailed --concurrency 2 --budget-usd 25$/.test(c)), calls.join('\n'));
    assert.ok(calls.some((c) => c.startsWith('cap skill-study --init')));
    assert.ok(calls.some((c) => /^cap skill-study --study \S+ .*--aws-creds-file/.test(c)));
    assert.ok(calls.every((c) => !c.includes('--only')), 'no skill filter without SB_SKILLS');
    const summary = read(path.join(s.state, 'after-capability-summary.txt'));
    assert.match(summary.trimEnd(), /DONE$/);
    assert.match(summary, /note: no patches given/);
    assert.equal(fs.existsSync(path.join(s.state, 'after-capability.pid')), false);
    assert.deepEqual(fs.readdirSync(s.tmp), [], 'scratch dirs are removed');
    const again = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(again.status, 0, out(again));
    assert.equal((read(path.join(s.state, 'after-capability.log')).match(/already (done|skipped), skipping/g) || []).length, 6);
    const status = s.spawn(SCRIPT, ['--status'], env);
    assert.match(status.stdout, /daemon: not running/);
    assert.match(status.stdout, /final: DONE/);
  } finally { s.done(); }
});

test('SB_SKILLS is passed to the skill bench as --only through run-skill-bench --skills', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s, { AC_SB_SKILLS: 'alpha,beta' });
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    assert.ok(s.callLines().some((c) => c.includes('--only alpha,beta')), s.callLines().join('\n'));
  } finally { s.done(); }
});

test('with patches, P2 applies them, runs the suite, and makes one commit per patch with the right messages; nothing else is staged', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    const p2 = makePatch(s, 'p2', { 'bench/runner/test/two.test.js': "require('node:test')('two', () => {});\n" }, { subject: 'feat(bench): add two' });
    const { env } = chain(s, { PATCHES: `${p1},${p2}`, AC_P3_DEST_PREFIX: 'autonomy-before' });
    const head = s.git(['rev-parse', 'HEAD']).trim();
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    assert.deepEqual(s.git(['log', '-2', '--format=%s']).trim().split('\n'), ['feat(bench): add two', 'bench: apply p1.patch']);
    assert.equal(s.git(['rev-parse', 'HEAD~2']).trim(), head);
    assert.equal(s.git(['status', '--porcelain']), '');
    const st = state(s);
    assert.match(st.P2_tests, /^tests 2, pass 2, fail 0/);
    assert.match(st.P2_commit1, /bench: apply p1\.patch$/);
    assert.match(st.P2_commit2, /feat\(bench\): add two$/);
    assert.equal(st.P3, 'skipped', 'no autonomy dirs in this study');
    assert.match(read(path.join(s.state, 'after-capability-summary.txt')), /commit 2: [0-9a-f]{8} feat\(bench\): add two/);
  } finally { s.done(); }
});

test('a <patch>.msg sidecar is used as the commit message', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    fs.writeFileSync(`${p1}.msg`, 'chore(bench): add one\n\nBody line.\n');
    const { env } = chain(s, { PATCHES: p1 });
    assert.equal(s.spawn(SCRIPT, ['--foreground'], env).status, 0);
    assert.equal(s.git(['log', '-1', '--format=%B']).trim(), 'chore(bench): add one\n\nBody line.');
  } finally { s.done(); }
});

test('a failing suite after the patches reverts every patch and stops the chain at P2 with the tree clean', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    const p2 = makePatch(s, 'p2', { 'bench/runner/test/bad.test.js': "require('node:test')('bad', () => { throw new Error('no'); });\n" });
    const { env } = chain(s, { PATCHES: `${p1},${p2}` });
    const head = s.git(['rev-parse', 'HEAD']).trim();
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    const st = state(s);
    assert.equal(st.P2, 'failed');
    assert.match(st.FINAL, /FAILED at phase 2/);
    assert.match(st.P2_reason, /the bench suite did not pass/);
    assert.equal(s.git(['rev-parse', 'HEAD']).trim(), head);
    assert.equal(s.git(['status', '--porcelain']), '', 'both patches were reverted');
    assert.match(read(path.join(s.state, 'after-capability-summary.txt')).trimEnd(), /FAILED at phase 2 \(PATCH\)/);
  } finally { s.done(); }
});

test('a commit message that matches a public-hygiene marker stops P2 and reverts the patches', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    fs.writeFileSync(`${p1}.msg`, `fix: account ${'1'.repeat(12)}\n`);
    const { env } = chain(s, { PATCHES: p1 });
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    assert.match(state(s).P2_reason, /public-hygiene marker 'account id'/);
    assert.equal(s.git(['status', '--porcelain']), '');
    assert.equal(s.git(['log', '--format=%s']).trim(), 'base');
  } finally { s.done(); }
});

test('P2 refuses a dirty bench/ and a detached HEAD, and AC_BRANCH pins the branch', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    const { env } = chain(s, { PATCHES: p1 });
    const pinned = s.spawn(SCRIPT, ['--dry-run'], { ...env, AC_BRANCH: 'other' });
    assert.equal(pinned.status, 1);
    assert.match(pinned.stdout, /repo is not on other/);
    fs.writeFileSync(path.join(s.repo, 'bench/notes.txt'), 'dirty\n');
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    assert.match(state(s).P2_reason, /bench\/ is not clean/);
  } finally { s.done(); }
});

test('P1 stops the chain when the capability study ended FAILED, without touching anything', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    fs.writeFileSync(path.join(s.state, 'real-pilot.log'), '[2026-01-01T00:00:00Z] FAILED: 1/2 task dirs complete\n');
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    assert.match(state(s).P1_reason, /the capability study ended FAILED/);
    assert.deepEqual(s.callLines(), []);
  } finally { s.done(); }
});

test('P3 moves the autonomy dirs aside and reruns them through run-real-pilot with the chain\'s own state dir', opts, () => {
  const s = sandbox();
  try {
    s.write('tasks.txt', 'pilot|lite-one|60|lite|100\npilot|autonomy-one|60|auton|100\n');
    const { study, env } = chain(s, {
      AC_N_ARMS: '1', AC_REPS: '1', REPS: '1', ARMS: 'vanilla', AUTONOMY: '1', RERUN_AUTONOMY: '1',
      REPO: s.repo, CLI_JS: s.cli, TASKS_FILE: s.tasksFile, CARGO_TARGET: s.cargo, REAL_CACHE: path.join(s.root, 'realrepos'),
    });
    fs.rmSync(path.join(study, 'real-one'), { recursive: true });
    const complete = JSON.stringify({ armIds: ['vanilla'], replicates: 1, taskIds: ['x'], isolationGate: { ok: true }, results: [{ armLabel: 'vanilla', status: 'success' }], counts: {} });
    for (const d of ['pilot-lite-one', 'pilot-autonomy-one']) fs.mkdirSync(path.join(study, d), { recursive: true });
    for (const d of ['pilot-lite-one', 'pilot-autonomy-one']) fs.writeFileSync(path.join(study, d, 'summary.json'), complete);
    fs.writeFileSync(path.join(study, 'pilot-autonomy-one', 'old.txt'), 'earlier result');
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    const st = state(s);
    assert.equal(st.P3, 'done');
    assert.match(st.P3_dest, /incomplete\/autonomy-rerun-\d{8}T\d{6}Z$/);
    assert.equal(fs.readFileSync(path.join(st.P3_dest, 'pilot-autonomy-one', 'old.txt'), 'utf8'), 'earlier result');
    assert.ok(fs.existsSync(path.join(study, 'pilot-autonomy-one', 'summary.json')), 'the rerun wrote a fresh summary');
    assert.ok(!fs.existsSync(path.join(study, 'pilot-autonomy-one', 'old.txt')));
    assert.match(read(path.join(s.state, 'real-pilot-autonomy-rerun.log')), /DONE: 2\/2 task dirs complete/);
    assert.equal(s.callLines().filter((c) => c.startsWith('run ') && !c.includes('--prepare-only')).length, 1, 'only the moved task ran again');
  } finally { s.done(); }
});

test('the default mode daemonizes, returns at once, finishes the chain and removes its pid file', { ...opts, timeout: 90000 }, async () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    const r = s.spawn(SCRIPT, [], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /LAUNCHED: pid \d+/);
    assert.ok(await until(() => state(s).FINAL === 'DONE' && !fs.existsSync(path.join(s.state, 'after-capability.pid')), 60000), read(path.join(s.state, 'after-capability.log')));
  } finally { s.done(); }
});

test('--stop on a missing daemon says so, and --status with no state says nothing has run', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    assert.match(s.spawn(SCRIPT, ['--stop'], env).stdout, /not running/);
    assert.match(s.spawn(SCRIPT, ['--status'], env).stdout, /no state yet/);
  } finally { s.done(); }
});
