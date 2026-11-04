// SPDX-License-Identifier: Apache-2.0
/**
 * The control manifest and the run gate: what each control expects, how a result is checked
 * against it, when the run passes, and how a failed run marks the real skills.
 * Run: node --test bench/test/controls.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PASS,
  FAIL,
  CONTROLS,
  controlFor,
  isSkillSpecific,
  evaluateControls,
  runStatus,
  runSummary,
} = require('../lib/controls');
const { REVIEW } = require('../lib/verdict');
const { loadSpec } = require('../lib/treatment-check');
const { WITH_WINS, WITHOUT_WINS, NO_DIFFERENCE, aggregateOf } = require('./support/control-results');

const KEEP = CONTROLS[0];
const PRUNE = CONTROLS[1];
const NULL = CONTROLS[2];
const CONTROLS_DIR = path.join(__dirname, '..', 'controls');

/** A results map in which every control reaches its expected verdict. */
function goodResults(extra = {}) {
  return {
    [KEEP.skill]: aggregateOf(KEEP.skill, WITH_WINS),
    [PRUNE.skill]: aggregateOf(PRUNE.skill, WITHOUT_WINS),
    [NULL.skill]: aggregateOf(NULL.skill, NO_DIFFERENCE),
    ...extra,
  };
}

const realSkill = (gaps = WITH_WINS) => aggregateOf('some-real-skill', gaps);

// ---- the manifest ---------------------------------------------------------------------------

test('the manifest lists keep, prune and null with their skills, kinds and expected verdicts', () => {
  assert.deepEqual(
    CONTROLS.map((c) => [c.id, c.skill, c.kind, c.expected]),
    [
      ['keep', 'tarnwick-conventions', 'skill-specific', 'keep'],
      ['prune', 'team-coding-notes', 'harmful', 'prune'],
      ['null', 'plain-writing-habits', 'identical-arms', 'needs human review'],
    ],
  );
  assert.equal(NULL.expected, REVIEW);
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, 3);
  assert.equal(new Set(CONTROLS.map((c) => c.skill)).size, 3);
});

test('the manifest cannot be edited at run time', () => {
  assert.ok(Object.isFrozen(CONTROLS));
  for (const control of CONTROLS) assert.ok(Object.isFrozen(control));
  assert.throws(() => {
    'use strict';
    CONTROLS[0].expected = 'prune';
  }, TypeError);
});

test('only the keep control is skill-specific, and only the null control has identical arms', () => {
  assert.deepEqual(
    CONTROLS.filter((c) => c.skill_specific).map((c) => c.id),
    ['keep'],
  );
  assert.deepEqual(
    CONTROLS.filter((c) => c.identical_arms).map((c) => c.id),
    ['null'],
  );
  assert.equal(isSkillSpecific(KEEP.skill), true);
  assert.equal(isSkillSpecific(PRUNE.skill), false);
  assert.equal(isSkillSpecific(NULL.skill), false);
  assert.equal(isSkillSpecific('some-real-skill'), false);
  assert.equal(isSkillSpecific(undefined), false);
});

test('controlFor finds a control by its skill and returns null for any other skill', () => {
  assert.equal(controlFor(PRUNE.skill), PRUNE);
  assert.equal(controlFor('some-real-skill'), null);
  assert.equal(controlFor('constructor'), null);
});

test('the manifest matches the files: a folder, a task set and, where flagged, a treatment spec', () => {
  for (const control of CONTROLS) {
    const text = fs.readFileSync(path.join(CONTROLS_DIR, control.id, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${control.skill}\\n`), `${control.id} SKILL.md name`);
    const tasks = JSON.parse(fs.readFileSync(path.join(CONTROLS_DIR, 'tasks', `${control.id}.json`), 'utf8'));
    assert.ok(tasks.length > 0 && tasks.every((t) => t.skill === control.skill), control.id);
    assert.equal(loadSpec(control.skill) !== null, control.treatment, `${control.id}: treatment flag`);
  }
});

// ---- evaluateControls -----------------------------------------------------------------------

test('every control at its expected verdict passes, in manifest order, with a reason', () => {
  const out = evaluateControls(goodResults());
  assert.deepEqual(out.map((e) => [e.id, e.status, e.actual]), [
    ['keep', PASS, 'keep'],
    ['prune', PASS, 'prune'],
    ['null', PASS, REVIEW],
  ]);
  for (const e of out) {
    assert.match(e.reason, new RegExp(`^${e.id} control: .* as expected; `));
    assert.equal(e.expected, controlFor(e.skill).expected);
  }
  assert.match(out[0].reason, /mean score gap 2\.\d\d, 95% lower bound above \+0\.1/);
});

test('a control at the wrong verdict fails and the reason says what was expected, what came and why', () => {
  const cases = [
    [KEEP, aggregateOf(KEEP.skill, NO_DIFFERENCE), REVIEW],
    [KEEP, aggregateOf(KEEP.skill, WITHOUT_WINS), 'prune'],
    [PRUNE, aggregateOf(PRUNE.skill, NO_DIFFERENCE), REVIEW],
    [PRUNE, aggregateOf(PRUNE.skill, WITH_WINS), 'keep'],
    [NULL, aggregateOf(NULL.skill, WITH_WINS), 'keep'],
    [NULL, aggregateOf(NULL.skill, WITHOUT_WINS), 'prune'],
  ];
  for (const [control, result, got] of cases) {
    const out = evaluateControls(goodResults({ [control.skill]: result }));
    const mine = out.find((e) => e.id === control.id);
    assert.equal(mine.status, FAIL, `${control.id} got ${got}`);
    assert.equal(mine.actual, got);
    assert.ok(mine.reason.includes(`${control.id} control: expected ${control.expected}, got ${got}; `), mine.reason);
    assert.ok(mine.reason.includes(result.verdict.reason), 'the verdict reason is carried');
    assert.deepEqual(
      out.filter((e) => e.id !== control.id).map((e) => e.status),
      [PASS, PASS],
      'the other controls are judged on their own',
    );
  }
});

test('a control with no result fails, whatever shape the missing result takes', () => {
  for (const missing of [undefined, null]) {
    const results = goodResults({ [PRUNE.skill]: missing });
    const out = evaluateControls(results);
    assert.equal(out[1].status, FAIL);
    assert.equal(out[1].actual, null);
    assert.match(out[1].reason, /^prune control: no result for team-coding-notes/);
  }
  const { [KEEP.skill]: _gone, ...without } = goodResults();
  assert.equal(evaluateControls(without)[0].status, FAIL);
  for (const bad of [undefined, null, {}, [], 'x']) {
    assert.deepEqual(evaluateControls(bad).map((e) => e.status), [FAIL, FAIL, FAIL]);
  }
});

test('a result with no verdict fails instead of throwing', () => {
  for (const broken of [{}, { verdict: null }, { verdict: {} }, { verdict: { verdict: 7 } }, { result: {} }, 'keep', 7]) {
    const out = evaluateControls(goodResults({ [KEEP.skill]: broken }));
    assert.equal(out[0].status, FAIL, JSON.stringify(broken));
    assert.match(out[0].reason, /^keep control: the result for tarnwick-conventions has no verdict/);
  }
});

test('a stored result record is read the same as the aggregate it holds', () => {
  const record = (aggregate) => ({ skill: aggregate.skill, decision_rule: 'paired-t/v1', result: aggregate });
  const results = goodResults();
  const wrapped = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, record(v)]));
  assert.deepEqual(evaluateControls(wrapped), evaluateControls(results));
  wrapped[KEEP.skill] = record(aggregateOf(KEEP.skill, NO_DIFFERENCE));
  assert.equal(evaluateControls(wrapped)[0].status, FAIL);
});

test('the verdict that counts is the final one, after the word-check gate', () => {
  const vetoed = aggregateOf(KEEP.skill, WITH_WINS);
  vetoed.verdict = { ...vetoed.verdict, verdict: REVIEW, reason: 'word checks say the skill is worse' };
  assert.equal(vetoed.graded.verdict, 'keep', 'the judge alone said keep');
  const out = evaluateControls(goodResults({ [KEEP.skill]: vetoed }));
  assert.equal(out[0].status, FAIL);
  assert.match(out[0].reason, /expected keep, got needs human review; word checks say the skill is worse/);
});

test('the null control passes only when the interval was computed: a review that measured nothing fails', () => {
  const tooFew = aggregateOf(NULL.skill, NO_DIFFERENCE.slice(0, 7));
  assert.equal(tooFew.verdict.verdict, REVIEW);
  assert.equal(tooFew.verdict.ci, null);
  const notLoaded = aggregateOf(NULL.skill, NO_DIFFERENCE, { loaded: (i) => i !== 0 });
  assert.equal(notLoaded.verdict.verdict, REVIEW);
  assert.equal(notLoaded.verdict.load_failed, 1);
  const unusable = aggregateOf(NULL.skill, NO_DIFFERENCE);
  unusable.verdict = { ...unusable.verdict, invalid: 1 };
  for (const [result, why] of [[tooFew, 'too few pairs'], [notLoaded, 'a load failure'], [unusable, 'an invalid pair']]) {
    const mine = evaluateControls(goodResults({ [NULL.skill]: result }))[2];
    assert.equal(mine.status, FAIL, why);
    assert.equal(mine.actual, REVIEW);
    assert.match(mine.reason, /^null control: review, but nothing was measured, so it proves nothing; /, why);
  }
  assert.equal(evaluateControls(goodResults())[2].status, PASS, 'a measured review passes');
});

test('a custom manifest is honoured and the default one is not changed by it', () => {
  const only = [{ ...KEEP, id: 'solo', skill: 'solo-skill' }];
  const out = evaluateControls({ 'solo-skill': aggregateOf('solo-skill', WITH_WINS) }, only);
  assert.deepEqual(out.map((e) => [e.id, e.status]), [['solo', PASS]]);
  assert.equal(CONTROLS.length, 3);
});

// ---- runStatus ------------------------------------------------------------------------------

test('the run passes only when every control passes', () => {
  assert.equal(runStatus(evaluateControls(goodResults())), PASS);
  for (const [control, gaps] of [
    [KEEP, NO_DIFFERENCE],
    [PRUNE, WITH_WINS],
    [NULL, WITH_WINS],
  ]) {
    const out = evaluateControls(goodResults({ [control.skill]: aggregateOf(control.skill, gaps) }));
    assert.equal(runStatus(out), FAIL, control.id);
  }
});

test('a run with a control missing fails, even when the evaluations left are all passing', () => {
  const all = evaluateControls(goodResults());
  assert.equal(runStatus(all.slice(0, 2)), FAIL);
  assert.equal(runStatus(all.filter((e) => e.id !== 'null')), FAIL);
  assert.equal(runStatus([]), FAIL);
  const { [PRUNE.skill]: _gone, ...without } = goodResults();
  assert.equal(runStatus(evaluateControls(without)), FAIL);
});

test('runStatus ignores entries that are not evaluations and refuses a non-array', () => {
  const all = evaluateControls(goodResults());
  assert.equal(runStatus([...all.slice(0, 2), null, 'x', { id: 'null', status: 'pass' }]), FAIL);
  assert.equal(runStatus([...all, null]), PASS);
  for (const bad of [undefined, null, {}, 'PASS']) assert.throws(() => runStatus(bad), TypeError);
  assert.equal(runStatus(all, []), FAIL, 'a run with no controls at all is not a pass');
});

// ---- runSummary -----------------------------------------------------------------------------

test('a passing run marks every real skill trusted and leaves the verdicts as they are', () => {
  const skillA = realSkill(WITH_WINS);
  const skillB = realSkill(WITHOUT_WINS);
  const results = goodResults({ 'skill-a': skillA, 'skill-b': skillB });
  const summary = runSummary(results);
  assert.equal(summary.status, PASS);
  assert.deepEqual(Object.keys(summary.skills).sort(), ['skill-a', 'skill-b']);
  for (const name of ['skill-a', 'skill-b']) {
    assert.equal(summary.skills[name].trusted, true);
    assert.deepEqual(summary.skills[name].trust_reasons, []);
  }
  assert.equal(summary.skills['skill-a'].verdict.verdict, 'keep');
  assert.equal(summary.skills['skill-b'].verdict.verdict, 'prune');
  assert.deepEqual(summary.controls, evaluateControls(results));
});

test('a failing control marks every real skill untrusted with the failing control reason', () => {
  const results = goodResults({
    'skill-a': realSkill(WITH_WINS),
    'skill-b': realSkill(NO_DIFFERENCE),
    [PRUNE.skill]: aggregateOf(PRUNE.skill, NO_DIFFERENCE),
  });
  const before = structuredClone(results);
  const summary = runSummary(results);
  assert.equal(summary.status, FAIL);
  const failing = summary.controls.find((c) => c.id === 'prune');
  assert.equal(failing.status, FAIL);
  assert.deepEqual(Object.keys(summary.skills).sort(), ['skill-a', 'skill-b']);
  for (const name of ['skill-a', 'skill-b']) {
    const marked = summary.skills[name];
    assert.equal(marked.trusted, false);
    assert.deepEqual(marked.trust_reasons, [failing.reason]);
    assert.match(marked.trust_reasons[0], /^prune control: expected prune, got needs human review; /);
    assert.deepEqual(marked.verdict, before[name].verdict, 'the computed verdict is not changed');
    assert.deepEqual(marked.graded, before[name].graded);
    assert.deepEqual(marked.pairs, before[name].pairs);
  }
  assert.equal(summary.skills['skill-a'].verdict.verdict, 'keep', 'a keep stays a keep, marked untrusted');
  assert.deepEqual(results, before, 'the input is not changed');
  assert.ok(!('trusted' in results['skill-a']), 'the input skill is not marked in place');
});

test('every failing control is named in the reasons of each real skill', () => {
  const results = goodResults({
    'skill-a': realSkill(),
    [KEEP.skill]: aggregateOf(KEEP.skill, NO_DIFFERENCE),
    [NULL.skill]: aggregateOf(NULL.skill, WITH_WINS),
  });
  const summary = runSummary(results);
  const reasons = summary.skills['skill-a'].trust_reasons;
  assert.equal(reasons.length, 2);
  assert.match(reasons[0], /^keep control: expected keep, got needs human review/);
  assert.match(reasons[1], /^null control: expected needs human review, got keep/);
});

test('a missing control fails the run and marks the real skills untrusted', () => {
  const { [NULL.skill]: _gone, ...without } = goodResults({ 'skill-a': realSkill() });
  const summary = runSummary(without);
  assert.equal(summary.status, FAIL);
  assert.equal(summary.skills['skill-a'].trusted, false);
  assert.match(summary.skills['skill-a'].trust_reasons[0], /^null control: no result for plain-writing-habits/);
  assert.equal(summary.skills['skill-a'].verdict.verdict, 'keep');
  const none = runSummary({ 'skill-a': realSkill() });
  assert.equal(none.status, FAIL);
  assert.equal(none.skills['skill-a'].trust_reasons.length, 3);
});

test('control results are reported under controls and left out of the real skills', () => {
  const summary = runSummary(goodResults({ 'skill-a': realSkill() }));
  for (const control of CONTROLS) assert.ok(!Object.hasOwn(summary.skills, control.skill));
  assert.deepEqual(summary.controls.map((c) => c.id), ['keep', 'prune', 'null']);
  assert.deepEqual(runSummary(goodResults()).skills, {});
});

test('stored result records are marked the same way, keeping their own fields', () => {
  const record = { skill: 'skill-a', rule_sha256: 'x', result: realSkill() };
  const summary = runSummary(goodResults({ 'skill-a': record, [KEEP.skill]: aggregateOf(KEEP.skill, NO_DIFFERENCE) }));
  assert.equal(summary.status, FAIL);
  assert.equal(summary.skills['skill-a'].trusted, false);
  assert.equal(summary.skills['skill-a'].rule_sha256, 'x');
  assert.deepEqual(summary.skills['skill-a'].result, record.result);
});

test('the gate module is pure: it imports only the verdict module', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'lib', 'controls.js'), 'utf8');
  assert.equal(text.split('\n')[0], '// SPDX-License-Identifier: Apache-2.0');
  assert.deepEqual([...text.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]), ['./verdict']);
  assert.doesNotMatch(text, /process\.env|\bfetch\(|child_process|node:fs/);
});
