#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// One side of the refactor regression net: the same fake-agent studies, run with the bench of `--tree DIR` (a checkout
// of any commit), written under `--out DIR`. Free: every agent and judge is a test double, nothing calls a model.
//
// The inputs (bench dir, git repo, fake binaries, judge stub, scripted Strands model) are built by THIS checkout's test
// helpers, so both sides get the same inputs and only the bench under test differs. The plant studies use the tree's
// own toy release, because the gateway and the release format are part of what is tested.
//
// Studies: kiro (two runs, then compare), opencode, claude-code, plant on Claude Code, plant on Strands, a judge pass
// with a stub on the kiro run, and a report of each run. Each command's exit code, stdout and stderr go to
// <out>/commands/<name>.{json,out.txt,err.txt}; the run directories are <out>/runs/<name>.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const HERE = path.join(__dirname, '..', '..', 'runner', 'test');
const { makeBench, write } = require(path.join(HERE, 'helpers.js'));
const { makeFakeKiro } = require(path.join(HERE, 'fake-kiro.js'));
const { makeFakeClaude } = require(path.join(HERE, 'fake-claude.js'));
const { makeFakeOpencode } = require(path.join(HERE, 'fake-opencode.js'));
const { makeFakePlantClaude } = require(path.join(HERE, 'fake-plant-claude.js'));
const FX = path.join(HERE, 'fixtures');

// Made-up keys a fake Claude Code or opencode reads like the real ones do; never valid anywhere.
const FAKE_KEYS = { AWS_ACCESS_KEY_ID: 'AKIAFAKEREGRESSION00', AWS_SECRET_ACCESS_KEY: 'fake-regression-secret-000000', AWS_SESSION_TOKEN: 'fake-regression-token-0000000' };
const CREDS = `[bench]\naws_access_key_id = ${FAKE_KEYS.AWS_ACCESS_KEY_ID}\naws_secret_access_key = ${FAKE_KEYS.AWS_SECRET_ACCESS_KEY}\naws_session_token = ${FAKE_KEYS.AWS_SESSION_TOKEN}\n`;
const JUDGES = 'gpt-5.6-luna,deepseek-3.2,glm-5';
const PLANT_TASK = 'toy-stop-line.v01';

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

/** The fixed inputs under `root`: a bench dir with one lite task, a git repo with one commit, a home and tmp. */
function inputs(root) {
  const bench = makeBench(path.join(root, 'bench'));
  write(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  // A fixed author and date, so the repo commit is the same on both sides.
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', env }).trim();
  git('init', '-q', '-b', 'main');
  write(path.join(repo, 'README'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.konductor/installs'), { recursive: true });
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir, { recursive: true });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  write(path.join(root, 'creds'), CREDS);
  write(path.join(root, 'rg'), '#!/bin/sh\n');
  fs.chmodSync(path.join(root, 'rg'), 0o755);
  return { bench, repo, home, tmpdir, authDb };
}

function main(argv) {
  const tree = argOf(argv, '--tree');
  const out = argOf(argv, '--out');
  const plantPython = argOf(argv, '--plant-python') || process.env.BENCH_ARM_PYTHON || null;
  const strandsPython = argOf(argv, '--strands-python') || process.env.BENCH_STRANDS_PYTHON || null;
  if (!tree || !out) {
    process.stderr.write('usage: study.js --tree CHECKOUT --out DIR [--plant-python PY] [--strands-python PY]\n');
    return 64;
  }
  const benchJs = path.join(path.resolve(tree), 'bench', 'runner', 'bench.js');
  if (!fs.existsSync(benchJs)) throw new Error(`${benchJs} does not exist`);
  const root = path.resolve(out);
  if (fs.existsSync(root)) throw new Error(`${root} exists; give a new --out`);
  const inp = inputs(path.join(root, 'in'));
  const runs = path.join(root, 'runs');
  const cmds = path.join(root, 'commands');
  fs.mkdirSync(runs, { recursive: true });
  fs.mkdirSync(cmds, { recursive: true });
  const baseEnv = { PATH: process.env.PATH, HOME: inp.home, TMPDIR: inp.tmpdir, BENCH_TEST_MODE: '1', BENCH_GATE_HOMES: inp.home, ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}) };
  const results = [];

  /** Runs `bench.js args` as study step `name`; records exit code, stdout and stderr. */
  const bench = (name, args, env = {}) => {
    const r = spawnSync(process.execPath, [benchJs, ...args], { encoding: 'utf8', env: { ...baseEnv, ...env }, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(cmds, `${name}.out.txt`), r.stdout ?? '');
    fs.writeFileSync(path.join(cmds, `${name}.err.txt`), r.stderr ?? '');
    const rec = { name, args, exitCode: r.status, signal: r.signal ?? null, error: r.error ? r.error.message : null };
    fs.writeFileSync(path.join(cmds, `${name}.json`), `${JSON.stringify(rec, null, 2)}\n`);
    results.push(rec);
    process.stderr.write(`[study] ${name}: exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\n`);
    return rec;
  };
  const common = ['--suite', 'lite', '--tasks', 't1', '--bench-dir', inp.bench, '--repo-root', inp.repo, '--isolate', 'none', '--allow-unisolated', '--seed', '1'];

  // Kiro CLI: two runs of vanilla (the second costs more per run), a stub judge pass on the first, reports, a compare.
  const fakeDir = path.join(root, 'in', 'fakes');
  for (const [name, credits] of [['kiro-a', 1], ['kiro-b', 2]]) {
    const probe = path.join(fakeDir, name, 'probe');
    fs.mkdirSync(probe, { recursive: true });
    const kiroBin = makeFakeKiro(path.join(fakeDir, name, 'bin'), { dir: probe, credits });
    bench(`run-${name}`, ['run', ...common, '--arms', 'vanilla', '--replicates', '3', '--budget-credits', '1000', '--kiro-bin', kiroBin, '--auth-db', inp.authDb, '--cache', path.join(root, 'in', 'cache'), '--out', path.join(runs, name)]);
  }
  bench('judge-kiro-a', ['judge', '--run', path.join(runs, 'kiro-a'), '--bench-dir', inp.bench, '--judges', JUDGES, '--mode', 'rubric', '--judge-cmd', `node ${path.join(HERE, 'fake-judge.js')}`, '--budget-credits', '100', '--concurrency', '1']);
  bench('compare-kiro', ['compare', '--base', path.join(runs, 'kiro-a'), '--head', path.join(runs, 'kiro-b'), '--bench-dir', inp.bench, '--force']);

  // opencode, on the recorded vanilla stream and usage rows.
  const ocProbe = path.join(fakeDir, 'opencode', 'probe');
  fs.mkdirSync(ocProbe, { recursive: true });
  const ocBin = makeFakeOpencode(path.join(fakeDir, 'opencode', 'bin'), { dir: ocProbe, streamFile: path.join(FX, 'opencode-vanilla.stream.jsonl'), rowsFile: path.join(FX, 'opencode-vanilla.rows.json'), sessionID: 'ses_e7b047669ffea6BvJf34zDKxOm' });
  bench('run-opencode', ['run', ...common, '--arms', 'oc-vanilla', '--replicates', '2', '--budget-usd', '100', '--opencode-bin', ocBin, '--aws-creds-file', path.join(root, 'in', 'creds'), '--rg-bin', path.join(root, 'in', 'rg'), '--cache', path.join(root, 'in', 'cache'), '--out', path.join(runs, 'opencode')]);

  // Claude Code, on the recorded vanilla success stream.
  const ccProbe = path.join(fakeDir, 'claude', 'probe');
  fs.mkdirSync(ccProbe, { recursive: true });
  const ccBin = makeFakeClaude(path.join(fakeDir, 'claude', 'tools'), { dir: ccProbe, streamFile: path.join(FX, 'claude-code', 'vanilla-success.stream.jsonl'), tmpBases: [inp.tmpdir] });
  bench('run-claude-code', ['run', ...common, '--arms', 'cc-vanilla', '--replicates', '2', '--budget-usd', '100', '--claude-bin', ccBin, '--cache', path.join(root, 'in', 'cache'), '--out', path.join(runs, 'claude-code')], FAKE_KEYS);

  // Plant: the tree's own toy release, a scripted Claude Code (read the state, then stop) and a scripted Strands model.
  if (plantPython) {
    const { makeToyRelease } = require(path.join(path.resolve(tree), 'bench', 'physical', 'toy', 'toy-release.js'));
    const toy = makeToyRelease(path.join(root, 'in', 'toy'));
    const plant = ['--suite', 'lite', '--tasks', PLANT_TASK, '--extra-tasks', path.join(toy.dir, 'tasks'), '--plant-release', toy.dir, '--plant-release-sha256', toy.sha256, '--plant-python', plantPython, '--isolate', 'none', '--allow-unisolated', '--parallel', '1', '--replicates', '1', '--repo-root', inp.repo, '--seed', '1'];
    const pProbe = path.join(fakeDir, 'plant-claude', 'probe');
    fs.mkdirSync(pProbe, { recursive: true });
    const pBin = makeFakePlantClaude(path.join(fakeDir, 'plant-claude', 'tools'), { dir: pProbe, calls: [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {} }] });
    bench('run-plant-claude', ['run', ...plant, '--arms', 'cc-plant-policy,cc-plant-allowall', '--claude-bin', pBin, '--model', 'us.anthropic.claude-sonnet-5-5', '--budget-usd', '100', '--out', path.join(runs, 'plant-claude')], FAKE_KEYS);
    bench('plant-report-claude', ['plant-report', '--run', path.join(runs, 'plant-claude'), '--release', toy.dir, '--out', path.join(root, 'reports', 'plant-claude')]);
    if (strandsPython) {
      const script = path.join(root, 'in', 'strands-script.json');
      fs.writeFileSync(script, JSON.stringify({ turns: [{ tools: [{ name: 'get_state' }] }, { tools: [{ name: 'stop' }] }, { text: 'The line is stopped.' }] }));
      bench('run-plant-strands', ['run', ...plant, '--arms', 'st-plant-policy', '--strands-python', strandsPython, '--model', `fake:${script}`, '--out', path.join(runs, 'plant-strands')]);
      bench('plant-report-strands', ['plant-report', '--run', path.join(runs, 'plant-strands'), '--release', toy.dir, '--out', path.join(root, 'reports', 'plant-strands')]);
    }
  }

  for (const name of fs.readdirSync(runs).sort()) {
    if (name.startsWith('plant-')) continue;
    bench(`report-${name}`, ['report', '--run', path.join(runs, name), '--bench-dir', inp.bench, '--detail', 'full', '--format', 'md', '--out', path.join(root, 'reports', name)]);
  }
  fs.writeFileSync(path.join(root, 'study.json'), `${JSON.stringify({ tree: path.resolve(tree), plantPython, strandsPython, steps: results.map((r) => ({ name: r.name, exitCode: r.exitCode })) }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`study: ${e.message}\n`); process.exitCode = 2; }
}

module.exports = { main, inputs };
