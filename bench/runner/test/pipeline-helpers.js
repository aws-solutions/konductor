// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sandbox for the pipeline script tests: a throwaway git repo with an origin/main ref, a fake bench runner that records
// its calls and writes just enough output for the scripts to proceed, a fake aws and opencode, and a scratch HOME.
// Nothing here calls a model, the network or a real AWS account.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const REAL_PUBLIC_JS = path.join(__dirname, '..', '..', 'cap', 'public.js');

const FAKE_CLI = `
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
if (process.env.FAKE_CALLS) fs.appendFileSync(process.env.FAKE_CALLS, a.join(' ') + '\\n');
const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const cmd = a[0];
if (cmd === 'run') {
  if (a.includes('--prepare-only')) { console.log('prepare-only ok'); process.exit(0); }
  const out = arg('--out');
  const arms = arg('--arms').split(',').map((x) => x.split('=')[0]);
  const reps = Number(process.env.REPS || 5);
  const ids = [...arms];
  const k = arms.find((x) => x !== 'vanilla');
  if (k) ids.push(k + '-b');
  const results = [];
  for (const id of ids) for (let r = 1; r <= reps; r++) results.push({ armId: id, armLabel: id, status: 'success', credits: 1 });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ armIds: ids, replicates: reps, taskIds: [arg('--tasks')], isolationGate: { ok: true }, results, counts: { success: results.length }, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T01:00:00Z' }));
  fs.writeFileSync(path.join(out, 'run-config.json'), JSON.stringify({ startedAt: '2026-01-01T00:00:00Z' }));
  process.exit(0);
}
if (cmd === 'judge') {
  fs.writeFileSync(path.join(arg('--run'), 'judgments.json'), JSON.stringify({ backend: 'opencode', rubric: process.env.FAKE_JUDGE_ERROR ? [{ judgeError: process.env.FAKE_JUDGE_ERROR }] : [], pairwise: [], graded: [], spentUsd: 0.5, invocations: [{ calls: 3, cachedCalls: 0 }], notJudged: [] }));
  process.exit(0);
}
if (cmd === 'report' || cmd === 'contrast') { fs.mkdirSync(arg('--out'), { recursive: true }); process.exit(0); }
if (cmd === 'cap') {
  if (a.includes('--init')) fs.mkdirSync(arg('--study'), { recursive: true });
  if (!a.includes('--init') && process.env.FAKE_SB_STOP) { console.log('study stopped: ' + process.env.FAKE_SB_STOP); process.exit(1); }
  process.exit(0);
}
process.exit(0);
`;

const TASKS = ['real|real-one|60|real|100', 'pilot|lite-one|60|lite|100'].join('\n');
const PASSING_TEST = "const test = require('node:test');\ntest('ok', () => {});\n";

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: opts.home || os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function sandbox() {
  let parent = os.tmpdir();
  if (/bench/i.test(parent)) parent = '/tmp';
  const root = fs.realpathSync(mkScratch('pipe-', parent));
  const dir = (...p) => { const d = path.join(root, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
  const state = dir('state'), results = dir('results'), home = dir('home'), tmp = dir('tmp'), cargo = dir('cargo');
  const write = (rel, text, mode) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, mode ? { mode } : undefined); return f; };

  const repo = dir('repo');
  const put = (rel, text) => { const f = path.join(repo, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  git(repo, ['init', '-q', '-b', 'work']);
  put('bench/runner/test/ok.test.js', PASSING_TEST);
  put('bench/cap/public.js', fs.readFileSync(REAL_PUBLIC_JS, 'utf8'));
  put('bench/notes.txt', 'one\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  const cli = write('fake-cli.js', FAKE_CLI);
  const calls = path.join(root, 'calls.log');
  const aws = write('bin/aws', '#!/bin/sh\nexit 0\n', 0o755);
  const oc = write('bin/opencode', '#!/bin/sh\nexit 0\n', 0o755);
  const creds = write('creds', 'placeholder');
  for (const t of ['real-one']) fs.mkdirSync(path.join(root, 'realrepos', t.replace(/^real-/, '')), { recursive: true });
  const tasksFile = write('tasks.txt', `# test tasks\n${TASKS}\n`);

  const base = {
    PATH: `${path.dirname(aws)}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, SCRATCH_PARENT: tmp, AC_SCRATCH_PARENT: tmp,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    NO_KIRO_CHECK: '1', NO_ISOLATION_CHECK: '1', NO_OPENCODE_CHECK: '1', MIN_FREE_GB: '0', MIN_FREE_GB_TMPFS: '0', MIN_MEM_GB: '0', MIN_FREE_MB: '0',
    BENCH_PROC_PATTERN: 'no-such-bench-process-pattern', AC_BENCH_PROC_PATTERN: 'no-such-bench-process-pattern', FAKE_CALLS: calls,
  };
  const spawn = (script, args, env = {}, opts = {}) => spawnSync('bash', [path.join(SCRIPTS, script), ...args], { env: { ...base, ...env }, encoding: 'utf8', cwd: root, timeout: 120000, ...opts });
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const callLines = () => read(calls).split('\n').filter(Boolean);
  return { root, dir, write, repo, put, git: (args) => git(repo, args), state, results, home, tmp, cargo, cli, calls, callLines, aws, oc, creds, tasksFile, base, spawn, read, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Env that points run-real-pilot.sh at the sandbox. */
function pilotEnv(s, extra = {}) {
  return { REPO: s.repo, STATE_DIR: s.state, RESULTS: s.results, CARGO_TARGET: s.cargo, CLI_JS: s.cli, TASKS_FILE: s.tasksFile, REAL_CACHE: path.join(s.root, 'realrepos'), REPS: '2', ...extra };
}

/** A patch (plain git diff, or format-patch with a subject) that adds files to the sandbox repo. */
function makePatch(s, name, files, { subject } = {}) {
  const clone = path.join(s.root, `clone-${name}`);
  git(s.root, ['clone', '-q', s.repo, clone]);
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(clone, rel)), { recursive: true }); fs.writeFileSync(path.join(clone, rel), text); }
  git(clone, ['add', '-A']);
  let patch;
  if (subject) { git(clone, ['commit', '-q', '-m', subject]); patch = git(clone, ['format-patch', '-1', '--stdout']); } else patch = git(clone, ['diff', '--cached']);
  const f = path.join(s.root, `${name}.patch`);
  fs.writeFileSync(f, patch);
  return f;
}

/** A finished capability study plus the env that points run-after-capability.sh at the sandbox. */
function chain(s, extra = {}) {
  const study = path.join(s.results, 'study1');
  for (const d of ['real-one', 'pilot-lite-one']) { fs.mkdirSync(path.join(study, d), { recursive: true }); fs.writeFileSync(path.join(study, d, 'summary.json'), '{}'); }
  fs.writeFileSync(path.join(s.state, 'real-pilot.study'), `${study}\n`);
  fs.writeFileSync(path.join(s.state, 'real-pilot.log'), '[2026-01-01T00:00:00Z] DONE: 2/2 task dirs complete\n');
  const env = {
    AC_STATE_DIR: s.state, AC_REPO: s.repo, AC_CLI_JS: s.cli, AC_CREDS: s.creds, AC_OC: s.oc, AC_AWS: s.aws, AC_POLL_S: '1', AC_BENCH_GRACE_S: '1',
    AC_SB_RESULTS: path.join(s.root, 'sbres'), AC_EXPOSURE_RUNS: study, AC_TEST_TIMEOUT_S: '120', BASE_REF: 'HEAD', ...extra,
  };
  return { study, env };
}

const out = (r) => `${r.stdout}${r.stderr}`;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return false; }
const LINUX = process.platform === 'linux';
const opts = { skip: LINUX ? false : 'the scripts rely on /proc and GNU tools' };

module.exports = { sandbox, pilotEnv, makePatch, chain, SCRIPTS, PASSING_TEST, out, read, sleep, until, opts };
