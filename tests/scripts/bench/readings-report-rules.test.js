// SPDX-License-Identifier: Apache-2.0
// The pass rules of the readings report (scripts/bench/lib/readings-report.js): convention-control, the dose ladder,
// NOT RUN, and when a run is trusted. Pinned to the committed fixture tests/fixtures/bench/readings-report.json.
// Offline, no model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const readings = require('../../../scripts/bench/lib/readings-report');
const { judgeFor } = require('../../../scripts/bench/lib/judge-prompt');
const { sha256 } = require('../../../scripts/bench/lib/provenance');
const { READ, DATA, buildDemo } = require('./readings-report-fixture');

const CONVENTION = 'convention-control';
const readDemo = (demo, skill, options = {}) =>
  readings.readSkill({ skill, ...buildDemo(demo, skill, options), ...READ });
const DOSES = Object.freeze({ D0: 0, D1: 1, D2: 2, D4: 4 });
/** The ladder input from the fixture; `swap` maps a dose to the demo it reads instead. */
const ladder = (swap = {}) =>
  readings.ladderDoses(
    DOSES,
    Object.fromEntries(
      Object.keys(DOSES).map((dose) => {
        const item = `fixture-${dose.toLowerCase()}`;
        return [item, readDemo(swap[dose] || `ladder-${dose}`, item)];
      }),
    ),
  );
const oks = (evaluation) => evaluation.checks.map((entry) => entry.ok);

test('rule 1, convention-control: B gains and A contains 0; each failure is its own check', () => {
  const pass = readings.evaluateConventionControl(
    readDemo('convention-pass', CONVENTION),
  );
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.pass, true);
  assert.deepEqual(oks(pass), [true, true]);
  // By hand: mean 2.875, sd sqrt(1.875 / 7), half width 2.3646 * sd / sqrt(8) = 0.4327.
  assert.match(pass.checks[0].detail, /^B gap \+2\.88 \[\+2\.44, \+3\.31\]$/);
  const leak = readings.evaluateConventionControl(
    readDemo('convention-leaks-into-a', CONVENTION),
  );
  assert.equal(leak.status, 'FAIL');
  assert.deepEqual(
    oks(leak),
    [true, false],
    'the request-only checklist rewards the conventions',
  );
  const noGain = readings.evaluateConventionControl(
    readDemo('convention-no-gain-on-b', CONVENTION),
  );
  assert.deepEqual(
    oks(noGain),
    [false, true],
    'the model did not follow them, so the control tests nothing',
  );
  assert.equal(noGain.pass, false);
});

test('rule 1 at the edges: a B lower end of exactly 0 fails, an A interval ending at exactly 0 contains 0', () => {
  const summary = readDemo('convention-pass', CONVENTION);
  const edge = {
    ...summary,
    B: { ...summary.B, t_interval_exact: [0, 1] },
    A: { ...summary.A, t_interval_exact: [0, 0.5] },
  };
  assert.deepEqual(oks(readings.evaluateConventionControl(edge)), [
    false,
    true,
  ]);
  const justAbove = {
    ...edge,
    B: { ...summary.B, t_interval_exact: [1e-9, 1] },
    A: { ...summary.A, t_interval_exact: [-0.5, 0] },
  };
  assert.deepEqual(oks(readings.evaluateConventionControl(justAbove)), [
    true,
    true,
  ]);
  const aboveZero = {
    ...edge,
    A: { ...summary.A, t_interval_exact: [1e-9, 0.5] },
  };
  assert.equal(
    readings.evaluateConventionControl(aboveZero).checks[1].ok,
    false,
  );
});

test('rule 1 reads the unrounded interval: a lower end that prints as 0.0000 still counts as above 0', () => {
  const summary = readDemo('convention-pass', CONVENTION);
  const tiny = {
    ...summary,
    B: { ...summary.B, t_interval: [0, 1], t_interval_exact: [0.00004, 1] },
  };
  assert.equal(readings.evaluateConventionControl(tiny).checks[0].ok, true);
});

test('rule 3: a control without an interval for a reading it needs is NOT RUN, not a fail', () => {
  const noItems = readDemo('ladder-D1', CONVENTION);
  const notRun = readings.evaluateConventionControl(noItems);
  assert.equal(notRun.status, readings.NOT_RUN);
  assert.equal(notRun.pass, null);
  assert.deepEqual(notRun.missing, [
    'B has fewer than 2 counted tasks with items judgments (0 of 0)',
  ]);
  const absent = readings.evaluateConventionControl(null);
  assert.equal(absent.status, readings.NOT_RUN);
  assert.deepEqual(absent.missing, ['convention-control is not in the run']);
  const error = readings.evaluateConventionControl(
    readings.readSkill({ skill: CONVENTION, ...READ }),
  );
  assert.equal(error.status, readings.NOT_RUN);
  assert.match(error.missing[0], /no judge job for convention-control/);
});

test('rule 3 for reading A: a control with one counted A task and a full B is NOT RUN, not a fail', () => {
  const built = buildDemo('convention-pass', CONVENTION);
  // The without answers of tasks 2 to 8 are stored as not loaded, so only task 1 counts for A.
  for (const job of built.outcomeJobs.filter(
    (entry) => entry.task.id !== `${CONVENTION}-1` && entry.arm === 'without',
  )) {
    job.state = 'not_loaded';
    job.reason = 'the without answer is stored as not loaded';
    job.record = null;
  }
  const summary = readings.readSkill({ skill: CONVENTION, ...built, ...READ });
  assert.equal(summary.A.tasks_counted, 1);
  assert.equal(summary.B.tasks_counted, 8);
  const evaluation = readings.evaluateConventionControl(summary);
  assert.equal(evaluation.status, readings.NOT_RUN);
  assert.equal(evaluation.pass, null);
  assert.deepEqual(evaluation.missing, [
    'A has fewer than 2 counted tasks with outcome judgments (1 of 8)',
  ]);
});

/** The jobs of a demo with every task after the first `kept` left pending (no record), on the given scales. */
function judgedOn(demo, skill, kept, scales) {
  const built = buildDemo(demo, skill);
  for (const scale of scales)
    for (const job of built[`${scale}Jobs`])
      if (
        !job.task.id.endsWith(`-${kept}`) &&
        !(kept === 2 && job.task.id.endsWith('-1'))
      ) {
        job.state = 'pending';
        job.record = null;
      }
  return built;
}

test('rule 3: a control judged on 2 of its 8 tasks is NOT RUN, whatever its short interval says, and the run is not trusted', () => {
  // The leaking demo FAILS when all 8 tasks are judged; on 2 tasks the t interval is so wide that A contains 0.
  const full = readings.evaluateConventionControl(
    readDemo('convention-leaks-into-a', CONVENTION),
  );
  assert.equal(full.status, 'FAIL');
  const built = judgedOn('convention-leaks-into-a', CONVENTION, 2, [
    'items',
    'outcome',
  ]);
  const summary = readings.readSkill({ skill: CONVENTION, ...built, ...READ });
  assert.equal(summary.A.tasks_counted, 2);
  assert.ok(summary.A.t_interval_exact, 'two tasks give an interval');
  const evaluation = readings.evaluateConventionControl(summary);
  assert.equal(evaluation.status, readings.NOT_RUN);
  assert.equal(evaluation.pass, null);
  assert.deepEqual(evaluation.missing, [
    'B counts 2 of 8 tasks with items judgments, and a control is read only when every task counts',
    'B has 36 of 48 items judgments that are not done (36 pending, 0 of them stale, 0 waiting)',
    'A counts 2 of 8 tasks with outcome judgments, and a control is read only when every task counts',
    'A has 36 of 48 outcome judgments that are not done (36 pending, 0 of them stale, 0 waiting)',
  ]);
  const report = readings.buildReadingsReport({
    convention: summary,
    ladder: null,
    generatedAt: '2026-11-18T00:00:00.000Z',
  });
  assert.equal(report.controls_status, 'FAIL');
  assert.equal(report.trusted, false);
});

test('rule 3: a control that would pass is NOT RUN with one stale judgment, or one task not counted', () => {
  const built = buildDemo('convention-pass', CONVENTION);
  assert.equal(
    readings.evaluateConventionControl(
      readings.readSkill({ skill: CONVENTION, ...built, ...READ }),
    ).status,
    'PASS',
  );
  // One judgment of the last task is pending with a file on disk (made from other inputs): stale.
  const stale = buildDemo('convention-pass', CONVENTION);
  const target = stale.outcomeJobs.find(
    (job) =>
      job.task.id === `${CONVENTION}-8` &&
      job.seat === 'xai' &&
      job.arm === 'with',
  );
  target.state = 'pending';
  target.record = null;
  const summary = readings.readSkill({
    skill: CONVENTION,
    ...stale,
    ...READ,
    isStale: (job) => job === target,
  });
  assert.equal(summary.A.tasks_counted, 8, 'two seats still count the task');
  assert.equal(summary.A.judgments.stale, 1);
  const evaluation = readings.evaluateConventionControl(summary);
  assert.equal(evaluation.status, readings.NOT_RUN);
  assert.deepEqual(evaluation.missing, [
    'A has 1 of 48 outcome judgments that are not done (1 pending, 1 of them stale, 0 waiting)',
  ]);
  // A task whose without answer is not loaded does not count, though the other 7 tasks do.
  const notLoaded = buildDemo('convention-pass', CONVENTION);
  for (const job of notLoaded.itemsJobs.filter(
    (entry) => entry.task.id === `${CONVENTION}-8` && entry.arm === 'without',
  )) {
    job.state = 'not_loaded';
    job.record = null;
  }
  const incomplete = readings.evaluateConventionControl(
    readings.readSkill({ skill: CONVENTION, ...notLoaded, ...READ }),
  );
  assert.equal(incomplete.status, readings.NOT_RUN);
  assert.match(incomplete.missing[0], /^B counts 7 of 8 tasks/);
});

test('rule 3 for a dose ladder: one dose judged on part of its tasks makes the ladder NOT RUN', () => {
  const full = ladder();
  assert.equal(readings.evaluateLadder(full).status, 'PASS');
  const partial = ladder();
  const d2 = partial.find((entry) => entry.dose === 'D2');
  const built = judgedOn('ladder-D2', d2.skill, 3, ['outcome']);
  d2.summary = readings.readSkill({ skill: d2.skill, ...built, ...READ });
  const evaluation = readings.evaluateLadder(partial);
  assert.equal(evaluation.status, readings.NOT_RUN);
  assert.ok(
    evaluation.missing.every((line) => line.startsWith('D2: A ')),
    evaluation.missing.join('; '),
  );
});

test('rule 2(a) compares D4 with D0 too: a D0 below D4 fails the first check', () => {
  const doses = ladder();
  const flat = (mean, count = 8) => Array(count).fill(mean);
  const pick = (dose, mean) => {
    const entry = doses.find((item) => item.dose === dose);
    entry.summary = readings.readSkill({
      skill: entry.skill,
      ...buildDemo(`ladder-${dose}`, entry.skill, {
        override: { outcome: flat(mean) },
      }),
      ...READ,
    });
  };
  pick('D0', -0.2);
  pick('D1', 0.3);
  pick('D2', 0.2);
  pick('D4', 0.1);
  const evaluation = readings.evaluateLadder(doses);
  assert.equal(evaluation.checks[0].ok, false, evaluation.checks[0].detail);
});

test('a ladder entry with an n that is not a number is refused', () => {
  for (const n of [Number.NaN, '4'])
    assert.throws(
      () =>
        readings.buildReadingsReport({
          convention: null,
          ladder: [{ dose: 'D0', n, skill: 'fixture-d0', summary: null }],
        }),
      TypeError,
    );
});

test('the length ratio is read from the outcome jobs alone, as for a dose ladder item, and the report copies its input', () => {
  const built = buildDemo('convention-pass', CONVENTION);
  const summary = readings.readSkill({
    skill: CONVENTION,
    itemsJobs: [],
    outcomeJobs: built.outcomeJobs,
    ...READ,
  });
  assert.equal(summary.length_ratio.tasks, 8);
  const skills = [summary];
  const report = readings.buildReadingsReport({
    skills,
    convention: null,
    ladder: null,
    generatedAt: '2026-11-18T00:00:00.000Z',
  });
  assert.notEqual(report.skills, skills);
  assert.deepEqual(report.skills, skills);
});

test('rule 2, dose ladder: D4 lowest, D0 contains 0, and the gap does not rise from D1 to D2 to D4', () => {
  const ok = readings.evaluateLadder(ladder());
  assert.equal(ok.status, 'PASS');
  assert.equal(ok.checks.length, 3);
  assert.deepEqual(oks(ok), [true, true, true]);
  assert.equal(ok.checks[0].detail, 'D0 +0.01, D1 -0.50, D2 -1.00, D4 -2.00');
  assert.equal(ok.checks[2].detail, 'D1 -0.50 -> D2 -1.00 -> D4 -2.00');
  // D2 and D4 swapped: D4 is no longer the lowest, and the gap rises from D2 to D4.
  const swapped = readings.evaluateLadder(
    ladder({ D2: 'ladder-D4', D4: 'ladder-D2' }),
  );
  assert.equal(swapped.status, 'FAIL');
  assert.deepEqual(oks(swapped), [false, true, false]);
  // D0 that is really a defect (its interval leaves out 0) fails the null test only.
  const d0 = readings.evaluateLadder(ladder({ D0: 'ladder-D1' }));
  assert.deepEqual(oks(d0), [true, false, true]);
  assert.match(d0.checks[1].name, /D0 interval contains 0/);
  // D1 and D2 swapped: D4 stays the lowest, but the gap rises from D1 to D2.
  const rise = readings.evaluateLadder(
    ladder({ D1: 'ladder-D2', D2: 'ladder-D1' }),
  );
  assert.deepEqual(oks(rise), [true, true, false]);
});

test('rule 2: a flat top (D4 equal to D2) fails the lowest-dose check but not the never-rises check', () => {
  const doses = ladder({ D4: 'ladder-D2' });
  assert.deepEqual(oks(readings.evaluateLadder(doses)), [false, true, true]);
});

test('rule 2 reads the unrounded D0 interval: an end that prints as 0 still decides', () => {
  const withEnds = (rounded, exact) => {
    const doses = ladder();
    const d0 = doses[0].summary;
    doses[0].summary = {
      ...d0,
      A: { ...d0.A, t_interval: rounded, t_interval_exact: exact },
    };
    return readings.evaluateLadder(doses).checks[1];
  };
  // The exact interval ends below 0, and its rounded form ends at 0.
  assert.equal(withEnds([-0.2, 0], [-0.2, -0.00003]).ok, false);
  // The exact interval starts above 0, and its rounded form starts at 0.
  assert.equal(withEnds([0, 0.5], [1e-9, 0.5]).ok, false);
  assert.equal(withEnds([-0.2, 0.2], [-0.2, 0.2]).ok, true);
});

test('rule 2: equal D1, D2 and D4 fail the lowest-dose and the D4-below-D1 checks', () => {
  const equal = readings.evaluateLadder(
    ladder({ D2: 'ladder-D1', D4: 'ladder-D1' }),
  );
  assert.deepEqual(oks(equal), [false, true, false]);
});

test('rule 2 reads the doses in dose order, whatever the input order', () => {
  const doses = ladder();
  const reversed = [...doses].reverse();
  assert.deepEqual(
    readings.evaluateLadder(reversed),
    readings.evaluateLadder(doses),
  );
});

test('rule 2 NOT RUN: a dose with no data, too few doses, or no D0', () => {
  const missing = ladder();
  missing[3].summary = null;
  const notRun = readings.evaluateLadder(missing);
  assert.equal(notRun.status, readings.NOT_RUN);
  assert.deepEqual(notRun.missing, ['D4: not in the run']);
  const noInterval = ladder();
  noInterval[1].summary = readings.readSkill({
    skill: 'fixture-d1',
    ...READ,
  });
  assert.match(
    readings.evaluateLadder(noInterval).missing[0],
    /^D1: the run has no judge job for fixture-d1$/,
  );
  const short = readings.evaluateLadder(ladder().slice(0, 2));
  assert.equal(short.status, readings.NOT_RUN);
  assert.deepEqual(short.missing, [
    'the ladder needs D0 (no defect) and at least two more doses',
  ]);
  const noZero = readings.evaluateLadder(ladder().slice(1));
  assert.equal(noZero.status, readings.NOT_RUN);
  // A dose with a reading but fewer than 2 counted tasks.
  const thin = ladder();
  const d2 = thin[2].summary;
  thin[2].summary = {
    ...d2,
    A: { ...d2.A, tasks_counted: 1, t_interval: null, t_interval_exact: null },
  };
  assert.deepEqual(readings.evaluateLadder(thin).missing, [
    'D2: A has fewer than 2 counted tasks with outcome judgments (1 of 8)',
  ]);
});

test('ladderDoses maps each dose to its item and its result, in dose order', () => {
  const doses = readings.ladderDoses(
    { D2: 2, D0: 0, D1: 1 },
    { 'fixture-d0': { skill: 'fixture-d0' } },
  );
  assert.deepEqual(
    doses.map(({ dose, n, skill }) => [dose, n, skill]),
    [
      ['D0', 0, 'fixture-d0'],
      ['D1', 1, 'fixture-d1'],
      ['D2', 2, 'fixture-d2'],
    ],
  );
  assert.deepEqual(doses[0].summary, { skill: 'fixture-d0' });
  assert.equal(doses[1].summary, null);
  assert.throws(
    () => readings.ladderDoses(null, {}),
    /doses must be an object/,
  );
  assert.throws(
    () => readings.ladderDoses({}, []),
    /summaries must be an object keyed by item name/,
  );
});

test('rule 4: a run is trusted only when every control it includes passes', () => {
  const convention = readDemo('convention-pass', CONVENTION);
  const both = readings.buildReadingsReport({
    convention,
    ladder: ladder(),
    generatedAt: '2026-11-10T00:00:00.000Z',
  });
  assert.equal(both.trusted, true);
  assert.equal(both.controls_status, 'PASS');
  assert.deepEqual(Object.keys(both.controls), [CONVENTION, 'ladder']);
  assert.equal(both.controls[CONVENTION].rule, 1);
  assert.equal(both.controls.ladder.rule, 2);
  assert.equal(both.controls.ladder.doses.length, 4);
  const leak = readings.buildReadingsReport({
    convention: readDemo('convention-leaks-into-a', CONVENTION),
    ladder: ladder(),
  });
  assert.equal(leak.trusted, false);
  assert.equal(leak.controls_status, 'FAIL');
  const notRun = readings.buildReadingsReport({
    convention: readings.readSkill({ skill: CONVENTION, ...READ }),
  });
  assert.equal(notRun.trusted, false, 'NOT RUN is not trusted');
  assert.equal(notRun.controls_status, 'FAIL');
  const none = readings.buildReadingsReport({});
  assert.equal(none.trusted, false, 'no control, no trust');
  assert.equal(none.controls_status, 'NONE');
  assert.deepEqual(none.controls, {});
  assert.equal(
    readings.buildReadingsReport({ ladder: ladder() }).trusted,
    true,
    'a run with only the ladder is trusted when the ladder passes',
  );
});

test('the report carries the rules, the scales, the judge prompt versions and the skills it was given', () => {
  const skill = readDemo('helps-a', 'brew-log');
  const report = readings.buildReadingsReport({
    skills: [skill],
    generatedAt: '2026-11-10T00:00:00.000Z',
  });
  assert.equal(report.version, readings.READINGS_REPORT_VERSION);
  assert.equal(report.generated_at, '2026-11-10T00:00:00.000Z');
  assert.equal(report.rules, readings.PASS_RULES);
  assert.equal(report.rules_date, readings.PASS_RULES_DATE);
  assert.match(readings.PASS_RULES_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(report.scales, { A: 'outcome', B: 'items' });
  for (const [reading, scale] of Object.entries(report.scales)) {
    assert.equal(
      report.prompt_versions[reading].sha256,
      judgeFor(scale).sha256,
    );
    assert.equal(
      report.prompt_versions[reading].version,
      judgeFor(scale).version,
    );
  }
  assert.deepEqual(report.skills, [skill]);
  assert.throws(
    () => readings.buildReadingsReport({ skills: 'x' }),
    /skills must be an array/,
  );
});

test('buildReadingsReport refuses a convention or a ladder of the wrong shape, and accepts error results and empty doses', () => {
  const build = (options) => () => readings.buildReadingsReport(options);
  assert.throws(
    build({ convention: {} }),
    /convention must be a readSkill result/,
  );
  assert.throws(
    build({ convention: 'x' }),
    /convention must be a readSkill result/,
  );
  assert.throws(
    build({ ladder: { D0: 0 } }),
    /ladder must be an array of \{ dose, n, skill, summary \}/,
  );
  assert.throws(
    build({
      ladder: [{ dose: 'D0', n: 0, skill: 'fixture-d0', summary: {} }],
    }),
    /ladder\[0\] must be \{ dose, n, skill, summary \}, with summary null or a readSkill result/,
  );
  assert.throws(build({ ladder: [null] }), /ladder\[0\] must be/);
  const report = readings.buildReadingsReport({
    convention: readings.readSkill({ skill: CONVENTION, ...READ }),
    ladder: ladder().map((entry) => ({ ...entry, summary: null })),
  });
  assert.equal(report.controls_status, 'FAIL');
  assert.equal(report.controls.ladder.evaluation.status, readings.NOT_RUN);
});

test('the rules text is pinned to its date: a changed rule needs a new date and a new pin', () => {
  assert.equal(readings.PASS_RULES_DATE, '2026-11-18');
  assert.equal(
    sha256(readings.PASS_RULES),
    'a1f6087afdadc3f4503708029787a490ddec7b041539729036e4dc55db775ed8',
  );
});

test('the rules name the controls, doses and thresholds the code evaluates', () => {
  for (const want of [
    '`convention-control`',
    'D0, D1, D2, D4',
    'lower end of B',
    "A's interval contains 0",
    'NOT RUN',
    'trusted only when every control it includes passes',
  ])
    assert.ok(readings.PASS_RULES.includes(want), want);
});

test('the fixture demos hold only the items and outcome scales', () => {
  for (const demo of Object.values(DATA.demos))
    for (const scale of Object.keys(demo))
      assert.ok(['items', 'outcome'].includes(scale), scale);
});
