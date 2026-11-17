// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's scripts/bench/lib/readings-report.js, its pass rules section (pull request #266, commit 705fd834, branch tip 33b385f9), same repository and Apache-2.0 licence. Rules and date unchanged.
/**
 * The pass rules of the two copied controls, convention-control and the dose ladder, read from the same A and B
 * readings as the labels (keepprune.js readingOf gives them in his shape). Pure. A control with no interval for a
 * reading it needs is NOT RUN, never a pass; a run is trusted only when every control it includes passes.
 */
'use strict';

const { itemName } = require('./doseladder.js');
const { formatGap, formatInterval } = require('./gaptext.js');

const NOT_RUN = 'NOT RUN';
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);


/**
 * THE PASS RULES of the controls, written down before any run of this control set. The report prints this text and
 * the code below evaluates it. The text and PASS_RULES_DATE change together: a test pins the text to the date.
 */
const PASS_RULES_DATE = '2026-11-10';
const PASS_RULES = [
  'Notation: "A" and "B" are the two readings above. "lower" and "upper" are the ends of a 95% t interval over the counted tasks of the control (df = n - 1). A gap is with minus without on the 1 to 5 scale.',
  '',
  "1. `convention-control` (a neutral skill of arbitrary, harmless conventions; no request names a rule). PASS if both: (a) B shows a gain: the lower end of B's gap is above 0 (the model followed the conventions); (b) A's interval contains 0 (a checklist written from the request alone does not reward them).",
  "2. Dose ladder D0, D1, D2, D4 (authored answers with more planted flaws at each dose, items `fixture-d0` to `fixture-d4`, read by A). PASS if all of: (a) D4 has the lowest mean gap of the four doses; (b) D0's interval contains 0; (c) the mean gap does not rise from D1 to D2 to D4, and D4 is below D1.",
  '3. A control with no usable judgments for a reading it needs (fewer than 2 counted tasks, so no interval) is NOT RUN, not a pass or a fail.',
  '4. A run is trusted only when every control it includes passes. A run that includes no control is not trusted.',
].join('\n');

const CONVENTION_CONTROL = 'convention-control';
const LADDER_CONTROL = 'ladder';

const describe = (label, reading) =>
  `${label} gap ${formatGap(reading.mean_gap)} ${formatInterval(reading.t_interval)}`;

/** True when the interval holds `point` (ends included). */
const intervalContains = (interval, point) =>
  Array.isArray(interval) && interval[0] <= point && point <= interval[1];

const check = (name, ok, detail) => ({ name, ok, detail });
function verdict(control, checks, missing) {
  if (missing.length)
    return { control, status: NOT_RUN, pass: null, checks, missing };
  const pass = checks.every((entry) => entry.ok);
  return { control, status: pass ? 'PASS' : 'FAIL', pass, checks, missing };
}
const missingInterval = (label, reading, scale) =>
  reading.t_interval_exact
    ? []
    : [
        `${label} has fewer than 2 counted tasks with ${scale} judgments (${reading.tasks_counted} of ${reading.tasks})`,
      ];

/** Rule 1. `summary` is readSkill's result for convention-control. */
function evaluateConventionControl(summary) {
  if (!summary || summary.error)
    return verdict(
      CONVENTION_CONTROL,
      [],
      [
        summary && summary.error
          ? summary.error
          : `${CONVENTION_CONTROL} is not in the run`,
      ],
    );
  const missing = [
    ...missingInterval('B', summary.B, 'items'),
    ...missingInterval('A', summary.A, 'outcome'),
  ];
  const lowerB = summary.B.t_interval_exact;
  const checks = [
    check(
      'B shows a gain: lower end above 0',
      !!lowerB && lowerB[0] > 0,
      describe('B', summary.B),
    ),
    check(
      'A interval contains 0',
      intervalContains(summary.A.t_interval_exact, 0),
      describe('A', summary.A),
    ),
  ];
  return verdict(CONVENTION_CONTROL, checks, missing);
}

/**
 * The dose ladder input of rule 2 from a ladder's `doses` ({ D0: 0, D1: 1, ... }, dose-ladder.js) and the readSkill
 * results of its items, keyed by item name (`fixture-d0`, ...). A dose with no result gets none, so rule 2 reads it
 * as not run. Returns [{ dose, n, skill, summary }] in dose order.
 */
function ladderDoses(doses, summaries) {
  if (!isPlainObject(doses)) throw new TypeError('doses must be an object');
  if (!isPlainObject(summaries))
    throw new TypeError('summaries must be an object keyed by item name');
  return Object.entries(doses)
    .map(([dose, count]) => {
      const skill = itemName(dose);
      return {
        dose,
        n: count,
        skill,
        summary: Object.hasOwn(summaries, skill) ? summaries[skill] : null,
      };
    })
    .sort((left, right) => left.n - right.n);
}

/**
 * Rule 2. `doses` is ladderDoses output (any order). The lowest dose must apply no defect (D0, the null test) and the
 * ladder needs at least two more doses. Each dose is read by A, its mean gap and its interval.
 */
function evaluateLadder(doses) {
  if (!Array.isArray(doses)) throw new TypeError('doses must be an array');
  const sorted = [...doses].sort((left, right) => left.n - right.n);
  const missing = [];
  for (const entry of sorted) {
    const summary = entry.summary;
    if (!summary || summary.error)
      missing.push(
        `${entry.dose}: ${summary && summary.error ? summary.error : 'not in the run'}`,
      );
    else
      missing.push(
        ...missingInterval('A', summary.A, 'outcome').map(
          (line) => `${entry.dose}: ${line}`,
        ),
      );
  }
  if (sorted.length < 3 || sorted[0].n !== 0)
    missing.push('the ladder needs D0 (no defect) and at least two more doses');
  if (missing.length) return verdict(LADDER_CONTROL, [], missing);
  const meanOf = (entry) => entry.summary.A.mean_gap;
  const top = sorted[sorted.length - 1];
  const zero = sorted[0];
  const nonZero = sorted.slice(1);
  const others = sorted.filter((entry) => entry !== top);
  const series = nonZero.map(meanOf);
  const neverRises = series
    .slice(1)
    .every((mean, index) => mean <= series[index]);
  const checks = [
    check(
      `A: ${top.dose} has the lowest mean gap`,
      others.every((entry) => meanOf(top) < meanOf(entry)),
      sorted
        .map((entry) => `${entry.dose} ${formatGap(meanOf(entry))}`)
        .join(', '),
    ),
    check(
      `A: ${zero.dose} interval contains 0`,
      intervalContains(zero.summary.A.t_interval_exact, 0),
      `${zero.dose} ${formatGap(meanOf(zero))} ${formatInterval(zero.summary.A.t_interval)}`,
    ),
    check(
      `A: mean gap does not rise from ${nonZero[0].dose} to ${top.dose}, and ${top.dose} is below ${nonZero[0].dose}`,
      neverRises && series[series.length - 1] < series[0],
      nonZero
        .map((entry) => `${entry.dose} ${formatGap(meanOf(entry))}`)
        .join(' -> '),
    ),
  ];
  return verdict(LADDER_CONTROL, checks, []);
}

/**
 * Whether a run is trusted from the evaluations of the controls it includes (rule 4). Returns
 * { trusted, status, evaluations }: status PASS when every included control passed, FAIL when one failed or was not
 * run, NONE when the run includes no control (not trusted either).
 */
function trustOf(evaluations) {
  const list = evaluations.filter(Boolean);
  const trusted = list.length > 0 && list.every((evaluation) => evaluation.pass === true);
  return { trusted, status: trusted ? 'PASS' : list.length ? 'FAIL' : 'NONE', evaluations: list };
}

module.exports = {
  NOT_RUN, PASS_RULES_DATE, PASS_RULES, CONVENTION_CONTROL, LADDER_CONTROL,
  intervalContains, ladderDoses, evaluateConventionControl, evaluateLadder, trustOf,
};
