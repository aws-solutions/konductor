// SPDX-License-Identifier: Apache-2.0
'use strict';

// pr-plan prints the commands for benchmarking one ref or working tree; it never runs anything.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { planPr, OBSERVED } = require('../lib/pr-plan.js');
const { main } = require('../bench.js');

const NOW = new Date('2026-03-04T05:06:07Z');

function bench(suites) {
  const root = tmp();
  makeBench(path.join(root, 'bench'));
  const dir = path.join(root, 'bench');
  const fs = require('node:fs');
  fs.mkdirSync(path.join(dir, 'suites'), { recursive: true });
  for (const [name, def] of Object.entries(suites)) fs.writeFileSync(path.join(dir, 'suites', `${name}.json`), JSON.stringify(def));
  return { root, dir };
}

const lite = { tasks: ['t1'], arms: ['vanilla', 'v1.2.0', 'main'], replicates: 1, parallel: 1 };

test('the observed table is the one given for claude-sonnet-5.5, n=1', () => {
  assert.deepEqual(OBSERVED.suites.lite.credits, { vanilla: 6.78, 'v1.2.0': 23.31, main: 31.01 });
  assert.equal(OBSERVED.suites.lite.tasks, 5);
  assert.deepEqual(OBSERVED.suites.real.credits, { vanilla: 14.22, 'v1.2.0': 61.32, main: 45.33 });
  assert.equal(OBSERVED.suites.real.tasks, 7);
  assert.deepEqual(OBSERVED.suites.hard.credits, { vanilla: 20.06 });
  assert.equal(OBSERVED.suites.hard.tasks, 6);
  assert.equal(OBSERVED.model, 'claude-sonnet-5.5');
});

test('default plan: vanilla, v1.2.0 and the new arm, a fresh --out, a seed, a budget, and the follow-up commands', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const p = planPr({ ref: 'pr-95=pr-95', suite: 'lite', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(p.arms, ['vanilla', 'v1.2.0', 'pr-95=pr-95']);
    assert.match(p.out, /^\/tmp\/konductor-bench\/runs\/pr-95-lite-20260304-050607$/);
    assert.match(p.commands.run, /^node bench\/runner\/bench\.js run --suite lite --arms vanilla,v1\.2\.0,pr-95=pr-95 /);
    assert.match(p.commands.run, /--replicates 1 /);
    assert.match(p.commands.run, /--parallel 1 /);
    assert.match(p.commands.run, new RegExp(`--seed ${p.seed} `));
    assert.match(p.commands.run, /--out \/tmp\/konductor-bench\/runs\/pr-95-lite-20260304-050607$/);
    // vanilla 6.78 + v1.2.0 23.31 + the new arm assumed like main 31.01 = 61.10 for one replicate; cap = 1.5x rounded up
    assert.ok(Math.abs(p.estimate.total - 61.1) < 1e-9);
    assert.equal(p.budget, 92);
    assert.match(p.commands.run, /--budget-credits 92 /);
    assert.equal(p.commands.contrast, `node bench/runner/bench.js contrast --run ${p.out} --base v1.2.0`);
    assert.equal(p.commands.judge, `node bench/runner/bench.js judge --run ${p.out} --baseline v1.2.0`);
    assert.equal(p.commands.report, `node bench/runner/bench.js report --run ${p.out} --baseline v1.2.0`);
    assert.match(p.text, /observed on claude-sonnet-5\.5, n=1/);
    assert.match(p.text, /prints the plan and runs nothing/i);
    assert.match(p.text, /judge.*not included|not included.*judge/i);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('--no-vanilla drops vanilla from the arms and from the estimate; replicates multiply it', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const p = planPr({ ref: 'wip=dir:/work/tree', suite: 'lite', noVanilla: true, replicates: 3, benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(p.arms, ['v1.2.0', 'wip=dir:/work/tree']);
    assert.ok(Math.abs(p.estimate.total - 3 * (23.31 + 31.01)) < 1e-9);
    assert.match(p.commands.run, /--arms v1\.2\.0,wip=dir:\/work\/tree /);
    assert.match(p.commands.run, /--replicates 3 /);
    assert.match(p.text, /3 replicates/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('a different base is allowed when the suite has an observed figure for it', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const p = planPr({ ref: 'x=feat/x', base: 'main', suite: 'lite', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(p.arms, ['vanilla', 'main', 'x=feat/x']);
    assert.match(p.commands.contrast, /--base main$/);
    assert.match(p.commands.judge, /--baseline main$/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('the real suite is scaled to the suite size, and a lower-bound figure makes the estimate a lower bound', () => {
  const b = bench({ real: { ...lite, tasks: Array.from({ length: 8 }, (_, i) => `r${i}`) } });
  try {
    const p = planPr({ ref: 'pr=feat/x', suite: 'real', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    const expected = ((14.22 + 61.32 + 45.33) / 7) * 8;
    assert.ok(Math.abs(p.estimate.total - expected) < 1e-9);
    assert.equal(p.estimate.lowerBound, true);
    assert.match(p.text, /at least/);
    assert.match(p.text, /observed on 7 tasks.*suite has 8|scaled from 7 to 8/s);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('refuses to guess: hard has no v1.2.0 or main figure, full has no table; names the missing arms', () => {
  const b = bench({ hard: { ...lite, tasks: Array.from({ length: 6 }, (_, i) => `h${i}`) }, full: lite });
  try {
    assert.throws(() => planPr({ ref: 'pr=feat/x', suite: 'hard', benchDir: b.dir, now: NOW }), (e) => /no observed credits for hard/.test(e.message) && /v1\.2\.0/.test(e.message) && /pr/.test(e.message) && /--budget-credits/.test(e.message));
    assert.throws(() => planPr({ ref: 'pr=feat/x', suite: 'full', benchDir: b.dir, now: NOW }), /no observed (table|credits) for full/);
    assert.throws(() => planPr({ ref: 'pr=feat/x', base: 'v1.1.0', suite: 'lite', benchDir: b.dir, now: NOW }), /no observed credits for lite.*v1\.1\.0/s);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('with the user own --budget-credits an unknown suite still prints a plan, marked as having no estimate', () => {
  const b = bench({ hard: { ...lite, tasks: Array.from({ length: 6 }, (_, i) => `h${i}`) } });
  try {
    const p = planPr({ ref: 'pr=feat/x', suite: 'hard', budgetCredits: 150, benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.equal(p.estimate, null);
    assert.equal(p.budget, 150);
    assert.match(p.commands.run, /--budget-credits 150 /);
    assert.match(p.text, /no estimate/i);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('arm spec problems are reported before anything is printed', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const plan = (o) => planPr({ suite: 'lite', benchDir: b.dir, now: NOW, ...o });
    assert.throws(() => plan({ ref: 'feat/x' }), /name=ref/);
    assert.throws(() => plan({ ref: 'v1.2.0=v1.2.0' }), /--ref takes name=<git ref>/);
    assert.throws(() => plan({ ref: 'vanilla=feat/x' }), /reserved/);
    assert.throws(() => plan({ ref: 'Bad Name=feat/x' }), /invalid|name/);
    assert.throws(() => plan({ ref: 'p=feat/x', base: 'p' }), /not a known arm|name=ref/);
    assert.throws(() => plan({ ref: 'p=feat/x', suite: 'nope' }), /--suite/);
    assert.throws(() => plan({}), /--ref is required/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('a ref that is not in the local repository is a warning with the fetch hint, not a failure', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  const repo = tmp();
  require('node:child_process').execFileSync('git', ['init', '-q', repo]);
  try {
    const p = planPr({ ref: 'pr-95=pr-95', suite: 'lite', benchDir: b.dir, repoRoot: repo, now: NOW, tmpRoot: '/tmp' });
    assert.equal(p.warnings.length, 1);
    assert.match(p.warnings[0], /not found.*never fetches/s);
    assert.match(p.text, /WARNING/);
    assert.ok(p.commands.run.includes(`--repo-root ${repo}`));
  } finally {
    const fs = require('node:fs');
    fs.rmSync(b.root, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('shell-hostile paths are quoted in the printed commands', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const p = planPr({ ref: "w=dir:/tmp/my tree's", suite: 'lite', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.ok(p.commands.run.includes("--arms 'vanilla,v1.2.0,w=dir:/tmp/my tree'\\''s'"), p.commands.run);
    assert.throws(() => planPr({ ref: 'w=dir:/tmp/a,b', suite: 'lite', benchDir: b.dir, now: NOW }), /comma/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('the CLI prints the plan and exits 0; a refusal prints to stderr and sets exit code 2', async () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] }, hard: lite });
  const out = [];
  const err = [];
  const [ol, oe] = [console.log, console.error];
  console.log = (m) => out.push(String(m));
  console.error = (m) => err.push(String(m));
  const prev = process.exitCode;
  try {
    await main(['pr-plan', '--ref', 'pr=feat/x', '--suite', 'lite', '--bench-dir', b.dir]);
    assert.match(out.join('\n'), /bench\.js run --suite lite --arms vanilla,v1\.2\.0,pr=feat\/x/);
    assert.notEqual(process.exitCode, 2);
    out.length = 0;
    await main(['pr-plan', '--ref', 'pr=feat/x', '--suite', 'hard', '--bench-dir', b.dir]);
    assert.equal(out.length, 0);
    assert.match(err.join('\n'), /no observed credits for hard/);
    assert.equal(process.exitCode, 2);
  } finally {
    [console.log, console.error] = [ol, oe];
    process.exitCode = prev;
    require('node:fs').rmSync(b.root, { recursive: true, force: true });
  }
});

test('several --ref arms go into one Kiro run, each estimated like main, with one out name for all of them', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const p = planPr({ ref: ['pr-1=feat/a', 'pr-2=feat/b'], suite: 'lite', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(p.arms, ['vanilla', 'v1.2.0', 'pr-1=feat/a', 'pr-2=feat/b']);
    assert.match(p.out, /\/pr-1_pr-2-lite-20260304-050607$/);
    assert.ok(Math.abs(p.estimate.total - (6.78 + 23.31 + 31.01 + 31.01)) < 1e-9);
    assert.deepEqual(p.estimate.lines.map((l) => l.basis), ['observed', 'observed', 'assumed like main', 'assumed like main']);
    assert.match(p.commands.run, /--arms vanilla,v1\.2\.0,pr-1=feat\/a,pr-2=feat\/b /);
    assert.equal(p.groups.length, 1);
    assert.throws(() => planPr({ ref: ['p=feat/a', 'p=feat/b'], suite: 'lite', benchDir: b.dir, now: NOW }), /two --ref arms are named "p"/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('--out replaces the temp-dir default; with both harnesses each run gets its own subdirectory', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const one = planPr({ ref: 'pr=feat/x', suite: 'lite', out: '/var/tmp/my-runs/pr', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.equal(one.out, '/var/tmp/my-runs/pr');
    assert.match(one.commands.run, /--out \/var\/tmp\/my-runs\/pr$/);
    const two = planPr({ ref: ['pr=feat/x', 'cc-pr=feat/x'], suite: 'lite', budgetUsd: 5, out: '/var/tmp/my-runs/pr', benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(two.groups.map((g) => g.out), ['/var/tmp/my-runs/pr/kiro-cli', '/var/tmp/my-runs/pr/claude-code']);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('a cc- arm is planned as its own Claude Code run against cc-vanilla, capped in USD, with a smoke floor and no guessed cap', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    assert.throws(() => planPr({ ref: 'cc-pr=feat/x', suite: 'lite', benchDir: b.dir, now: NOW }), /no measured USD cost for Claude Code on the lite suite.*--budget-usd/s);
    const p = planPr({ ref: ['pr=feat/x', 'cc-pr=feat/x'], suite: 'lite', budgetUsd: 4, benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    const [kiro, ccg] = p.groups;
    assert.equal(kiro.harness, 'kiro-cli');
    assert.deepEqual(ccg.arms, ['cc-vanilla', 'cc-pr=feat/x']);
    assert.equal(ccg.unit, 'USD');
    assert.equal(ccg.budget, 4);
    assert.match(ccg.commands.run, /--arms cc-vanilla,cc-pr=feat\/x .*--budget-usd 4 /);
    assert.doesNotMatch(ccg.commands.run, /--budget-credits/);
    assert.equal(ccg.commands.judge, `node bench/runner/bench.js judge --run ${ccg.out} --baseline cc-vanilla`);
    // 5 tasks, 1 replicate: 5 * 0.044 + 5 * 0.185
    assert.ok(Math.abs(ccg.estimate.total - 5 * (0.044 + 0.185)) < 1e-9);
    assert.equal(ccg.estimate.floor, true);
    assert.match(p.text, /two separate runs/);
    assert.match(p.text, /cc-pr\s+at least 0\.93/);
    assert.match(p.text, /not a forecast/);
    assert.deepEqual(p.arms, kiro.arms);
    const ccOnly = planPr({ ref: 'cc-w=dir:/work/tree', suite: 'lite', budgetUsd: 3, benchDir: b.dir, now: NOW, tmpRoot: '/tmp' });
    assert.deepEqual(ccOnly.arms, ['cc-vanilla', 'cc-w=dir:/work/tree']);
    assert.equal(ccOnly.groups.length, 1);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('a budget for a harness the plan does not have, an oc- arm and a cc base are refused', () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  try {
    const plan = (o) => planPr({ suite: 'lite', benchDir: b.dir, now: NOW, ...o });
    assert.throws(() => plan({ ref: 'pr=feat/x', budgetUsd: 3 }), /--budget-usd applies to Claude Code/);
    assert.throws(() => plan({ ref: 'cc-pr=feat/x', budgetUsd: 3, budgetCredits: 10 }), /--budget-credits applies to Kiro CLI arms/);
    assert.throws(() => plan({ ref: 'oc-pr=feat/x' }), /Kiro CLI and Claude Code \(cc-\) arms only/);
    assert.throws(() => plan({ ref: 'pr=feat/x', base: 'cc-main' }), /--base names the Kiro CLI base arm/);
    assert.throws(() => plan({ ref: 'cc-pr=feat/x', budgetUsd: 0 }), /--budget-usd must be a positive number/);
    const low = plan({ ref: 'cc-pr=feat/x', budgetUsd: 0.5, tmpRoot: '/tmp' });
    assert.match(low.warnings.join('\n'), /below the Claude Code floor/);
  } finally { require('node:fs').rmSync(b.root, { recursive: true, force: true }); }
});

test('the CLI takes --ref more than once, --out and --budget-usd', async () => {
  const b = bench({ lite: { ...lite, tasks: ['a', 'b', 'c', 'd', 'e'] } });
  const out = [];
  const err = [];
  const [ol, oe] = [console.log, console.error];
  console.log = (m) => out.push(String(m));
  console.error = (m) => err.push(String(m));
  const prev = process.exitCode;
  try {
    await main(['pr-plan', '--ref', 'a=feat/a', '--ref', 'b=feat/b', '--ref', 'cc-a=feat/a', '--budget-usd', '6', '--out', '/var/tmp/plan-x', '--suite', 'lite', '--bench-dir', b.dir]);
    const text = out.join('\n');
    assert.notEqual(process.exitCode, 2, err.join('\n'));
    assert.match(text, /--arms vanilla,v1\.2\.0,a=feat\/a,b=feat\/b .*--out \/var\/tmp\/plan-x\/kiro-cli/);
    assert.match(text, /--arms cc-vanilla,cc-a=feat\/a .*--budget-usd 6 --out \/var\/tmp\/plan-x\/claude-code/);
  } finally {
    [console.log, console.error] = [ol, oe];
    process.exitCode = prev;
    require('node:fs').rmSync(b.root, { recursive: true, force: true });
  }
});
