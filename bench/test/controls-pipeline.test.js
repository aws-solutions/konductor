// SPDX-License-Identifier: Apache-2.0
/**
 * The controls through the whole offline pipeline. Stored pairs and crafted judge replies go
 * through the judge driver and the aggregation, and the run gate reads the stored results: no
 * model call, no credential, no network.
 *
 *  - keep, with replies that favour the with arm, reads keep and passes;
 *  - prune, with replies that favour the without arm, reads prune and passes;
 *  - prune pairs whose stored run set the direction aside are dropped and counted, and with too
 *    many dropped prune falls to review, so the gate fails with that reason;
 *  - null, with identical arms and independent noisy scores, never reads keep or prune;
 *  - a control at the wrong verdict, or a missing one, fails the run and marks every real skill;
 *  - editing the treatment spec makes a stored control result stale.
 * Run: node --test bench/test/controls-pipeline.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runJudging, scoreSkill } = require('../run/judge');
const { openStore } = require('../lib/store');
const { aggregateSkill } = require('../lib/aggregate');
const { decisionRuleSha256 } = require('../lib/decision-rule');
const { SPEC_DIR } = require('../lib/treatment-check');
const { CONTROLS, PASS, FAIL, evaluateControls, runStatus, runSummary } = require('../lib/controls');
const { REVIEW } = require('../lib/verdict');
const { SKILL, makePair } = require('./support/records');
const { roster } = require('./support/roster');
const { CONTEXT, taskSetOf, writePairs, scriptedPlugin } = require('./support/run-fixture');

const [KEEP, PRUNE, NULL] = CONTROLS;
const CONTROLS_DIR = path.join(__dirname, '..', 'controls');
const SEATS = 3;
const live = () => ({ judges: roster(SEATS).map((s) => ({ ...s, plugin: 'scripted' })) });

const scratch = [];
test.after(() => scratch.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-controls-'));
  scratch.push(dir);
  return openStore(dir);
};

const taskSetOfControl = (control) => ({
  tasks: JSON.parse(fs.readFileSync(path.join(CONTROLS_DIR, 'tasks', `${control.id}.json`), 'utf8')),
});
const contextOf = (control) => ({ skillName: control.skill, aliases: [] });

// ---- scores ---------------------------------------------------------------------------------

/** [with, without] scores for each of three seats, by 1-based task index. The with arm wins by about 2. */
const WITH_WINS = [
  [[5, 2], [4, 2], [5, 3]],
  [[4, 2], [4, 3], [5, 2]],
  [[5, 3], [4, 2], [4, 2]],
  [[4, 3], [5, 2], [4, 3]],
];
const swap = (seats) => seats.map(([a, b]) => [b, a]);
const favourWith = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, WITH_WINS[i % 4]]));
const favourWithout = (count) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, swap(WITH_WINS[i % 4])]));
/** Scores that favour neither arm: the gaps average about zero. */
const EVEN = [
  [[4, 3], [3, 3], [3, 3]],
  [[3, 4], [3, 3], [3, 3]],
  [[3, 3], [4, 4], [3, 3]],
];
const noDifference = (count) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, EVEN[i % 3]]));

/** A seeded generator, so a run of the null control is the same every time. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const clamp = (x) => Math.min(5, Math.max(1, Math.round(x)));

/**
 * Scores for identical arms. Each task has a difficulty both arms share. Each judge scores each
 * arm with its own independent noise (about one point), so the true gap is zero. `bias` is added
 * to the with arm only, to model a method that favours one arm.
 */
function identicalArmScores(seed, count, bias = 0) {
  const rng = mulberry32(seed);
  const scores = {};
  for (let n = 1; n <= count; n += 1) {
    const difficulty = 3 + 0.5 * normal(rng);
    scores[n] = Array.from({ length: SEATS }, () => [
      clamp(difficulty + bias + 0.9 * normal(rng)),
      clamp(difficulty + 0.9 * normal(rng)),
    ]);
  }
  return scores;
}

// ---- stored pairs ---------------------------------------------------------------------------

const SETTINGS = 'Reading Settings Files';
const TOTALS = 'Order Totals';
const RETRY = 'Retrying Requests';

/** For each prune section: code that takes the direction, and code that does the right thing. */
const CODE = Object.freeze({
  [SETTINGS]: {
    took: 'def load_settings(path):\n    try:\n        with open(path) as handle:\n            return json.load(handle)\n    except:\n        return {}',
    right:
      'def load_settings(path):\n    try:\n        with open(path) as handle:\n            return json.load(handle)\n    except FileNotFoundError:\n        return {}\n    except json.JSONDecodeError as exc:\n        raise ValueError(f"bad settings file {path}") from exc',
  },
  [TOTALS]: {
    took: 'def invoice_total(lines):\n    total = sum(line["price"] * line["quantity"] for line in lines)\n    return round(total, 2)',
    right:
      'from decimal import Decimal\n\ndef invoice_total(lines):\n    return sum(Decimal(str(line["price"])) * line["quantity"] for line in lines)',
  },
  [RETRY]: {
    took: 'def fetch(url):\n    while True:\n        try:\n            return requests.get(url, timeout=5).json()\n        except requests.RequestException:\n            continue',
    right:
      'def fetch(url):\n    for attempt in range(5):\n        try:\n            return requests.get(url, timeout=5).json()\n        except requests.RequestException:\n            time.sleep(2 ** attempt)\n    raise RuntimeError(url)',
  },
});

/** How a with-arm run of the prune control can answer. */
const WITH_ANSWER = Object.freeze({
  /** Takes the direction. */
  took: (code) => ({ answer: code.took }),
  /** Takes it in a changed file and only says "Done." in the reply. */
  file: (code) => ({ answer: 'Done.', start: {}, final: { 'solution.py': `${code.took}\n` } }),
  /** Shows the direction as a counter-example and then does the right thing. */
  counter: (code) => ({ answer: `${code.took}\n\nA safer version:\n${code.right}` }),
  /** Narrates that it set the guidance aside; the sanitizer removes that sentence for the judge. */
  narrated: (code) => ({
    answer: `I did not follow the loaded team-coding-notes guidance here.\n${code.took}`,
  }),
  /** Does the right thing. */
  right: (code) => ({ answer: code.right }),
});

/**
 * Writes the pairs of a control. `answers(task, arm, n)` returns `{ answer, start?, final? }`. The
 * answer ends with a marker token that the scripted grader uses to tell the arms apart.
 */
function writePairsFor(store, control, taskSet, answers) {
  taskSet.tasks.forEach((task, i) => {
    const n = i + 1;
    for (const arm of ['with', 'without']) {
      const { answer, start = {}, final = {} } = answers(task, arm, n);
      store.writePair(
        makePair({
          skill: control.skill,
          taskId: task.id,
          arm,
          request: task.task,
          answer: `${answer}\n# ${arm === 'with' ? 'ZQHI' : 'ZQLO'}${n}`,
          start,
          final,
          loaded: arm === 'with',
        }),
      );
    }
  });
}

/** Pairs for the prune control: `withKind(i)` names how task i's with-arm run answers. */
function prunePairs(store, taskSet, withKind = () => 'took') {
  writePairsFor(store, PRUNE, taskSet, (task, arm, n) => {
    const code = CODE[task.target_section];
    return arm === 'with' ? WITH_ANSWER[withKind(n - 1)](code) : WITH_ANSWER.right(code);
  });
}

/** Pairs for a control whose answers need no particular content. */
function plainPairs(store, control, taskSet) {
  writePairsFor(store, control, taskSet, (task, arm) => ({ answer: `${arm} reply to ${task.id}` }));
}

async function judge(store, control, taskSet, scores, extra = {}) {
  const plugin = scriptedPlugin({ scores });
  const out = await runJudging({
    store,
    skill: control.skill,
    taskSet,
    config: live(),
    plugins: { scripted: plugin },
    context: contextOf(control),
    ...extra,
  });
  return { out, plugin, record: out.result, result: out.result.result };
}

/** Runs one control end to end on a fresh store. */
async function runControl(control, { scores, pairs }) {
  const taskSet = taskSetOfControl(control);
  const store = newStore();
  pairs(store, taskSet);
  const run = await judge(store, control, taskSet, scores(taskSet.tasks.length));
  return { ...run, store, taskSet };
}

const runKeep = (scores = favourWith) => runControl(KEEP, { scores, pairs: (s, t) => plainPairs(s, KEEP, t) });
const runPrune = (scores = favourWithout, withKind) =>
  runControl(PRUNE, { scores, pairs: (s, t) => prunePairs(s, t, withKind) });
const runNull = (seed, bias = 0) =>
  runControl(NULL, { scores: (n) => identicalArmScores(seed, n, bias), pairs: (s, t) => plainPairs(s, NULL, t) });

/** A real skill through the same pipeline: eight synthetic tasks, with arm winning. */
async function runRealSkill() {
  const store = newStore();
  const taskSet = taskSetOf(8);
  writePairs(store, taskSet.tasks);
  const out = await runJudging({
    store,
    skill: SKILL,
    taskSet,
    config: live(),
    plugins: { scripted: scriptedPlugin() },
    context: CONTEXT,
  });
  return out.result;
}

// ---- keep and prune -------------------------------------------------------------------------

test('keep: crafted replies that favour the with arm read keep, and the gate passes it', async () => {
  const { out, result } = await runKeep();
  assert.equal(out.complete, true);
  assert.equal(result.verdict.verdict, 'keep', result.verdict.reason);
  assert.equal(result.verdict.pairs, 10);
  assert.ok(result.verdict.mean > 1.8 && result.verdict.ci[0] > 0.1);
  assert.equal(result.verdict.treatment_failed, 0);
  const evaluation = evaluateControls({ [KEEP.skill]: out.result }).find((e) => e.id === 'keep');
  assert.equal(evaluation.status, PASS);
  assert.equal(evaluation.actual, 'keep');
  assert.ok(result.pairs.every((p) => p.counted && !('treatment' in p)), 'a skill with no spec is not checked');
});

test('prune: crafted replies that favour the without arm read prune, and the gate passes it', async () => {
  const { out, result, plugin } = await runPrune();
  assert.equal(out.complete, true);
  assert.equal(plugin.calls.length, 12 * SEATS * 2);
  assert.equal(result.verdict.verdict, 'prune', result.verdict.reason);
  assert.equal(result.verdict.pairs, 12);
  assert.ok(result.verdict.mean < -1.8 && result.verdict.prune_ci[1] < -0.2);
  assert.equal(result.verdict.treatment_failed, 0);
  assert.ok(result.pairs.every((p) => p.adhered === true && p.counted === true && p.treatment.required === true));
  assert.equal(evaluateControls({ [PRUNE.skill]: out.result }).find((e) => e.id === 'prune').status, PASS);
});

test('prune: a direction taken only in a changed file still counts', async () => {
  const { result } = await runPrune(favourWithout, () => 'file');
  assert.equal(result.verdict.verdict, 'prune', result.verdict.reason);
  assert.equal(result.verdict.treatment_failed, 0);
  assert.ok(result.pairs.every((p) => p.treatment.followed !== null));
});

// ---- prune pairs that refuse the direction ---------------------------------------------------

/** Task indices (0-based) whose with-arm run sets the direction aside, and how. */
const refusing = (plan) => (i) => (Object.hasOwn(plan, i) ? plan[i] : 'took');

test('prune: pairs whose stored run set the direction aside are dropped and counted, and the rest decide', async () => {
  const plan = { 0: 'counter', 4: 'narrated', 8: 'counter', 11: 'narrated' };
  const { out, result, plugin } = await runPrune(favourWithout, refusing(plan));
  assert.equal(result.verdict.verdict, 'prune', result.verdict.reason);
  assert.equal(result.verdict.pairs, 8, 'eight usable pairs are enough');
  assert.equal(result.verdict.treatment_failed, 4);
  assert.equal(result.verdict.load_failed, 0);
  const dropped = result.pairs.filter((p) => !p.counted);
  assert.deepEqual(dropped.map((p) => p.task_id).sort(), Object.keys(plan).map((i) => out.result.result.pairs[i].task_id).sort());
  for (const pair of dropped) {
    assert.equal(pair.loaded, true, 'dropped for the treatment, not for a failed load');
    assert.equal(pair.adhered, false);
    assert.equal(pair.treatment.adhered, false);
    assert.ok(pair.treatment.refused !== null);
  }
  assert.equal(evaluateControls({ [PRUNE.skill]: out.result }).find((e) => e.id === 'prune').status, PASS);

  // The sanitizer removed the narration for the judge; the treatment check still saw it.
  const narrated = ['ZQHI5', 'ZQHI12'];
  for (const token of narrated) {
    const prompts = plugin.calls.filter((c) => c.prompt.includes(token));
    assert.equal(prompts.length, SEATS * 2);
    for (const call of prompts) assert.doesNotMatch(call.prompt, /did not follow/i, token);
  }
  const narratedPair = result.pairs[4];
  assert.equal(narratedPair.counted, false);
  assert.match(narratedPair.treatment.reason, /did not take the directive/);
});

test('prune: with too many pairs dropped it falls to review and the gate fails with that reason', async () => {
  const plan = { 0: 'counter', 2: 'narrated', 4: 'counter', 6: 'narrated', 8: 'counter' };
  const { out, result } = await runPrune(favourWithout, refusing(plan));
  assert.equal(result.graded.verdict, REVIEW);
  assert.equal(result.verdict.verdict, REVIEW);
  assert.equal(result.verdict.pairs, 7);
  assert.equal(result.verdict.treatment_failed, 5);
  assert.match(result.verdict.reason, /only 7 usable pairs, need at least 8 \(5\/12 failed the treatment check\)/);

  const evaluation = evaluateControls({ [PRUNE.skill]: out.result }).find((e) => e.id === 'prune');
  assert.equal(evaluation.status, FAIL);
  assert.equal(evaluation.actual, REVIEW);
  assert.match(evaluation.reason, /^prune control: expected prune, got needs human review; only 7 usable pairs/);
  assert.match(evaluation.reason, /5\/12 failed the treatment check/);
});

test('prune: when every run sets the direction aside there is no measurement and the gate fails', async () => {
  const { out, result } = await runPrune(favourWithout, () => 'right');
  assert.equal(result.verdict.verdict, REVIEW);
  assert.equal(result.verdict.pairs, 0);
  assert.equal(result.verdict.treatment_failed, 12);
  assert.match(result.verdict.reason, /no pair took the directive/);
  assert.equal(evaluateControls({ [PRUNE.skill]: out.result }).find((e) => e.id === 'prune').status, FAIL);
});

test('prune: replies that favour the with arm read keep, which is the wrong verdict for the gate', async () => {
  const { out, result } = await runPrune(favourWith);
  assert.equal(result.verdict.verdict, 'keep');
  assert.equal(evaluateControls({ [PRUNE.skill]: out.result }).find((e) => e.id === 'prune').status, FAIL);
});

// ---- the null control ------------------------------------------------------------------------

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test('null: identical arms with independent noisy scores never read keep or prune over 20 fixed seeds', async () => {
  const verdicts = [];
  for (const seed of SEEDS) {
    const { out, result } = await runNull(seed);
    assert.equal(out.complete, true, `seed ${seed}`);
    assert.equal(result.verdict.pairs, 10, `seed ${seed}`);
    verdicts.push(result.verdict.verdict);
    assert.notEqual(result.verdict.verdict, 'keep', `seed ${seed}: ${result.verdict.reason}`);
    assert.notEqual(result.verdict.verdict, 'prune', `seed ${seed}: ${result.verdict.reason}`);
    const evaluation = evaluateControls({ [NULL.skill]: out.result }).find((e) => e.id === 'null');
    assert.equal(evaluation.status, PASS, `seed ${seed}: ${evaluation.reason}`);
  }
  assert.deepEqual([...new Set(verdicts)], [REVIEW]);
});

test('null: the same seed gives the same scores and the same result', async () => {
  const first = await runNull(7);
  const second = await runNull(7);
  assert.deepEqual(first.result.verdict, second.result.verdict);
  assert.deepEqual(identicalArmScores(7, 10), identicalArmScores(7, 10));
  assert.notDeepEqual(identicalArmScores(7, 10), identicalArmScores(8, 10));
});

test('null: a method that favours one arm is caught: the control reads keep and the gate fails', async () => {
  let keeps = 0;
  for (const seed of SEEDS) {
    const { out, result } = await runNull(seed, 1);
    if (result.verdict.verdict === 'keep') keeps += 1;
    if (result.verdict.verdict === 'keep') {
      assert.equal(evaluateControls({ [NULL.skill]: out.result }).find((e) => e.id === 'null').status, FAIL);
    }
  }
  assert.ok(keeps >= 15, `a one-point lean towards the with arm read keep in ${keeps} of 20 runs`);
});

test('null: its chance of reading keep or prune on its own stays small', () => {
  const taskSet = { tasks: Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, target_section: 'S' })) };
  const cfg = { judges: roster(SEATS) };
  const runs = 2000;
  let wrong = 0;
  for (let seed = 1; seed <= runs; seed += 1) {
    const scores = identicalArmScores(seed, 10);
    const deltas = {};
    const loaded = {};
    taskSet.tasks.forEach((task, i) => {
      deltas[task.id] = Object.fromEntries(
        cfg.judges.map((j, k) => [j.seat, { 'with-first': scores[i + 1][k][0] - scores[i + 1][k][1] }]),
      );
      loaded[task.id] = true;
    });
    const v = aggregateSkill({ skill: NULL.skill, taskSet, deltas, loaded, cfg }).verdict.verdict;
    if (v === 'keep' || v === 'prune') wrong += 1;
  }
  // The rule is a statistical test, so an identical-arm run reads keep or prune now and then by
  // chance, about once in a hundred runs here. A larger share would mean the gate is too jumpy.
  assert.ok(wrong / runs <= 0.03, `${wrong} of ${runs} identical-arm runs read keep or prune`);
});

// ---- the run gate ----------------------------------------------------------------------------

async function runWholeSuite(overrides = {}) {
  const keep = overrides.keep || (await runKeep());
  const prune = overrides.prune || (await runPrune());
  const nul = overrides.null || (await runNull(1));
  const real = await runRealSkill();
  const results = { [KEEP.skill]: keep.record, [PRUNE.skill]: prune.record, [NULL.skill]: nul.record, [SKILL]: real };
  return { results, real };
}

test('gate: every control at its verdict passes the run and trusts the real skill', async () => {
  const { results, real } = await runWholeSuite();
  const summary = runSummary(results);
  assert.equal(summary.status, PASS);
  assert.deepEqual(summary.controls.map((c) => c.status), [PASS, PASS, PASS]);
  assert.equal(summary.skills[SKILL].trusted, true);
  assert.deepEqual(summary.skills[SKILL].trust_reasons, []);
  assert.equal(summary.skills[SKILL].result.verdict.verdict, 'keep');
  assert.deepEqual(summary.skills[SKILL].result, real.result);
});

test('gate: a control at the wrong verdict fails the run and marks the real skill untrusted', async () => {
  const wrongPrune = await runPrune(noDifference);
  assert.equal(wrongPrune.result.verdict.verdict, REVIEW);
  const { results, real } = await runWholeSuite({ prune: wrongPrune });
  const summary = runSummary(results);
  assert.equal(summary.status, FAIL);
  assert.equal(runStatus(summary.controls), FAIL);
  assert.deepEqual(summary.controls.map((c) => c.status), [PASS, FAIL, PASS]);
  const marked = summary.skills[SKILL];
  assert.equal(marked.trusted, false);
  assert.equal(marked.trust_reasons.length, 1);
  assert.match(marked.trust_reasons[0], /^prune control: expected prune, got needs human review; /);
  assert.equal(marked.result.verdict.verdict, 'keep', 'the computed verdict is left as it is');
  assert.deepEqual(marked.result, real.result, 'and so is everything else in the result');
});

test('gate: the keep control at the wrong verdict also fails the run', async () => {
  const wrongKeep = await runKeep(noDifference);
  const { results } = await runWholeSuite({ keep: wrongKeep });
  const summary = runSummary(results);
  assert.equal(summary.status, FAIL);
  assert.deepEqual(summary.controls.map((c) => c.status), [FAIL, PASS, PASS]);
  assert.equal(summary.skills[SKILL].trusted, false);
});

test('gate: a null control that invents a difference fails the run', async () => {
  const biased = await runNull(1, 1);
  assert.equal(biased.result.verdict.verdict, 'keep');
  const { results } = await runWholeSuite({ null: biased });
  const summary = runSummary(results);
  assert.equal(summary.status, FAIL);
  assert.deepEqual(summary.controls.map((c) => c.status), [PASS, PASS, FAIL]);
  assert.match(summary.skills[SKILL].trust_reasons[0], /^null control: expected needs human review, got keep/);
});

test('gate: a missing control fails the run', async () => {
  const { results } = await runWholeSuite();
  const { [NULL.skill]: _gone, ...without } = results;
  const summary = runSummary(without);
  assert.equal(summary.status, FAIL);
  assert.deepEqual(summary.controls.map((c) => c.status), [PASS, PASS, FAIL]);
  assert.match(summary.controls[2].reason, /^null control: no result for plain-writing-habits/);
  assert.equal(summary.skills[SKILL].trusted, false);
});

// ---- the treatment spec and stale results ----------------------------------------------------

test('editing the treatment spec changes the decision rule digest and makes stored control results stale', async () => {
  const source = await runPrune();
  const taskSet = source.taskSet;

  // A copy of the real spec directory with one pattern added.
  const edited = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-spec-'));
  scratch.push(edited);
  for (const name of fs.readdirSync(SPEC_DIR)) fs.copyFileSync(path.join(SPEC_DIR, name), path.join(edited, name));
  assert.equal(decisionRuleSha256({ treatmentDir: edited }), decisionRuleSha256(), 'a copy of the specs digests the same');
  const file = path.join(edited, `${PRUNE.skill}.json`);
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  spec.sections[SETTINGS].refused.push('\\bextra marker\\b');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  const oldRule = decisionRuleSha256({ treatmentDir: edited });
  assert.notEqual(oldRule, decisionRuleSha256(), 'an edited spec changes the digest');

  // A stored result made under the other spec: same judgments and pairs, another rule digest.
  const target = newStore();
  prunePairs(target, taskSet);
  for (const rec of source.store.listJudgments(PRUNE.skill)) target.writeJudgment(rec);
  const stored = source.store.readResult(PRUNE.skill);
  target.writeResult({
    ...stored,
    rule_sha256: oldRule,
    inputs: { ...stored.inputs, rule_sha256: oldRule },
    result: { ...stored.result, verdict: { ...stored.result.verdict, verdict: 'keep', reason: 'made under an old spec' } },
  });

  const args = { store: target, skill: PRUNE.skill, taskSet, config: live(), context: contextOf(PRUNE) };
  const plugin = scriptedPlugin({ scores: favourWithout(12) });
  const out = await runJudging({ ...args, plugins: { scripted: plugin } });
  assert.equal(out.calls, 0, 'no judge call');
  assert.equal(plugin.calls.length, 0);
  assert.equal(out.result_written, true, 'the stale result was rebuilt');
  assert.equal(out.result.rule_sha256, decisionRuleSha256());
  assert.equal(out.result.result.verdict.verdict, 'prune');
  assert.deepEqual(out.result.result.verdict, source.result.verdict);

  const again = scoreSkill(args);
  assert.equal(again.result_written, false, 'and now it is current');
});

test('the control task sets run through the judge driver as they are', async () => {
  for (const control of CONTROLS) {
    const taskSet = taskSetOfControl(control);
    for (const task of taskSet.tasks) {
      assert.equal(typeof task.task, 'string');
      assert.ok(Array.isArray(task.rubric) && task.rubric.length >= 3);
      assert.equal(typeof task.target_section, 'string');
    }
  }
  const { out } = await runKeep();
  assert.equal(out.planned, 10 * SEATS * 2);
});
