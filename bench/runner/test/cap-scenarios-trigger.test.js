// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap scenarios --mode trigger: tasks that should load a skill on their own and near misses that should not, drafted for
// review. A fake model answers; --dry-run never calls a model and never needs credentials.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, scratch } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { scanRepo } = require('../../cap/scan.js');
const { queriesFromDraft } = require('../../cap/trigger.js');
const S = require('../../cap/scenarios.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// alpha's text says "Validate every input. Escape output." and its description talks about input handling and injection.
const OPENINGS = ['our signup handler', 'hey can you', 'i maintain a', 'the orders api', 'quick one about', 'we got a', 'before friday i', 'looking at src', 'my lead asked', 'so the form'];
const trig = (i, extra = {}) => ({
  title: `Trigger ${i}`, expect: 'trigger',
  prompt: `${OPENINGS[i % OPENINGS.length]} request ${i}: the POST /signup route in src/routes/signup.js passes req.body.email straight into a query string; tighten it up and list what you changed in notes.md.`,
  fixtureIdea: 'A tiny express app with one route that builds a query from raw input.',
  checkIdeas: ['the route rejects an email with a quote in it'],
  whyItMatters: 'The task needs careful input handling, which the skill covers.',
  ...extra,
});
const near = (i, extra = {}) => ({
  title: `Near ${i}`, expect: 'near-miss',
  prompt: `Near miss ${i}: write a migration for the users table in db/migrations that adds an input_source column, with a rollback, for the reporting team.`,
  nearMissOf: 'skill:beta', sharedTerms: ['input'],
  fixtureIdea: 'A db folder with two earlier migrations and a schema file.',
  checkIdeas: ['a new migration file and its rollback exist'],
  whyItMatters: 'It mentions input but is a schema change, not input handling.',
  ...extra,
});
const reply = ({ t = 10, n = 10 } = {}) => ({ scenarios: [...Array.from({ length: t }, (_, i) => trig(i)), ...Array.from({ length: n }, (_, i) => near(i))] });

const fakeModel = (replies) => {
  const queue = [...replies];
  return async () => ({ text: typeof queue[0] === 'string' ? queue.shift() : JSON.stringify(queue.shift()), credits: 0.3, latencyMs: 5 });
};

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { tag: 'v0' });
  const scan = scanRepo(r.repo);
  return { root, scan, repo: r.repo, alpha: scan.get('skill:alpha'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const check = (s, d, over = {}) => S.validateTriggerScenarios(d, { capName: 'alpha', capText: s.alpha.text, neighbourIds: ['skill:delta', 'skill:beta'], n: 10, ...over });

test('trigger mode asks for 8 to 10 of each kind, 10 by default', () => {
  assert.equal(S.checkTriggerCount(undefined), 10);
  assert.equal(S.checkTriggerCount(8), 8);
  assert.throws(() => S.checkTriggerCount(7), /8 to 10/);
  assert.throws(() => S.checkTriggerCount(11), /8 to 10/);
});

test('the prompt carries the skill, its neighbours, the seeds and skill-creator rules, and no dashes', () => {
  const s = setup();
  try {
    const neighbours = [{ id: 'skill:delta', score: 0.8, description: 'Use when reviewing backend code for input handling and injection hazards.' }];
    const p = S.buildTriggerPrompt({ cap: s.alpha, neighbours, seeds: [{ text: 'check my login form for sql injection', shouldTrigger: true }, { text: 'write a migration', shouldTrigger: false }], n: 9 });
    assert.match(p, /Validate every input/);
    assert.match(p, /skill:delta: Use when reviewing/);
    assert.match(p, /should-load[^]*check my login form for sql injection/);
    assert.match(p, /should-not-load:\n- write a migration/);
    assert.match(p, /Write 9 tasks with expect "trigger" and 9 with expect "near-miss"/);
    assert.match(p, /file paths/);
    assert.match(p, /Do not write obviously unrelated tasks/);
    assert.match(p, /competes with a similar capability above and should win/);
    assert.match(p, /Never name the skill/);
    assert.doesNotMatch(p, /[–—]/);
  } finally { s.done(); }
});

test('a good reply validates', () => {
  const s = setup();
  try { assert.equal(check(s, reply()).ok, true); } finally { s.done(); }
});

test('validation names the first problem', () => {
  const s = setup();
  try {
    const v = (d) => check(s, d).error;
    assert.match(v({}), /scenarios must be an array/);
    assert.match(v(reply({ t: 9 })), /too few trigger tasks: 9, need at least 10/);
    assert.match(v(reply({ n: 13 })), /too many near-miss tasks \(13\), at most 12/);
    const named = reply();
    named.scenarios[0].prompt = 'please run the alpha review over src/routes/signup.js and list every unvalidated field in notes.md';
    assert.match(v(named), /scenarios\[0\]\.prompt: it names the capability "alpha"/);
    const same = reply();
    for (const i of [0, 1, 2]) same.scenarios[i].prompt = `fix this now ${i}: the POST /signup route in src/routes/signup.js passes raw input into a query; tighten it.`;
    assert.match(v(same), /scenarios\[2\]: more than 2 trigger prompts start with "fix this now"/);
    const noTerm = reply();
    noTerm.scenarios[10].sharedTerms = ['kubernetes'];
    assert.match(v(noTerm), /scenarios\[10\]: shared term "kubernetes" must appear in both the prompt and the skill text/);
    const unshared = reply();
    delete unshared.scenarios[11].sharedTerms;
    assert.match(v(unshared), /scenarios\[11\]\.sharedTerms/);
    const stranger = reply();
    stranger.scenarios[12].nearMissOf = 'skill:gamma';
    assert.match(v(stranger), /nearMissOf "skill:gamma" is not one of the neighbours/);
    const owned = reply();
    for (let i = 10; i < 16; i++) delete owned.scenarios[i].nearMissOf;
    assert.match(v(owned), /at least half of the 10 near misses must name the neighbour/);
    const wrongSide = reply();
    wrongSide.scenarios[3].nearMissOf = 'skill:beta';
    assert.match(v(wrongSide), /scenarios\[3\]: nearMissOf only applies to near-miss tasks/);
    const dash = reply();
    dash.scenarios[4].whyItMatters += ' — really';
    assert.match(v(dash), /scenarios\[4\] contains an em or en dash/);
  } finally { s.done(); }
});

test('seeds come from a skill-creator eval set or a cap draft file, capped at 20', () => {
  const sc = S.parseSeed([{ query: 'check  my\nform', should_trigger: true }, { query: 'write a migration', should_trigger: false }]);
  assert.deepEqual(sc, [{ text: 'check my form', shouldTrigger: true }, { text: 'write a migration', shouldTrigger: false }]);
  const draft = S.parseSeed({ capId: 'skill:alpha', queries: [{ text: 'a', expect: 'load' }, { text: 'b', expect: 'none' }] }, { capId: 'skill:alpha' });
  assert.deepEqual(draft.map((x) => x.shouldTrigger), [true, false]);
  assert.equal(S.parseSeed(Array.from({ length: 30 }, (_, i) => ({ query: `q${i}`, should_trigger: i % 2 === 0 }))).length, 20);
  assert.throws(() => S.parseSeed({ capId: 'skill:beta', queries: [] }, { capId: 'skill:alpha' }), /for skill:beta, not skill:alpha/);
  assert.throws(() => S.parseSeed([{ query: 'x' }]), /should_trigger/);
  assert.throws(() => S.parseSeed({ nope: 1 }), /skill-creator eval set/);
});

test('generateTriggerScenarios writes an unreviewed review file with a queries view that cap trigger reads', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const r = await S.generateTriggerScenarios({ capId: 'skill:alpha', scan: s.scan, caller: fakeModel([reply()]), model: 'm', n: 10, outDir: out, seeds: [{ text: 'x', shouldTrigger: true }], seedFile: '/somewhere/eval_set.json' });
    assert.equal(r.ok, true);
    assert.equal(r.calls, 1);
    const d = JSON.parse(fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.trigger.json'), 'utf8'));
    assert.equal(d.status, 'draft-unreviewed');
    assert.equal(d.mode, 'trigger');
    assert.deepEqual([d.generatedBy.seeds, d.generatedBy.seedFile], [1, 'eval_set.json']);
    assert.deepEqual(d.scenarios.slice(9, 11).map((x) => x.id), ['t10', 'n01']);
    assert.equal(d.queries.length, 20);
    const q = queriesFromDraft(path.join(out, 'scenarios', 'skill-alpha.trigger.json'), 'skill:alpha');
    assert.deepEqual([q.filter((x) => x.expect === 'load').length, q.filter((x) => x.expect === 'none').length], [10, 10]);
    assert.equal(q.find((x) => x.id === 'n01').nearMissOf, 'skill:beta');
    const md = fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.trigger.md'), 'utf8');
    assert.match(md, /Review checklist/);
    assert.match(md, /## Should load the skill \(10\)/);
    assert.match(md, /### n01: Near 0 \(near miss of skill:beta\)/);
    assert.match(md, /shared terms: input/);
    assert.equal(fs.existsSync(path.join(out, 'scenarios', 'skill-alpha.json')), false, 'the lift-mode file is not written');
  } finally { s.done(); }
});

test('a bad first reply is retried once; two bad replies write nothing; a dry run calls nothing', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const ok = await S.generateTriggerScenarios({ capId: 'skill:alpha', scan: s.scan, caller: fakeModel(['not json', reply()]), model: 'm', outDir: out });
    assert.deepEqual([ok.ok, ok.calls], [true, 2]);
    const bad = await S.generateTriggerScenarios({ capId: 'skill:beta', scan: s.scan, caller: fakeModel(['no', { scenarios: [] }]), model: 'm', outDir: out });
    assert.equal(bad.ok, false);
    assert.equal(fs.existsSync(path.join(out, 'scenarios', 'skill-beta.trigger.json')), false);
    let called = 0;
    const dry = await S.generateTriggerScenarios({ capId: 'skill:beta', scan: s.scan, caller: async () => { called++; return { text: '', credits: 1 }; }, model: 'm', outDir: out, dryRun: true });
    assert.deepEqual([called, dry.calls, dry.credits], [0, 0, 0]);
    assert.ok(fs.existsSync(path.join(out, 'scenarios', 'skill-beta.trigger.prompt.txt')));
    await assert.rejects(S.generateTriggerScenarios({ capId: 'sop:k-plan', scan: s.scan, caller: fakeModel([]), model: 'm', outDir: out }), /skills only/);
  } finally { s.done(); }
});

// ---- CLI ----

function cliEnv(root) {
  const home = path.join(root, 'h');
  fs.mkdirSync(home, { recursive: true });
  return { PATH: process.env.PATH, HOME: home, TMPDIR: root };
}

test('cap scenarios --mode trigger --dry-run with a seed file calls nothing and writes the prompt with the seeds', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const seed = path.join(s.root, 'eval_set.json');
    write(seed, JSON.stringify([{ query: 'can you harden the signup form against injection', should_trigger: true }, { query: 'add a column to users', should_trigger: false }]));
    const out = path.join(s.root, 'out');
    const common = ['--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'];
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--mode', 'trigger', '--n', '8', '--seed-queries', seed, '--dry-run', '--out', out, ...common], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 call\(s\) would be made for 8 should-trigger and 8 near-miss tasks per skill/);
    const prompt = fs.readFileSync(path.join(out, 'scenarios', 'skill-alpha.trigger.prompt.txt'), 'utf8');
    assert.match(prompt, /harden the signup form against injection/);
    assert.match(prompt, /Write 8 tasks with expect "trigger"/);
    const run = (extra) => spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', ...extra, '--dry-run', '--out', path.join(s.root, 'o2'), ...common], { encoding: 'utf8', env: cliEnv(s.root) });
    const lift = run(['--cap', 'skill:alpha', '--seed-queries', seed]);
    assert.equal(lift.status, 2);
    assert.match(lift.stderr, /--seed-queries applies to --mode trigger only/);
    const two = run(['--cap', 'skill:alpha,skill:beta', '--mode', 'trigger', '--seed-queries', seed]);
    assert.match(two.stderr, /pass one --cap with it/);
    const mode = run(['--cap', 'skill:alpha', '--mode', 'sometimes']);
    assert.match(mode.stderr, /--mode takes lift/);
    const many = run(['--cap', 'skill:alpha', '--mode', 'trigger', '--n', '12']);
    assert.match(many.stderr, /8 to 10/);
  } finally { s.done(); }
});

test('cap scenarios --mode trigger with a command model writes the review files', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const cmd = path.join(s.root, 'model.js');
    write(cmd, `#!/usr/bin/env node\nprocess.stdin.on('data',()=>{}).on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(reply()))}));\n`);
    const out = path.join(s.root, 'out');
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'scenarios', '--cap', 'skill:alpha', '--mode', 'trigger', '--model-cmd', `node ${cmd}`, '--out', out, '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env: cliEnv(s.root) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skill-alpha\.trigger\.json and skill-alpha\.trigger\.md \(10 should-trigger and 10 near-miss tasks/);
  } finally { s.done(); }
});
