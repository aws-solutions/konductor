// SPDX-License-Identifier: Apache-2.0
'use strict';

// --profile quick|detailed through the CLI: run (replicates, A/A arm), judge (modes), report (detail, check, sample).
// Every spawn gets a scratch HOME. No kiro-cli is installed on PATH for these tests, and nothing is judged by a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;

function env(root) {
  const home = path.join(root, 'home');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmpdir, { recursive: true });
  return { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
}

function gitRepo(root) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const run = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: env(root) });
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
  run('add', 'f.txt');
  run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  return { repo, sha: run('rev-parse', 'HEAD').stdout.trim() };
}

const cli = (root, args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: env(root), cwd: root });

test('run --profile detailed refuses fewer than 5 replicates and quick refuses more than 3, before anything is created', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const base = ['run', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--bench-dir', bench, '--out', path.join(root, 'out')];
    const d = cli(root, [...base, '--profile', 'detailed', '--replicates', '3']);
    assert.equal(d.status, 1);
    assert.match(d.stderr, /profile detailed needs at least 5 replicates per cell \(got 3\)/);
    const q = cli(root, [...base, '--profile', 'quick', '--replicates', '5']);
    assert.equal(q.status, 1);
    assert.match(q.stderr, /profile quick allows 1 to 3 replicates \(got 5\)/);
    const bogus = cli(root, [...base, '--profile', 'thorough']);
    assert.equal(bogus.status, 1);
    assert.match(bogus.stderr, /--profile takes quick or detailed/);
    assert.equal(fs.existsSync(path.join(root, 'out')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('run --profile detailed plans 5 replicates and adds an A/A arm at the exact commit of the first konductor arm', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const { repo, sha } = gitRepo(root);
    const r = cli(root, ['run', '--suite', 'lite', '--arms', 'vanilla,x=main', '--tasks', 't1', '--bench-dir', bench, '--repo-root', repo, '--profile', 'detailed', '--out', path.join(root, 'out'), '--isolate', 'none', '--allow-unisolated']);
    assert.match(r.stderr, new RegExp(`A/A arm x-b repeats x at ${sha.slice(0, 7)}`));
    assert.match(r.stderr, /15 planned run\(s\)/, 'one task, three arms (vanilla, x, x-b), five replicates');
    assert.match(r.stderr, /no credit cap is set/);
    assert.match(r.stderr, /kiro-cli auth database not found/, 'it went on to the next check and stopped there, with no credits spent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('run --profile quick adds no A/A arm and plans its default replicates', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const { repo } = gitRepo(root);
    const r = cli(root, ['run', '--suite', 'lite', '--arms', 'vanilla,x=main', '--tasks', 't1', '--bench-dir', bench, '--repo-root', repo, '--profile', 'quick', '--out', path.join(root, 'out'), '--isolate', 'none', '--allow-unisolated']);
    assert.doesNotMatch(r.stderr, /A\/A arm/);
    assert.match(r.stderr, /4 planned run\(s\)/, 'one task, two arms, two replicates');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('run without a profile keeps the suite defaults and adds no arm', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const { repo } = gitRepo(root);
    const r = cli(root, ['run', '--suite', 'lite', '--arms', 'vanilla,x=main', '--tasks', 't1', '--bench-dir', bench, '--repo-root', repo, '--out', path.join(root, 'out'), '--isolate', 'none', '--allow-unisolated']);
    assert.doesNotMatch(r.stderr, /A\/A arm/);
    assert.match(r.stderr, /2 planned run\(s\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function judged(root, extra = []) {
  const bench = makeBench(path.join(root, 'bench'));
  const dir = makeRun(path.join(root, 'run'), bench, ['vanilla', 'k'].flatMap((arm) => [1, 2, 3].map((rep) => ({ arm, rep }))));
  const j = cli(root, ['judge', '--run', dir, '--bench-dir', bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE, ...extra]);
  return { bench, dir, j };
}

test('judge --profile detailed runs rubric, pairwise and graded, prints the ledger totals and writes the ledger', () => {
  const root = tmp();
  try {
    const { dir, j } = judged(root, ['--profile', 'detailed']);
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8'));
    assert.deepEqual(out.modes, ['graded', 'pairwise', 'rubric']);
    assert.equal(out.graded.length, 3);
    assert.ok(out.graded.every((g) => g.judgeError === null && g.orderings.every(Boolean)));
    assert.match(j.stdout, /credits: this command 0\.00 \(no cap\), study total 0\.00/);
    const lines = fs.readFileSync(path.join(dir, 'credit-ledger.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 6 + 6 + 6, 'six rubric calls, six pairwise calls, six graded calls');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('judge without a profile keeps rubric and pairwise only, and graded can be asked for with --mode', () => {
  const root = tmp();
  try {
    const { dir, j } = judged(root);
    assert.equal(j.status, 0, j.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8')).modes, ['pairwise', 'rubric']);
    const g = cli(root, ['judge', '--run', dir, '--bench-dir', path.join(root, 'bench'), '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE, '--mode', 'graded']);
    assert.equal(g.status, 0, g.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8')).modes, ['graded', 'pairwise', 'rubric']);
    const bad = cli(root, ['judge', '--run', dir, '--bench-dir', path.join(root, 'bench'), '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE, '--mode', 'ranked']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--mode takes rubric, pairwise, graded/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report --profile detailed gives the full report, a profile check and the calibration sample in the results dir', () => {
  const root = tmp();
  try {
    const { bench, dir } = judged(root, ['--profile', 'detailed']);
    const r = cli(root, ['report', '--run', dir, '--bench-dir', bench, '--profile', 'detailed', '--format', 'md']);
    assert.equal(r.status, 0, r.stderr);
    const md = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
    assert.match(md, /Profile detailed/);
    assert.match(md, /Profile check/);
    assert.match(md, /no A\/A arm or same-ref repeat/);
    assert.match(md, /## Appendix: provenance/, 'full detail');
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'calibration-sample.json'), 'utf8'));
    assert.equal(s.items.length, 6, 'fewer runs than the 25 asked for');
    assert.match(fs.readFileSync(path.join(dir, 'calibration-sample.md'), 'utf8'), /calibrate export/);
    assert.match(r.stdout, /wrote .*calibration-sample\.md/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report --profile quick is the one-page report with the anecdotal note and writes no sample; --detail still wins', () => {
  const root = tmp();
  try {
    const { bench, dir } = judged(root);
    const q = cli(root, ['report', '--run', dir, '--bench-dir', bench, '--profile', 'quick', '--format', 'md', '--out', path.join(root, 'q')]);
    assert.equal(q.status, 0, q.stderr);
    const md = fs.readFileSync(path.join(root, 'q', 'report.md'), 'utf8');
    assert.match(md, /Profile quick/);
    assert.match(md, /Benchmark report \(quick\)/);
    assert.equal(fs.existsSync(path.join(dir, 'calibration-sample.json')), false);
    const f = cli(root, ['report', '--run', dir, '--bench-dir', bench, '--profile', 'quick', '--detail', 'full', '--format', 'md', '--out', path.join(root, 'f')]);
    assert.match(fs.readFileSync(path.join(root, 'f', 'report.md'), 'utf8'), /Benchmark report \(full\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report on several run directories skips the calibration sample and says why', () => {
  const root = tmp();
  try {
    const { bench, dir } = judged(root);
    const bench2 = makeBench(path.join(root, 'bench2'));
    const dir2 = makeRun(path.join(root, 'run2'), bench2, ['vanilla', 'k'].map((arm) => ({ arm })));
    const r = cli(root, ['report', '--run', `${dir},${dir2}`, '--bench-dir', bench, '--profile', 'detailed', '--format', 'md', '--out', path.join(root, 'm')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /calibration sample: not written for merged run directories/);
    assert.equal(fs.existsSync(path.join(dir, 'calibration-sample.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
