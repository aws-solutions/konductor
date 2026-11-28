// SPDX-License-Identifier: Apache-2.0
// Stage 1's selection test (cap select, cap/selection.js), on the stub: no model, no credentials, no spend. The
// requests format, the load read from a kiro-cli stream with the runner's own code, trigger precision and recall for a
// skill that always loads, never loads and loads correctly, a load counted once per run, an empty load that is not a
// load, and the whole-skill gate of the keep-prune record opening only for a frozen, current selection result.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');

const sel = require('../../cap/selection.js');
const { runSelect } = require('../../cap/selectrun.js');
const { runKeepPrune } = require('../../cap/kprun.js');
const { validateSelection } = require('../../cap/baselineformats.js');
const { verifyBaselines } = require('../../cap/baselineverify.js');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PILOT = 'plan-review';
const tmp = (t) => {
  const dir = mkScratch('kps-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** A selection set for the pilot: three requests that should load it and three that should not. */
const SET = Object.freeze({
  format_version: 1,
  skill: PILOT,
  requests: [
    { id: 'load-1', prompt: 'Before we start, check whether this task breakdown is clear enough for someone to carry out.', expect: 'load' },
    { id: 'load-2', prompt: 'Review the work plan in PLAN.md and tell me which steps are too vague to execute.', expect: 'load' },
    { id: 'load-3', prompt: 'Is this implementation plan complete? Point out missing files or acceptance checks.', expect: 'load' },
    { id: 'none-1', prompt: 'Rename the variable total to grandTotal in src/cart.js.', expect: 'none' },
    { id: 'none-2', prompt: 'What time zone does the server log use?', expect: 'none' },
    { id: 'none-3', prompt: 'Write a haiku about autumn rain for the team channel.', expect: 'none' },
  ],
});

/** The pilot's SKILL.md as its frozen baseline was written from (fixtures/keep-prune), so a pilot tree stays fresh after main edits the skill. */
const PILOT_SKILL = path.join(__dirname, 'fixtures', 'keep-prune', 'plan-review-SKILL.md');
const writePilotSkill = (skillsDir) => { fs.mkdirSync(path.join(skillsDir, PILOT), { recursive: true }); fs.copyFileSync(PILOT_SKILL, path.join(skillsDir, PILOT, 'SKILL.md')); };
/** A repository with the pilot skill and a baselines folder with its baseline, its selection.json frozen in. */
function frozenTree(t, { set = SET } = {}) {
  const root = tmp(t);
  const repo = path.join(root, 'repo');
  const baselinesDir = path.join(root, 'baselines');
  writePilotSkill(path.join(repo, 'skills'));
  fs.cpSync(path.join(REPO, 'bench', 'cap', 'baselines', PILOT), path.join(baselinesDir, PILOT), { recursive: true });
  fs.writeFileSync(path.join(baselinesDir, PILOT, 'selection.json'), `${JSON.stringify(set, null, 2)}\n`);
  const files = {};
  for (const f of fs.readdirSync(path.join(baselinesDir, PILOT)).sort()) files[`${PILOT}/${f}`] = sha(fs.readFileSync(path.join(baselinesDir, PILOT, f)));
  fs.writeFileSync(path.join(baselinesDir, 'MANIFEST.json'), JSON.stringify({ format_version: 1, files }));
  return { root, repo, baselinesDir, out: path.join(root, 'out') };
}
const stubScore = (t, behaviour, extra = null) => sel.scoreRun(sel.runStub({ name: PILOT, set: SET, runId: 'stub-t', dir: tmp(t), behaviour, extra }), PILOT);

test('the selection format needs three of each kind, unique ids, and prompts that do not name the skill', () => {
  assert.deepEqual(validateSelection(SET, { skill: PILOT }).errors, []);
  const fewer = { ...SET, requests: SET.requests.filter((r) => r.id !== 'none-3') };
  assert.ok(validateSelection(fewer).errors.some((e) => /at least 6 entries|at least 3 with expect "none"/.test(e)));
  const named = { ...SET, requests: SET.requests.map((r, i) => (i === 0 ? { ...r, prompt: 'Run plan-review on this breakdown please.' } : r)) };
  assert.ok(validateSelection(named).errors.some((e) => /must not name the skill/.test(e)));
  const twice = { ...SET, requests: SET.requests.map((r, i) => (i === 1 ? { ...r, id: 'load-1' } : r)) };
  assert.ok(validateSelection(twice).errors.some((e) => /id "load-1" is used twice/.test(e)));
});

test('the stub stream is read with the runner code: always, never and correct give their known precision and recall', (t) => {
  const always = stubScore(t, 'always').score;
  assert.deepEqual([always.tp, always.fp, always.fn, always.precision.value, always.recall.value], [3, 3, 0, 0.5, 1]);
  const never = stubScore(t, 'never').score;
  assert.deepEqual([never.tp, never.fp, never.precision.value, never.recall.value], [0, 0, null, 0], 'precision has nothing to be precise about');
  const correct = stubScore(t, 'correct').score;
  assert.deepEqual([correct.precision.value, correct.recall.value], [1, 1]);
});

test('a skill loaded twice in one run counts once, and a load that returned no text is a failed load, not a load', (t) => {
  const results = sel.runStub({ name: PILOT, set: SET, runId: 'stub-t', dir: tmp(t), behaviour: 'correct', extra: 'twice' });
  assert.equal(results[0].skillsLoaded[0].count, 2, 'the stream holds two loads');
  const twice = sel.scoreRun(results, PILOT);
  assert.deepEqual([twice.score.tp, twice.rows.filter((r) => r.hit).length], [3, 9], 'nine loading runs, each one hit');
  const empty = stubScore(t, 'always', 'empty');
  assert.equal(empty.score.recall.value, 0);
  assert.equal(empty.failedLoads, 18);
});

test('cap select on a frozen set opens the whole-skill gate; a draft or a changed unit keeps it NO DATA', (t) => {
  const tree = frozenTree(t);
  assert.deepEqual(verifyBaselines({ dir: tree.baselinesDir, skillsDir: path.join(tree.repo, 'skills') }).problems, []);
  const s = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-sel', baselinesDir: tree.baselinesDir, measuredAt: '2026-11-17' });
  assert.equal(s.result.frozen, true);
  assert.deepEqual([s.result.triggerPrecision, s.result.triggerRecall, s.result.observedUseRate, s.result.runs], [1, 1, 0.5, 18]);
  const selection = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  const kp = (runId, over = {}) => runKeepPrune({ name: PILOT, repo: tree.repo, baselinesDir: tree.baselinesDir, outDir: tree.out, depth: 'quick', runId, selection, ...over }).record;
  const open = kp('stub-kp-a');
  assert.equal(open.wholeSkill.status, 'ready for review');
  assert.match(open.wholeSkill.why[0], /no rule combines them/);
  assert.deepEqual(open.selection, selection);
  const draftFile = path.join(tree.root, 'draft.json');
  fs.writeFileSync(draftFile, JSON.stringify(SET));
  const draft = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-sel-d', baselinesDir: tree.baselinesDir, requestsFile: draftFile });
  assert.match(kp('stub-kp-b', { selection: draft.result }).wholeSkill.why.join(' '), /selection requests are a draft/);
  const other = { ...selection, unitSha256: 'f'.repeat(64) };
  assert.match(kp('stub-kp-c', { selection: other }).wholeSkill.why.join(' '), /measured on another loaded unit/);
});

test('cap select --from-run scores a recorded run folder in the loadRun layout the same as the stub it came from (K-5)', (t) => {
  const tree = frozenTree(t);
  const stub = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-sel', baselinesDir: tree.baselinesDir, measuredAt: '2026-11-21' });
  const results = sel.runStub({ name: PILOT, set: SET, runId: 'stub-rec', dir: tmp(t), reps: 3, behaviour: 'correct' });
  const run = path.join(tree.root, 'recorded-run');
  results.forEach((r, i) => {
    const dir = path.join(run, 'main', r.taskId ?? `sel-${i}`, String(r.replicate ?? i + 1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(r));
  });
  const fromRun = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, fromRun: run, baselinesDir: tree.baselinesDir, measuredAt: '2026-11-21' });
  assert.equal(fromRun.result.source, run);
  for (const k of ['triggerPrecision', 'triggerRecall', 'observedUseRate', 'runs', 'frozen']) assert.deepEqual(fromRun.result[k], stub.result[k], k);
  assert.ok(fs.existsSync(path.join(tree.out, 'recorded-run', 'selection', `${PILOT}.json`)));
});

test('a baseline without selection.json is refused by cap select, and a bad one fails the baselines check', (t) => {
  const tree = frozenTree(t);
  fs.rmSync(path.join(tree.baselinesDir, PILOT, 'selection.json'));
  const m = JSON.parse(fs.readFileSync(path.join(tree.baselinesDir, 'MANIFEST.json'), 'utf8'));
  delete m.files[`${PILOT}/selection.json`];
  fs.writeFileSync(path.join(tree.baselinesDir, 'MANIFEST.json'), JSON.stringify(m));
  assert.throws(() => runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-x', baselinesDir: tree.baselinesDir }), /has no frozen selection\.json/);
  const bad = frozenTree(t, { set: { ...SET, requests: SET.requests.slice(0, 4) } });
  assert.ok(verifyBaselines({ dir: bad.baselinesDir, skillsDir: path.join(bad.repo, 'skills') }).problems.some((p) => /selection\.json: requests/.test(p)));
});

test('the selection tasks for a later approved run carry each request and its expectation', (t) => {
  const dir = tmp(t);
  const made = sel.writeTasks({ name: PILOT, set: SET, dir });
  assert.equal(made.length, 6);
  const task = JSON.parse(fs.readFileSync(path.join(dir, `${made[0].taskId}.json`), 'utf8'));
  assert.deepEqual([task.prompt, task.triggerQuery.expect, task.triggerQuery.capId], [SET.requests[0].prompt, 'load', `skill:${PILOT}`]);
});

test('the fake model picks the skill whose description shares the most words, or none', () => {
  const { createFakePicker, wordsOf } = require('../../cap/fakepicker.js');
  const pick = createFakePicker({ catalog: [{ name: 'b-poems', description: 'Write short poems and haiku for the team channel.' }, { name: 'a-plans', description: 'Review work plans before execution.' }] });
  assert.equal(pick('Review this work plan before we start.'), 'a-plans');
  assert.equal(pick('A haiku for the team channel, please.'), 'b-poems');
  assert.equal(pick('Rename the variable total.'), null, 'one shared word or none is no pick');
  assert.equal(pick('Review the haiku plan for the team.'), 'a-plans', 'a tie goes to the name first in order');
  assert.deepEqual([...wordsOf('Plans, PLANS and a cat')].sort(), ['plan']);
});

test('the fake model end to end: a wrong pick shows as a miss and as the skill picked instead', (t) => {
  const tree = frozenTree(t);
  const decoy = path.join(tree.repo, 'skills', 'decoy-notes');
  fs.mkdirSync(decoy);
  fs.writeFileSync(path.join(decoy, 'SKILL.md'), '---\nname: decoy-notes\ndescription: Write short poems and haiku for the team channel about rain.\n---\n# Decoy notes\n');
  const requests = [
    { id: 'load-1', prompt: 'Review the work plan in PLAN.md before execution starts.', expect: 'load' },
    { id: 'load-2', prompt: 'Critical review of this implementation plan and task breakdown, please.', expect: 'load' },
    { id: 'load-3', prompt: 'Write the plan for the team channel as a haiku.', expect: 'load' },
    { id: 'none-1', prompt: 'Rename the variable total to grandTotal in src/cart.js.', expect: 'none' },
    { id: 'none-2', prompt: 'A haiku about autumn rain for the team channel.', expect: 'none' },
    { id: 'none-3', prompt: 'Give a star rating and a verdict for this restaurant review.', expect: 'none' },
  ];
  const draftFile = path.join(tree.root, 'fake-set.json');
  fs.writeFileSync(draftFile, JSON.stringify({ format_version: 1, skill: PILOT, requests }));
  const r = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-fake', baselinesDir: tree.baselinesDir, requestsFile: draftFile, behaviour: 'fake' });
  const { tp, fp, fn, tn, confusionCounts } = r.scored.score;
  assert.deepEqual({ tp, fp, fn, tn }, { tp: 2, fp: 1, fn: 1, tn: 2 });
  assert.deepEqual([r.result.triggerPrecision, r.result.triggerRecall], [2 / 3, 2 / 3]);
  assert.deepEqual(confusionCounts, { 'decoy-notes': 3 }, 'load-3 went to the decoy in all three repeats');
});

test('use in real sessions is its own field, apart from the selection-run use rate (K-6)', (t) => {
  const { sessionUseOf } = require('../../cap/usage.js');
  const { selectionProblems } = require('../../cap/kprecord.js');
  const scan = { runs: [{ loads: { 'plan-review': { count: 1 } } }, { loads: {} }, { loads: {} }, { loads: { 'Plan-Review': {} } }] };
  assert.deepEqual(sessionUseOf(scan, 'Plan-Review', 'past'), { rate: 0.25, runs: 4, loaded: 1, source: 'past' });
  assert.equal(sessionUseOf({ runs: [] }, 'x', 'none'), null);
  const tree = frozenTree(t);
  const s = runSelect({ name: PILOT, repo: tree.repo, outDir: tree.out, runId: 'stub-sel', baselinesDir: tree.baselinesDir, measuredAt: '2026-11-21' });
  assert.equal(s.result.sessionUse, null, 'not read without --usage-runs');
  assert.equal(s.result.observedUseRate, 0.5, 'the selection-run share is unchanged');
  assert.deepEqual(selectionProblems(s.result), []);
  assert.deepEqual(selectionProblems({ ...s.result, sessionUse: { rate: 0.25, runs: 4, loaded: 1, source: 'past' } }), []);
  assert.match(selectionProblems({ ...s.result, sessionUse: { rate: 2 } }).join(), /sessionUse must be null/);
});
