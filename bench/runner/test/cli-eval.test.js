// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const cli = (args, env = {}) => spawnSync('node', [BENCH, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

function setup(headCredits = 1) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const mk = (name, credits) => makeRun(path.join(root, name), bench, ['vanilla', 'k'].flatMap((arm) => [1, 2, 3].map((rep) => ({ arm, rep, credits }))));
  return { root, bench, base: mk('base', 1), head: mk('head', headCredits) };
}

test('judge, report and calibrate work end to end through the CLI with a fake judge', () => {
  const s = setup();
  try {
    const j = cli(['judge', '--run', s.base, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE]);
    assert.equal(j.status, 0, j.stderr);
    assert.match(j.stdout, /live spend 0\.000/);
    const r = cli(['report', '--run', s.base, '--bench-dir', s.bench]);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(fs.readFileSync(path.join(s.base, 'report.json'), 'utf8'));
    assert.equal(rep.arms.k.overall.n, 3);
    assert.deepEqual(rep.judges, ['gpt-test']);
    assert.match(fs.readFileSync(path.join(s.base, 'report.md'), 'utf8'), /estTokens \(estimate\)/);
    const c = cli(['calibrate', 'export', '--run', s.base, '--bench-dir', s.bench, '--n', '3', '--seed', '0']);
    assert.equal(c.status, 0, c.stderr);
    const sc = cli(['calibrate', 'score', '--labels', path.join(s.base, 'calibration/sheet.json')]);
    assert.equal(sc.status, 0, sc.stderr);
    assert.match(sc.stdout, /gpt-test\s+WARN/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('judge refuses a Claude model and a missing judge command target', () => {
  const s = setup();
  try {
    const r = cli(['judge', '--run', s.base, '--bench-dir', s.bench, '--judges', 'claude-sonnet-4.6', '--allow-small-panel', '--judge-cmd', FAKE]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Claude model/);
    assert.equal(fs.existsSync(path.join(s.base, 'judgments.json')), false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('judge budget guard stops spending and keeps every record', () => {
  const s = setup();
  try {
    const r = cli(['judge', '--run', s.base, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--mode', 'rubric', '--judge-cmd', FAKE, '--budget-credits', '0.001', '--concurrency', '1']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(fs.readFileSync(path.join(s.base, 'judgments.json'), 'utf8'));
    assert.equal(j.rubric.length, 6);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('compare exit codes: 0 same, 1 regression, 2 refusal or bad input', () => {
  const same = setup(1);
  const worse = setup(3);
  try {
    assert.equal(cli(['compare', '--base', same.base, '--head', same.head, '--bench-dir', same.bench]).status, 0);
    const reg = cli(['compare', '--base', worse.base, '--head', worse.head, '--bench-dir', worse.bench]);
    assert.equal(reg.status, 1);
    assert.match(reg.stdout, /REGRESSIONS \(\d+\)/);
    assert.match(reg.stdout, /credits/);
    const cfg = path.join(worse.head, 'run-config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), effort: 'low' }));
    const refused = cli(['compare', '--base', worse.base, '--head', worse.head, '--bench-dir', worse.bench]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /effort/);
    assert.equal(cli(['compare', '--base', worse.base, '--head', worse.head, '--bench-dir', worse.bench, '--force']).status, 1);
    assert.equal(cli(['compare', '--base', worse.base, '--head', '/nonexistent']).status, 2);
  } finally {
    fs.rmSync(same.root, { recursive: true, force: true });
    fs.rmSync(worse.root, { recursive: true, force: true });
  }
});

test('recheck prints before/after tallies, supports --dry-run, and is a no-op the second time', () => {
  const s = setup();
  try {
    const taskFile = path.join(s.bench, 'tasks/t1.json');
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    fs.writeFileSync(taskFile, JSON.stringify({ ...task, checks: [{ type: 'file_exists', path: 'a.txt' }, { type: 'file_exists', path: 'b.txt' }] }));
    const dry = cli(['recheck', '--run', s.base, '--bench-dir', s.bench, '--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /would recheck 6/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.base, 'k/t1/1/result.json'), 'utf8')).checksOriginal, undefined);
    const r = cli(['recheck', '--run', s.base, '--bench-dir', s.bench]);
    assert.match(r.stdout, /k\/t1\/1: rechecked; checks 1\/1 -> 2\/2/);
    assert.match(r.stdout, /rechecked 6, unchanged 0, skipped 0/);
    const again = cli(['recheck', '--run', s.base, '--bench-dir', s.bench]);
    assert.match(again.stdout, /rechecked 0, unchanged 6, skipped 0/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
