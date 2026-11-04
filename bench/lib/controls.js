// SPDX-License-Identifier: Apache-2.0
/**
 * The control skills and the run gate.
 *
 * A control is a skill whose right verdict is known in advance (bench/controls/README.md says what
 * each one is). A run that does not reach it shows a fault in the method, and the verdicts it gave
 * to real skills cannot be trusted. This module lists the controls, checks each one's result
 * against its expected verdict, and marks a run.
 *
 * The manifest `CONTROLS`, one entry per control:
 *  - `id`: `keep`, `prune` or `null`, also the name of the control's folder under bench/controls.
 *  - `skill`: the skill the control runs.
 *  - `kind`: `skill-specific` (the skill holds rules only it can teach), `harmful` (the skill
 *    gives plainly worse directions) or `identical-arms` (both arms get the same skill set).
 *  - `expected`: the verdict the control must reach, `keep`, `prune` or `needs human review`.
 *  - `skill_specific`: true when the skill's wording is the point, so the skill-wording lint does
 *    not apply to it (see `isSkillSpecific`).
 *  - `identical_arms`: true when a without-arm load of the skill is part of the design, so the
 *    runner must not exclude it.
 *  - `treatment`: true when the skill has a treatment spec (treatment-check.js).
 *
 * `evaluateControls(results)` returns one entry per control, in manifest order:
 * `{ id, skill, kind, expected, actual, status, reason }`, with `status` `PASS` or `FAIL`.
 * `results` maps a skill name to the result of `aggregateSkill`, or to the stored result record
 * that holds it. A control passes when its final verdict (after the word-check gate) equals the
 * expected one. A control with no result fails. The null control passes only when the verdict is
 * review because the interval was computed and did not clear a floor: a review that comes from a
 * load failure, an invalid pair or too few pairs measured nothing, and passing it would hide a
 * broken run behind the expected verdict.
 *
 * `runStatus(evaluations)` is `PASS` only when every control of the manifest has a passing
 * evaluation, so a missing control fails the run.
 *
 * `runSummary(results)` returns `{ status, controls, skills }`. Each real skill's entry in `skills`
 * is a copy of its result with `trusted` and `trust_reasons` added. When the run fails, `trusted`
 * is false and `trust_reasons` names every failing control and why. The skills' own verdicts are
 * not changed: a failed control marks a result untrusted and never rewrites it. The controls'
 * results are in `controls` and are left out of `skills`.
 *
 * Pure: no I/O, no model call. The input is never changed.
 */
const { REVIEW } = require('./verdict');

const PASS = 'PASS';
const FAIL = 'FAIL';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const CONTROLS = deepFreeze([
  {
    id: 'keep',
    skill: 'tarnwick-conventions',
    kind: 'skill-specific',
    expected: 'keep',
    skill_specific: true,
    identical_arms: false,
    treatment: false,
  },
  {
    id: 'prune',
    skill: 'team-coding-notes',
    kind: 'harmful',
    expected: 'prune',
    skill_specific: false,
    identical_arms: false,
    treatment: true,
  },
  {
    id: 'null',
    skill: 'plain-writing-habits',
    kind: 'identical-arms',
    expected: REVIEW,
    skill_specific: false,
    identical_arms: true,
    treatment: false,
  },
]);

/** The control that runs `skill`, or null when `skill` is not a control skill. */
const controlFor = (skill, manifest = CONTROLS) => manifest.find((c) => c.skill === skill) || null;

/** True when `skill` is a control skill whose wording is the point (exempt from the wording lint). */
const isSkillSpecific = (skill, manifest = CONTROLS) => {
  const control = controlFor(skill, manifest);
  return control !== null && control.skill_specific === true;
};

/** The final verdict object of a result, from an aggregate or from a stored record; null if none. */
function verdictOf(entry) {
  const aggregate = isObject(entry) && isObject(entry.verdict) ? entry : isObject(entry) ? entry.result : null;
  const verdict = isObject(aggregate) ? aggregate.verdict : null;
  return isObject(verdict) && typeof verdict.verdict === 'string' ? verdict : null;
}

/** True when a review verdict came from a computed interval, not from a run that measured nothing. */
const wasMeasured = (verdict) =>
  Array.isArray(verdict.ci) && verdict.load_failed === 0 && verdict.invalid === 0;

function evaluateOne(control, results) {
  const base = { id: control.id, skill: control.skill, kind: control.kind, expected: control.expected };
  const entry = isObject(results) && Object.hasOwn(results, control.skill) ? results[control.skill] : undefined;
  const fail = (actual, reason) => ({ ...base, actual, status: FAIL, reason });
  if (entry === undefined || entry === null) {
    return fail(null, `${control.id} control: no result for ${control.skill}, so the run cannot be trusted`);
  }
  const verdict = verdictOf(entry);
  if (verdict === null) {
    return fail(null, `${control.id} control: the result for ${control.skill} has no verdict`);
  }
  const actual = verdict.verdict;
  if (actual !== control.expected) {
    return fail(actual, `${control.id} control: expected ${control.expected}, got ${actual}; ${verdict.reason}`);
  }
  if (control.expected === REVIEW && !wasMeasured(verdict)) {
    return fail(
      actual,
      `${control.id} control: review, but nothing was measured, so it proves nothing; ${verdict.reason}`,
    );
  }
  return { ...base, actual, status: PASS, reason: `${control.id} control: ${actual} as expected; ${verdict.reason}` };
}

/** Per-control PASS or FAIL with a reason, in manifest order. */
function evaluateControls(results, manifest = CONTROLS) {
  return manifest.map((control) => evaluateOne(control, results));
}

/** `PASS` only when every control of `manifest` has a passing evaluation; anything else is `FAIL`. */
function runStatus(evaluations, manifest = CONTROLS) {
  if (!Array.isArray(evaluations)) throw new TypeError('runStatus needs the array evaluateControls returns');
  if (manifest.length === 0) return FAIL;
  const passed = new Set(
    evaluations.filter((e) => isObject(e) && e.status === PASS).map((e) => e.id),
  );
  return manifest.every((control) => passed.has(control.id)) ? PASS : FAIL;
}

/** The run summary: its status, the control evaluations and the real skills marked trusted or not. */
function runSummary(results, manifest = CONTROLS) {
  const controls = evaluateControls(results, manifest);
  const status = runStatus(controls, manifest);
  const reasons = controls.filter((c) => c.status === FAIL).map((c) => c.reason);
  const skills = {};
  for (const [name, entry] of Object.entries(isObject(results) ? results : {})) {
    if (controlFor(name, manifest) !== null) continue;
    skills[name] = { ...entry, trusted: status === PASS, trust_reasons: status === PASS ? [] : [...reasons] };
  }
  return { status, controls, skills };
}

module.exports = {
  PASS,
  FAIL,
  CONTROLS,
  controlFor,
  isSkillSpecific,
  evaluateControls,
  runStatus,
  runSummary,
};
