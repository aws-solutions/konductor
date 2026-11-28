// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap skill-author` (BACKLOG B-027), tested free: a hand-written source becomes a draft baseline folder that the frozen
// verifier passes (skillsource.js), and the paid path writes one with two families on a fake kiro-cli
// (fake-kp-kiro.js), with the one-fix rule and a review-only check of a hand draft (skillauthor.js). No model, no spend.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const { writeDraft, defaultSelection } = require('../../cap/skillsource.js');
const { authorSkill, reviewDraft, planOf } = require('../../cap/skillauthor.js');
const { verifyBaselines } = require('../../cap/baselineverify.js');

const FAKE = path.join(__dirname, 'fake-kp-kiro.js');
process.env.BENCH_PAID_ENV_KEEP = ['LOG', 'FAIL', 'NOFIX'].map((n) => `FAKE_KP_${n}`).join(',');
const SKILL = 'demo-check';
const SKILL_MD = [
  '---', `name: ${SKILL}`, 'description: Use when asked to check a demo plan before release.', '---', '', '# Demo Check', '',
  'Always confirm the rollback step exists before release.',
  'Report the plan length in a single opening line.',
  'Flag every external dependency that has no named owner.',
  'Ask for a measured figure behind every latency promise.',
  'Keep each finding tied to the plan section it came from.', '',
].join('\n');
const LONG = 'Our team is about to release a small change to the billing service next Tuesday, and the plan below lists the steps, the people involved, the systems it touches and the checks we intend to run before and after the switch. Please look it over and tell us what is missing.';

const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const git = (repo, ...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });

/** A git repo with one skill and its skill-evals queries, a drafts folder, a work dir and a fake sign-in db. */
function rig(t) {
  const root = mkScratch('ksa-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'skills', SKILL, 'SKILL.md'), SKILL_MD);
  const queries = [
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ query: `Please look over release plan number ${i} for gaps before we ship it.`, should_trigger: true })),
    { query: `Run ${SKILL} on this plan right now please.`, should_trigger: true },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ query: `Write the release notes for version ${i} of the app.`, should_trigger: false })),
  ];
  write(path.join(repo, 'bench', 'skill-evals', 'skills', SKILL, 'queries.json'), JSON.stringify(queries));
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'fixture');
  const authDb = path.join(root, 'auth.sqlite3');
  write(authDb, 'fake');
  const log = path.join(root, 'calls.log');
  const paid = { cap: 1000, ledger: path.join(root, 'ledger.jsonl'), workDir: path.join(root, 'work'), bin: FAKE, authDb };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ').slice(0, 2).join(' ')) : []);
  return { root, repo, out: path.join(root, 'drafts'), paid, log, calls };
}

function withEnv(env, fn) {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const task = (n) => ({ title: `Plan ${n}`, section: 'Demo Check', prompt: `${LONG} (case ${n})`, why: 'tests the checks',
  rubric: [[1, 'Asks where the rollback step is.'], [3, 'Names each dependency with no owner.'], [4, 'Asks for a measured latency figure.'], [1, 'Says the release waits for a rollback.'], [5, 'Ties each finding to its section.']] });
const source = (over = {}) => ({
  skill: SKILL, request_context: 'A request to check a release plan.', writtenBy: 'a person',
  rules: [
    { c: 'useful', q: 'Always confirm the rollback step exists before release.', o: 'Checks for a rollback step.', h: 'Any plan.' },
    { c: 'style', q: 'Report the plan length in a single opening line.', o: 'Opens with the length.', h: 'Any plan.' },
    { c: 'useful', q: 'Flag every external dependency that has no named owner.', o: 'Flags ownerless dependencies.', h: 'A plan with vendors.' },
    { c: 'useful', q: 'Ask for a measured figure behind every latency promise.', o: 'Asks for data.', h: 'A plan with a latency claim.' },
    { c: 'generic', q: 'Keep each finding tied to the plan section it came from.', o: 'Points to the section.', h: 'Any plan.' },
  ],
  batches: { a: [1, 2, 3, 4, 5, 6, 7, 8].map(task), b: [9, 10, 11, 12, 13, 14, 15, 16].map(task) },
  ...over,
});

test('a hand-written source becomes a draft folder the frozen verifier passes, with buckets derived from rule numbers', (t) => {
  const r = rig(t);
  const res = writeDraft({ source: source(), repo: r.repo, out: r.out });
  assert.deepEqual(res.problems, []);
  const v = verifyBaselines({ dir: r.out, skillsDir: path.join(r.repo, 'skills') });
  assert.deepEqual(v.problems, []);
  const b = JSON.parse(fs.readFileSync(path.join(r.out, SKILL, 'tasks-a.buckets.json'), 'utf8'));
  assert.equal(b.scenarios[`${SKILL}-a-1`]['2'].rule_id, `${SKILL}-r03`);
  assert.equal(b.rules[`${SKILL}-r02`].kept, false, 'the style rule is not kept');
  assert.equal(v.manifest.sources[SKILL].subject_sha256, v.skills.get(SKILL).rules.source.subject.sha256);
});

test('a source that fails the format writes nothing and names the problem', (t) => {
  const r = rig(t);
  const bad = source();
  bad.rules[0].q = 'This line is not in the skill at all.';
  bad.batches.a[0].rubric[0] = [2, 'Checks the opening line.'];
  assert.throws(() => writeDraft({ source: bad, repo: r.repo, out: r.out }), /does not appear in SKILL\.md[\s\S]*dropped/);
  assert.equal(fs.existsSync(path.join(r.out, SKILL)), false);
});

test('with no selection given, the first 5 of each kind that do not name the skill are taken', (t) => {
  const r = rig(t);
  const sel = defaultSelection({ repo: r.repo, skill: SKILL });
  assert.deepEqual(sel, { load: [0, 1, 2, 3, 4], none: [7, 8, 9, 10, 11] });
  assert.throws(() => writeDraft({ source: source({ selection: { load: [6, 0, 1, 2, 3], none: [7, 8, 9] } }), repo: r.repo, out: r.out }), /names "demo-check"/);
});

test('the paid author plans at most 9 calls and makes none on a dry run', (t) => {
  const r = rig(t);
  assert.equal(planOf(['a', 'b']).length, 9);
  const plan = withEnv({ FAKE_KP_LOG: r.log }, () => authorSkill({ skill: SKILL, repo: r.repo, out: r.out, paid: r.paid, dryRun: true }));
  assert.equal(plan.status, 'planned');
  assert.equal(plan.worst, 135);
  assert.deepEqual(r.calls(), []);
});

test('the paid author writes a verified draft with two families, and resumes free', (t) => {
  const r = rig(t);
  const res = withEnv({ FAKE_KP_LOG: r.log }, () => authorSkill({ skill: SKILL, repo: r.repo, out: r.out, paid: r.paid }));
  assert.equal(res.status, 'written');
  assert.deepEqual(r.calls(), ['glm-5 rules', 'glm-5 skill-write', 'deepseek-3.2 skill-review', 'glm-5 skill-write', 'deepseek-3.2 skill-review']);
  assert.deepEqual(verifyBaselines({ dir: r.out, skillsDir: path.join(r.repo, 'skills') }).problems, []);
  const rules = JSON.parse(fs.readFileSync(path.join(r.out, SKILL, 'rules.json'), 'utf8'));
  assert.equal(rules.rules.length, 5);
  withEnv({ FAKE_KP_LOG: r.log }, () => authorSkill({ skill: SKILL, repo: r.repo, out: r.out, paid: r.paid }));
  assert.equal(r.calls().length, 5, 'a rerun reads the saved replies');
});

test('a task that fails its review gets one fix, and one that fails again is dropped and recorded', (t) => {
  const r = rig(t);
  const res = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: `${SKILL}-a-2,${SKILL}-a-5`, FAKE_KP_NOFIX: `${SKILL}-a-5` }, () => authorSkill({ skill: SKILL, repo: r.repo, out: r.out, paid: r.paid }));
  assert.equal(res.status, 'dropped');
  assert.deepEqual(res.dropped.map((d) => d.id), [`${SKILL}-a-5`]);
  assert.equal(r.calls().filter((c) => c.endsWith('skill-fix')).length, 1);
  const tasks = JSON.parse(fs.readFileSync(path.join(r.out, SKILL, 'tasks-a.json'), 'utf8'));
  assert.equal(tasks.scenarios.length, 7);
  assert.deepEqual(verifyBaselines({ dir: r.out, skillsDir: path.join(r.repo, 'skills') }).problems, []);
});

test('review-only checks a hand draft with one other family: 2 calls, a failed task dropped with no fix', (t) => {
  const r = rig(t);
  const file = path.join(r.root, 'source.json');
  write(file, JSON.stringify(source()));
  const res = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: `${SKILL}-b-3` }, () => reviewDraft({ sourceFile: file, repo: r.repo, out: r.out, paid: r.paid }));
  assert.deepEqual(r.calls(), ['deepseek-3.2 skill-review', 'deepseek-3.2 skill-review']);
  assert.deepEqual(res.dropped.map((d) => d.id), [`${SKILL}-b-3`]);
  const tasks = JSON.parse(fs.readFileSync(path.join(r.out, SKILL, 'tasks-b.json'), 'utf8'));
  assert.equal(tasks.scenarios.length, 7);
  assert.match(tasks.model, /reviewed by deepseek-3\.2/);
});
