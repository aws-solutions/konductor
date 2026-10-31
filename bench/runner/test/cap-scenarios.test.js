// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap scenarios: at least 8 candidate scenarios per skill, written to a review file. A fake model answers; --dry-run
// never calls a model and never needs credentials.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, scratch } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { scanRepo } = require('../../cap/scan.js');
const S = require('../../cap/scenarios.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

const sc = (i, expect = 'helps', extra = {}) => ({
  title: `Scenario ${i}`, expect,
  prompt: `Request number ${i}: please look at the order service and fix the problem you find, then write up what you changed in notes.md.`,
  fixtureIdea: 'A small service with one seeded defect and a README that does not mention it.',
  checkIdeas: ['notes.md exists', 'the seeded defect no longer reproduces'],
  rubricIdeas: ['names the root cause'],
  whyItMatters: expect === 'helps' ? 'The skill gives the steps a careless pass would skip.' : 'The task is simple enough that the skill should change nothing.',
  ...extra,
});

function goodReply({ helps = 6, neutral = 2 } = {}) {
  return { scenarios: [...Array.from({ length: helps }, (_, i) => sc(i, 'helps')), ...Array.from({ length: neutral }, (_, i) => sc(50 + i, 'neutral'))] };
}

const fakeModel = (replies) => {
  const queue = [...replies];
  const fn = async () => ({ text: typeof queue[0] === 'string' ? queue.shift() : JSON.stringify(queue.shift()), credits: 0.2, latencyMs: 5 });
  return fn;
};

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { tag: 'v0' });
  return { root, scan: scanRepo(r.repo), repo: r.repo, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the minimum is 8 scenarios per skill', () => {
  assert.equal(S.MIN_SCENARIOS, 8);
  assert.throws(() => S.checkCount(7), /at least 8/);
  assert.equal(S.checkCount(8), 8);
  assert.equal(S.checkCount(undefined), 8);
  assert.throws(() => S.checkCount(40), /at most 30/);
});

test('the prompt carries the skill text, asks for the count, and forbids naming the skill', () => {
  const s = setup();
  try {
    const p = S.buildScenarioPrompt({ cap: s.scan.get('skill:alpha'), n: 8 });
    assert.match(p, /Validate every input/);
    assert.match(p, /8 scenarios/);
    assert.match(p, /never name the skill/i);
    assert.match(p, /"expect"/);
    assert.doesNotMatch(p, /[\u2013\u2014]/);
  } finally { s.done(); }
});

test('a good reply validates: 6 that should help and 2 that should not matter', () => {
  assert.equal(S.validateScenarios(goodReply(), { capName: 'alpha', n: 8 }).ok, true);
});

test('validation names the first problem', () => {
  const v = (d, n = 8) => S.validateScenarios(d, { capName: 'alpha', n });
  assert.match(v({}).error, /scenarios must be an array/);
  assert.match(v(goodReply({ helps: 5, neutral: 2 })).error, /too few scenarios: 7, need at least 8/);
  assert.match(v(goodReply({ helps: 4, neutral: 4 })).error, /at least 6 scenarios must expect "helps"/);
  assert.match(v(goodReply({ helps: 8, neutral: 0 })).error, /at least 1 scenario must expect "neutral"/);
  const bad = goodReply();
  bad.scenarios[0].prompt = 'Use the alpha skill to review the code and write notes.md with what you found.';
  assert.match(v(bad).error, /scenarios\[0\]\.prompt names the capability "alpha"/);
  const dash = goodReply();
  dash.scenarios[1].prompt += ' \u2014 thanks';
  assert.match(v(dash).error, /scenarios\[1\].*dash/);
  const dup = goodReply();
  dup.scenarios[2].prompt = dup.scenarios[1].prompt;
  assert.match(v(dup).error, /scenarios\[2\].*duplicate/);
  const noChecks = goodReply();
  noChecks.scenarios[3].checkIdeas = [];
  assert.match(v(noChecks).error, /scenarios\[3\].*checkIdeas/);
  const proc = goodReply();
  proc.scenarios[4].prompt = 'Run the k-plan SOP on the order service and write notes.md describing the result of it.';
  assert.match(v(proc).error, /scenarios\[4\].*konductor procedure/);
  const expect = goodReply();
  expect.scenarios[5].expect = 'maybe';
  assert.match(v(expect).error, /scenarios\[5\]\.expect/);
});

test('generateScenarios writes the review json and a readable md, unreviewed, and reports the credits', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const r = await S.generateScenarios({ capId: 'skill:alpha', scan: s.scan, caller: fakeModel([goodReply()]), model: 'm', n: 8, outDir: out });
    assert.equal(r.ok, true);
    assert.equal(r.calls, 1);
    assert.equal(r.credits, 0.2);
    const d = JSON.parse(fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.json'), 'utf8'));
    assert.equal(d.status, 'draft-unreviewed');
    assert.equal(d.scenarios.length, 8);
    assert.deepEqual(d.scenarios.map((x) => x.id).slice(0, 2), ['s01', 's02']);
    assert.equal(d.generatedBy.model, 'm');
    const md = fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.md'), 'utf8');
    assert.match(md, /Review checklist/);
    assert.match(md, /s01 \(helps\)/);
    assert.match(md, /Scenario 0/);
  } finally { s.done(); }
});

test('a bad first reply is retried once; a second bad reply writes nothing', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const ok = await S.generateScenarios({ capId: 'skill:alpha', scan: s.scan, caller: fakeModel(['not json', goodReply()]), model: 'm', n: 8, outDir: out });
    assert.equal(ok.ok, true);
    assert.equal(ok.calls, 2);
    const bad = await S.generateScenarios({ capId: 'skill:beta', scan: s.scan, caller: fakeModel(['nope', { scenarios: [] }]), model: 'm', n: 8, outDir: out });
    assert.equal(bad.ok, false);
    assert.equal(fs.existsSync(path.join(out, 'scenarios', 'skill-beta.json')), false);
  } finally { s.done(); }
});

test('a dry run makes no model call, spends nothing and writes the prompt for review', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    let called = 0;
    const r = await S.generateScenarios({ capId: 'skill:alpha', scan: s.scan, caller: async () => { called++; return { text: '', credits: 9 }; }, model: 'm', n: 8, outDir: out, dryRun: true });
    assert.equal(called, 0);
    assert.deepEqual([r.ok, r.dryRun, r.calls, r.credits], [true, true, 0, 0]);
    const prompt = fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.prompt.txt'), 'utf8');
    assert.match(prompt, /Validate every input/);
    assert.equal(fs.existsSync(path.join(out, 'scenarios', 'skill-alpha.json')), false);
  } finally { s.done(); }
});

test('an unknown capability, a context file and a SOP-less kind are refused', async () => {
  const s = setup();
  try {
    await assert.rejects(S.generateScenarios({ capId: 'skill:nope', scan: s.scan, caller: fakeModel([]), model: 'm', n: 8, outDir: s.root }), /unknown capability/);
    await assert.rejects(S.generateScenarios({ capId: 'context:core', scan: s.scan, caller: fakeModel([]), model: 'm', n: 8, outDir: s.root }), /skill/);
    await assert.rejects(S.generateScenarios({ capId: 'sop:k-plan', scan: s.scan, caller: fakeModel([]), model: 'm', n: 8, outDir: s.root }), /skill/);
  } finally { s.done(); }
});

// ---- CLI ----

function cliEnv(root) {
  const home = path.join(root, 'h');
  fs.mkdirSync(home, { recursive: true });
  return { PATH: process.env.PATH, HOME: home, TMPDIR: root };
}

test('cap scenarios --dry-run needs no login, calls nothing and writes only into --out', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const before = fs.readdirSync(bench).sort();
    const marker = path.join(s.root, 'called');
    const cmd = path.join(s.root, 'model.js');
    write(cmd, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    const out = path.join(s.root, 'out');
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha,skill:beta', '--dry-run', '--model-cmd', `node ${cmd}`, '--out', out, '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dry run: no model call was made and no credits were spent; 2 call\(s\) would be made for 8 scenarios per skill/);
    assert.equal(fs.existsSync(marker), false);
    assert.ok(fs.existsSync(path.join(out, 'scenarios', 'skill-alpha.prompt.txt')));
    assert.ok(fs.existsSync(path.join(out, 'scenarios', 'skill-beta.prompt.txt')));
    assert.deepEqual(fs.readdirSync(bench).sort(), before);
    const noLogin = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--dry-run', '--out', path.join(s.root, 'o2'), '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(noLogin.status, 0, noLogin.stderr);
  } finally { s.done(); }
});

test('cap scenarios with a command model writes the review files (the live path, against a fake model)', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const cmd = path.join(s.root, 'model.js');
    write(cmd, `#!/usr/bin/env node\nprocess.stdin.on('data',()=>{}).on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(goodReply()))}));\n`);
    const out = path.join(s.root, 'out');
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--model-cmd', `node ${cmd}`, '--out', out, '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skill:alpha: wrote .*skill-alpha\.json and skill-alpha\.md \(8 scenarios/);
    assert.ok(fs.existsSync(path.join(out, 'scenarios', 'skill-alpha.md')));
  } finally { s.done(); }
});

test('cap scenarios refuses fewer than 8, an output directory inside the repository, and a missing --cap', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const common = ['--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0', '--dry-run'];
    const few = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--n', '5', '--out', path.join(s.root, 'o'), ...common], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(few.status, 2);
    assert.match(few.stderr, /--n must be an integer from 8 to 30/);
    const inRepo = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--out', path.join(s.repo, 'x'), ...common], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(inRepo.status, 2);
    assert.match(inRepo.stderr, /inside the repository/);
    const none = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--out', path.join(s.root, 'o'), ...common], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(none.status, 2);
    assert.match(none.stderr, /--cap is required/);
  } finally { s.done(); }
});
