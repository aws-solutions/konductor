// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which `run` flags each runtime accepts or refuses, with the exact refusal text. Pins the behaviour that run-cmd.js
// reads from the runtime descriptors, so a descriptor change cannot reword or drop a refusal unnoticed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');

const BENCH = path.join(__dirname, '..', 'bench.js');

function setup({ autonomy = false } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
  if (autonomy) {
    const taskFile = path.join(bench, 'tasks', 't1.json');
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    fs.writeFileSync(taskFile, JSON.stringify({ ...task, autonomy: { clarifications: [], maxInterjections: 2, noQuestionNeeded: true } }));
  }
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  write(path.join(repo, 'README'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  fs.mkdirSync(path.join(root, 'home'));
  fs.mkdirSync(path.join(root, 'tmp'));
  return { root, bench, repo };
}

const CC_ENV = { AWS_ACCESS_KEY_ID: 'AK' + 'IATESTTESTTEST1234', AWS_SECRET_ACCESS_KEY: 'fakeSecretValueNotReal0123456789abcdefgh', AWS_SESSION_TOKEN: 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==' };

const run = (s, args, env = {}) => spawnSync(process.execPath, [BENCH, 'run', '--suite', 'lite', '--tasks', 't1', '--bench-dir', s.bench, '--repo-root', s.repo, '--cache', path.join(s.root, 'cache'), '--out', path.join(s.root, 'o'), ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home'), TMPDIR: path.join(s.root, 'tmp'), ...env },
});

const CC_ONLY = (flag) => `--${flag} applies to Claude Code (cc-) arms only`;
const NO_ENGINE = (rt) => `--agent-engine applies to kiro-cli arms only; ${rt} arms have no agent engine`;
const PREPARE = '--prepare-only covers kiro-cli arms; opencode and Claude Code arms need their binary and AWS credentials, so check them with a normal run';
const CC_NO = {
  effort: 'the effort level is not passed to claude, so a value would be recorded but not applied',
  'stop-on': 'the early-stop watcher reads kiro-cli and opencode events only',
  'max-tool-calls': 'the early-stop watcher reads kiro-cli and opencode events only',
  'aws-creds-file': 'credentials come from the AWS_* variables in the environment that starts the bench',
  'aws-profile': 'credentials come from the AWS_* variables in the environment that starts the bench',
};
const VALUE = { effort: 'high', 'stop-on': 'end_turn', 'max-tool-calls': '3', 'aws-creds-file': 'x', 'aws-profile': 'p' };

// Every refusal is "bench: <message>" on its own stderr line.
const refusal = (r) => r.stderr.split('\n').map((l) => l.replace(/^bench: /, '')).find((l) => /does not apply|applies to|covers|not supported|costed in/.test(l));

const CASES = [
  // kiro-cli arms
  ['vanilla', ['--claude-bin', 'x'], CC_ONLY('claude-bin')],
  ['vanilla', ['--claude-tools-dir', 'x'], CC_ONLY('claude-tools-dir')],
  ['vanilla', ['--run-budget-usd', '1'], CC_ONLY('run-budget-usd')],
  ['vanilla', ['--budget-usd', '5'], '--budget-usd does not apply here: kiro-cli runs are costed in credits, use --budget-credits'],
  // opencode arms
  ['oc-vanilla', ['--claude-bin', 'x'], CC_ONLY('claude-bin')],
  ['oc-vanilla', ['--agent-engine', 'v2'], NO_ENGINE('opencode')],
  ['oc-vanilla', ['--prepare-only'], PREPARE],
  ['oc-vanilla', ['--budget-credits', '5'], '--budget-credits does not apply here: opencode runs are costed in USD, use --budget-usd'],
  ['oc-vanilla', ['--run-credit-limit', '2'], '--run-credit-limit applies to kiro-cli arms only; opencode runs are costed in USD'],
  // Claude Code arms
  ['cc-vanilla', ['--agent-engine', 'v3'], NO_ENGINE('claude-code')],
  ['cc-vanilla', ['--prepare-only'], PREPARE],
  ['cc-vanilla', ['--budget-credits', '3'], '--budget-credits does not apply here: claude-code runs are costed in USD, use --budget-usd'],
  ...Object.entries(CC_NO).map(([flag, why]) => ['cc-vanilla', [`--${flag}`, VALUE[flag]], `--${flag} does not apply to Claude Code arms (${why})`]),
];

for (const [arm, args, message] of CASES) {
  test(`${arm} ${args.join(' ')} is refused: ${message.slice(0, 60)}`, () => {
    const s = setup();
    try {
      const r = run(s, ['--arms', arm, ...args]);
      assert.notEqual(r.status, 0);
      assert.equal(refusal(r), message);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
}

test('a Claude Code arm with credentials set is refused --run-credit-limit, and names the per-run cap flag', () => {
  const s = setup();
  try {
    const r = run(s, ['--arms', 'cc-vanilla', '--run-credit-limit', '3'], CC_ENV);
    assert.equal(refusal(r), '--run-credit-limit applies to kiro-cli arms only; claude-code runs are costed in USD (use --run-budget-usd for a per-run cap)');
    const without = run(s, ['--arms', 'cc-vanilla', '--run-credit-limit', '3']);
    assert.match(without.stderr, /missing AWS_ACCESS_KEY_ID/, 'the credential check comes before the credit-limit check');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('the first refused Claude Code flag in table order is the one reported', () => {
  const s = setup();
  try {
    const r = run(s, ['--arms', 'cc-vanilla', '--aws-profile', 'p', '--stop-on', 'end_turn', '--effort', 'high']);
    assert.equal(refusal(r), `--effort does not apply to Claude Code arms (${CC_NO.effort})`);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('opencode arms are not refused --effort, --stop-on or --max-tool-calls; the run goes on to ask for credentials', () => {
  const s = setup();
  try {
    const r = run(s, ['--arms', 'oc-vanilla', '--effort', 'high', '--stop-on', 'end_turn', '--max-tool-calls', '3']);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /does not apply to/);
    assert.match(r.stderr, /--aws-creds-file is required for opencode arms/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('kiro-cli arms are not refused --effort, --stop-on, --max-tool-calls or --run-credit-limit', () => {
  const s = setup();
  try {
    const r = run(s, ['--arms', 'vanilla', '--effort', 'high', '--stop-on', 'end_turn', '--max-tool-calls', '3', '--run-credit-limit', '2', '--agent-engine', 'v3', '--prepare-only']);
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a Claude Code arm refuses an autonomy task with the full text, and the flag check comes first', () => {
  const s = setup({ autonomy: true });
  try {
    const r = run(s, ['--arms', 'cc-vanilla']);
    assert.equal(refusal(r), 'multi-turn (autonomy) tasks are not supported on the Claude Code harness yet: t1; the resume flags have not been verified. Choose other tasks with --tasks');
    const both = run(s, ['--arms', 'cc-vanilla', '--effort', 'high']);
    assert.match(refusal(both), /^--effort does not apply to Claude Code arms/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('opencode and kiro-cli arms are not refused an autonomy task by the flag checks', () => {
  const s = setup({ autonomy: true });
  try {
    const oc = run(s, ['--arms', 'oc-vanilla']);
    assert.doesNotMatch(oc.stderr, /multi-turn/);
    const kiro = run(s, ['--arms', 'vanilla', '--prepare-only']);
    assert.equal(kiro.status, 0, kiro.stderr);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
