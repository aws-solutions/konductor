// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/run-judging.sh against a fake runner, a fake aws and a fake study directory. No judge call is made.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox, out, read, until, opts } = require('./pipeline-helpers.js');

const SCRIPT = 'run-judging.sh';

function judging(s, extra = {}) {
  const study = path.join(s.root, 'orch-study');
  for (const cell of ['claude', 'gpt']) for (let i = 1; i <= 2; i++) {
    const d = path.join(study, cell, 'arm', 'task', String(i));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'result.json'), '{}');
  }
  const env = { STUDY: study, CREDS: s.creds, OC: s.oc, REPO: s.repo, CLI_JS: s.cli, STATE_DIR: s.state, ...extra };
  return { study, env };
}

test('STUDY is required: every mode but --help refuses with exit 2 and names the variable', opts, () => {
  const s = sandbox();
  try {
    for (const mode of ['--status', '--dry-run', '--foreground', '']) {
      const r = s.spawn(SCRIPT, mode ? [mode] : [], { STATE_DIR: s.state });
      assert.equal(r.status, 2, `${mode}: ${out(r)}`);
      assert.match(r.stderr, /STUDY is not set/);
    }
    assert.deepEqual(fs.readdirSync(s.state), []);
  } finally { s.done(); }
});

test('a dry run prints the plan, the cells and the exact commands, needs no credentials, and writes nothing', opts, () => {
  const s = sandbox();
  try {
    const { study, env } = judging(s, { CHANGED_SKILLS: 'alpha', CELLS: 'one two' });
    delete env.CREDS;
    const r = s.spawn(SCRIPT, ['--dry-run'], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /CELLS=one two/);
    assert.match(r.stdout, /CREDS=\(unset\) \(path only\)/);
    assert.match(r.stdout, /Judge the cells \(one two\)/);
    assert.ok(r.stdout.includes(`--run ${study}/one,${study}/two --verdict orchestrator-pass --changed-skills alpha`), r.stdout);
    assert.match(r.stdout, /--aws-profile bench --aws-region us-east-1/);
    assert.match(r.stdout, /Step 2 command .*\n.*skipped: SMOKE is unset/);
    assert.deepEqual(fs.readdirSync(s.state), []);
    assert.deepEqual(s.callLines(), []);
    const plain = s.spawn(SCRIPT, ['--dry-run'], { ...env, CELLS: undefined, CHANGED_SKILLS: undefined });
    assert.ok(plain.stdout.includes(`--verdict orchestrator-pass --out ${study}/reports-judged/pass`), 'no --changed-skills when unset');
    assert.match(plain.stdout, /CELLS=claude gpt/);
    const withSmoke = s.spawn(SCRIPT, ['--dry-run'], { ...env, SMOKE: '/x/smoke.js' });
    assert.match(withSmoke.stdout, /2\. Smoke test: real judge calls from \/x\/smoke\.js \(cents\); the long run starts only if they pass\.\n/);
    assert.match(plain.stdout, /2\. Smoke test: skipped, no SMOKE script given\./);
  } finally { s.done(); }
});

test('a real run refuses without CREDS, with the variable named and no mention of an assistant', opts, () => {
  const s = sandbox();
  try {
    const { env } = judging(s);
    delete env.CREDS;
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAILED at step 1: CREDS is not set: point CREDS at the scoped AWS credentials file/);
    assert.deepEqual(s.callLines(), []);
    const gone = s.spawn(SCRIPT, ['--foreground'], { ...env, CREDS: path.join(s.root, 'no-such-creds') });
    assert.match(out(gone), /AWS credentials file not found: .*no-such-creds\. Re-vend the credentials to that path and rerun\./);
    assert.doesNotMatch(out(r) + out(gone), /assistant/i);
  } finally { s.done(); }
});

test('rejected credentials stop step 1 with the re-vend instruction and the path', opts, () => {
  const s = sandbox();
  try {
    const { env } = judging(s);
    const bad = s.write('bin2/aws', '#!/bin/sh\necho "An error occurred (ExpiredToken) when calling the ListFoundationModels operation" >&2\nexit 255\n', 0o755);
    const r = s.spawn(SCRIPT, ['--foreground'], { ...env, PATH: `${path.dirname(bad)}:${process.env.PATH}` });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`credentials expired: re-vend the credentials to ${s.creds.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} and rerun`));
    assert.deepEqual(s.callLines(), []);
  } finally { s.done(); }
});

test('a full run judges every cell, builds every report, writes the summary and ends DONE', opts, () => {
  const s = sandbox();
  try {
    const { study, env } = judging(s, { CHANGED_SKILLS: 'alpha' });
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /no SMOKE script given; skipping the smoke test/);
    assert.match(out(r), /DONE\. Summary: /);
    const calls = s.callLines();
    assert.equal(calls.filter((c) => c.startsWith('judge ')).length, 2);
    assert.ok(calls.some((c) => /^judge --run \S+\/claude --judge-backend opencode --opencode-bin \S+ --aws-creds-file \S+ --aws-profile bench --aws-region us-east-1 --profile detailed --concurrency 2 --budget-usd 15$/.test(c)), calls.join('\n'));
    assert.equal(calls.filter((c) => /^(report|contrast) /.test(c)).length, 7);
    assert.ok(calls.some((c) => c.includes('--verdict orchestrator-pass --changed-skills alpha')));
    const summary = read(path.join(s.state, 'judging-summary.txt'));
    assert.match(summary, /- claude: judge exit status 0/);
    assert.match(summary, /- gpt: judge exit status 0/);
    assert.match(summary.trimEnd(), /Result: DONE$/);
    assert.ok(fs.existsSync(path.join(study, 'reports-judged', 'platform-gpt')));
    assert.equal(fs.existsSync(path.join(s.state, 'judging.pid')), false);
    assert.deepEqual(fs.readdirSync(s.tmp), [], 'scratch dirs are removed');
  } finally { s.done(); }
});

test('EXPECT_RUNS, REQUIRED_BRANCH and REQUIRED_COMMIT are enforced only when set', opts, () => {
  const s = sandbox();
  try {
    const { env } = judging(s);
    const runs = s.spawn(SCRIPT, ['--foreground'], { ...env, EXPECT_RUNS: '3' });
    assert.equal(runs.status, 1);
    assert.match(out(runs), /cell claude has 2 result\.json files, expected 3/);
    const branch = s.spawn(SCRIPT, ['--foreground'], { ...env, REQUIRED_BRANCH: 'main' });
    assert.match(out(branch), /is on branch 'work', expected 'main'/);
    const commit = s.spawn(SCRIPT, ['--foreground'], { ...env, REQUIRED_COMMIT: '0000000' });
    assert.match(out(commit), /does not contain the required commit 0000000/);
    const head = s.git(['rev-parse', '--short', 'HEAD']).trim();
    const ok = s.spawn(SCRIPT, ['--foreground'], { ...env, EXPECT_RUNS: '2', REQUIRED_BRANCH: 'work', REQUIRED_COMMIT: head });
    assert.equal(ok.status, 0, out(ok));
  } finally { s.done(); }
});

test('a judgments.json from another backend is refused, and a judge error in a finished cell is a failure', opts, () => {
  const s = sandbox();
  try {
    const { study, env } = judging(s);
    fs.writeFileSync(path.join(study, 'claude', 'judgments.json'), JSON.stringify({ backend: 'kiro' }));
    const r = s.spawn(SCRIPT, ['--foreground'], env);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /written by the 'kiro' backend; one backend per study/);
    fs.rmSync(path.join(study, 'claude', 'judgments.json'));
    const err = s.spawn(SCRIPT, ['--foreground'], { ...env, FAKE_JUDGE_ERROR: 'ThrottlingException' });
    assert.equal(err.status, 1, out(err));
    assert.match(out(err), /record\(s\) have judge errors \(failed calls are not cached\)/);
  } finally { s.done(); }
});

test('records skipped by the budget guard end the run with exit 3 and say how to continue', opts, () => {
  const s = sandbox();
  try {
    const { env } = judging(s);
    const r = s.spawn(SCRIPT, ['--foreground'], { ...env, FAKE_JUDGE_ERROR: 'budget reached' });
    assert.equal(r.status, 3, out(r));
    assert.match(out(r), /skipped by the budget guard/);
    assert.match(out(r), /BUDGET_USD=<higher> bash /);
  } finally { s.done(); }
});

function smokeScript(s, lines) {
  return s.write('smoke.js', `for (const l of ${JSON.stringify(lines)}) console.log(JSON.stringify(l));\n`);
}

test('the smoke test gates the long run: a failing model stops it, a listed model that is missing stops it, a pass continues', opts, () => {
  const s = sandbox();
  try {
    const { env } = judging(s);
    const bad = s.spawn(SCRIPT, ['--foreground'], { ...env, SMOKE: smokeScript(s, [{ model: 'm1', jsonOk: true }, { model: 'm2', error: 'boom' }]) });
    assert.equal(bad.status, 1, out(bad));
    assert.match(out(bad), /smoke test failed, long run not started: m2: boom/);
    assert.deepEqual(s.callLines(), []);
    const missing = s.spawn(SCRIPT, ['--foreground'], { ...env, SMOKE: smokeScript(s, [{ model: 'm1', jsonOk: true }]), SMOKE_MODELS: 'm1 m3' });
    assert.match(out(missing), /m3: no result printed/);
    const ok = s.spawn(SCRIPT, ['--foreground'], { ...env, SMOKE: smokeScript(s, [{ model: 'm1', jsonOk: true }]), SMOKE_MODELS: 'm1' });
    assert.equal(ok.status, 0, out(ok));
    assert.match(out(ok), /smoke test passed/);
  } finally { s.done(); }
});

test('--status shows the cells and cached calls, and the default mode runs in the background and cleans up its pid file', { ...opts, timeout: 60000 }, async () => {
  const s = sandbox();
  try {
    const { study, env } = judging(s, { EXPECT_CALLS: '10' });
    fs.mkdirSync(path.join(study, 'claude', 'judge', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(study, 'claude', 'judge', 'cache', 'a.json'), '{}');
    const st = s.spawn(SCRIPT, ['--status'], env);
    assert.equal(st.status, 0, out(st));
    assert.match(st.stdout, /claude +1 cached calls of about 10/);
    assert.match(st.stdout, /Process: not running/);
    const r = s.spawn(SCRIPT, [], env);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /Started in the background \(pid \d+\)/);
    assert.ok(await until(() => /Result: DONE/.test(read(path.join(s.state, 'judging-summary.txt'))) && !fs.existsSync(path.join(s.state, 'judging.pid')), 40000), read(path.join(s.state, 'judging.log')));
  } finally { s.done(); }
});
