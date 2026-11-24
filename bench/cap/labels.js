// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's scripts/bench/lib/labels.js (pull request #263, commit 33b385f9), same repository and Apache-2.0 licence. Rules and dates unchanged; only the require paths differ.
/**
 * The labels: one label per skill from its reading A and reading B (readings-report.js readSkill), pooled over the
 * skill's batches, with the guard result and `a_batches_agree` shown beside it. Pure: no file access and no call.
 *
 *   A  `outcome` scale   the request-only checklist   mean task gap with a 95% t interval over the pooled tasks
 *   B  `items` scale     the rules checklist          the same, over the tasks A reads (B_all is over every task)
 *
 * Both are gaps with minus without on the same 1 to 5 scale, one number per task. "Above 0" means the lower end of
 * the 95% t interval is above 0. The rules read the unrounded interval ends (`t_interval_exact`), so a lower end that
 * prints as +0.00 can still be above 0, and an end of exactly 0 is neither above nor below 0.
 *
 * THE LABEL RULES are LABEL_RULES below: the report prints this text and labelFor and labelSkill evaluate it. They
 * were written on LABEL_RULES_DATE, before any run. Changing a rule is a new rule with a new date; results made
 * under the old one are not read again under the new one.
 *
 * NO DATA comes before any label, for any of these:
 *   - a reading counts fewer than 12 of every 16 tasks of the skill (MIN_COUNTED of PER_TASKS, so 12 of 16, or 4 of
 *     5 for a smaller set). A task excluded from A by a person is one of the skill's tasks that A does not count;
 *   - a judgment of either reading is stale (a judgment file made from other inputs, never read);
 *   - a batch of the skill was not read: it has no judge job on a reading, or reading it failed;
 *   - the skill could not be read at all.
 *
 * A batch whose reading B waits for a refreshed baseline (SKILL.md or the batch changed after the rules were written)
 * is not "not read": A still reads it, B's batch and coverage checks are skipped, and the skill is labeled from A with
 * B treated as having no interval. So it is NO DATA only when A's interval contains 0.
 *
 * The guard result and `a_batches_agree` are printed beside the label and change nothing.
 *
 * THE SUGGESTED VERDICT (VERDICT_RULES, verdictFor) is a separate line next to the label: keep, lean keep, close call,
 * lean prune, prune or no data, with one action for the reviewer. It reads the same pooled readings and leaves the
 * label rules as they are.
 */
'use strict';

const { gapStats, round4 } = require('./gapstats.js');
const { formatGap, formatInterval } = require('./gaptext.js');

const LABELS = Object.freeze({
  helps: 'helps quality',
  harm: 'harm',
  conventions: 'teaches conventions (human call)',
  none: 'no change',
  noData: 'NO DATA',
});
/** A reading must count at least MIN_COUNTED of every PER_TASKS tasks of the skill (12 of 16). */
const MIN_COUNTED = 12;
const PER_TASKS = 16;
const NO_GUARD_DATA = 'no guard data';

const LABEL_RULES_DATE = '2026-11-10';
// Ours, not copied: the per-batch coverage rule (owner yes on K-3, 2026-11-24). His rule 5 checks coverage over the
// pooled tasks only, so one thin batch could hide behind a full one.
const BATCH_RULES_DATE = '2026-11-24';
const BATCH_RULES = [
  'Beside the copied label rules, both depths: coverage is checked in each batch, not only over the pooled tasks.',
  '',
  '1. A skill is `NO DATA` when a reading counts fewer than 12 of every 16 tasks of any one batch it read (rounded up for another batch size), even when the pooled count passes.',
  '2. A change is a new dated rule; a record made under these rules is never read again under new ones.',
].join('\n');
const LABEL_RULES = [
  'Notation: "A" is the `outcome` reading (a checklist written from the request alone) and "B" the `items` reading (the rules checklist). Both are read from the same stored answers of a skill, pooled over its batches. A gap is with minus without on the 1 to 5 scale, one number per task. "Lower" and "upper" are the ends of the 95% t interval over the pooled tasks (df = tasks - 1). "Above 0" means the lower end is above 0.',
  '',
  '1. `helps quality`: the lower end of A is above 0.',
  '2. `harm`: the upper end of A is below 0.',
  "3. `teaches conventions (human call)`: the lower end of B is above 0 and A's interval contains 0.",
  '4. `no change`: neither lower end is above 0.',
  '5. The rules are checked in the order 1, 2, 3, 4 and the first match wins, so a skill gets exactly one label. A skill is `NO DATA` instead when a reading counts fewer than 12 of every 16 of its tasks, when a judgment of either reading is stale, when a batch was not read, or when A has no interval (fewer than 2 counted tasks), or A contains 0 and B has none.',
  '6. A label is a reading of one run on generated tasks under one judge panel. It is not a keep or prune verdict, and `teaches conventions` is a call for a person.',
].join('\n');

const VERDICTS = Object.freeze({
  keep: 'keep',
  leanKeep: 'lean keep',
  closeCall: 'close call',
  leanPrune: 'lean prune',
  prune: 'prune',
  noData: 'no data',
});
// The cut points are a maintainer's choice, not a statistical test: an A mean gap of -0.10 or more counts as no task
// cost, and a B mean gap of +0.50 or more as a clear rules gain. Under +0.30 the skill changes its answers little.
const VERDICT_A_FLOOR = -0.1;
const VERDICT_B_STRONG = 0.5;
const VERDICT_B_WEAK = 0.3;
const VERDICT_RULES_DATE = '2026-11-16';
const VERDICT_RULES = [
  'A suggested verdict is read from the same pooled A and B readings as the label. It is a suggestion; the final call is the maintainer\'s. "Mean" is the pooled mean gap. The cut points are a maintainer\'s choice.',
  '',
  "1. `keep`: A's lower end is above 0.",
  "2. `prune`: A's upper end is below 0.",
  "3. `lean keep`: A's mean is -0.10 or more and B's mean is +0.50 or more.",
  "4. `lean prune`: A's mean is -0.10 or less, or B's mean is under +0.30.",
  '5. `close call`: anything else, including a B with no mean.',
  '6. The rules are checked in the order 1 to 5 and the first match wins. A skill labeled `NO DATA` gets `no data`.',
  '7. The action beside a `prune` or `lean prune` verdict says "fix" when B\'s mean is +0.50 or more: the answers follow the skill\'s rules but the task result is worse, so the rules that cost quality are the first thing to change.',
].join('\n');
const VERDICT_ACTIONS = Object.freeze({
  keep: 'Keep.',
  leanKeep:
    'Keep if the team wants these rules; the task result does not change.',
  closeCall: 'Read the item losses before deciding.',
  fix: 'Fix the rules that cost task quality (see the item losses), or prune.',
  prune: 'Prune: it makes the task result worse.',
  leanPrune: 'Prune unless the team needs these rules.',
});

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** The interval the rules read: the unrounded one when the reading has it, else the printed one. */
const exactInterval = (reading) =>
  reading && Array.isArray(reading.t_interval_exact)
    ? reading.t_interval_exact
    : reading && Array.isArray(reading.t_interval)
      ? reading.t_interval
      : null;

/**
 * The label of a skill from its pooled A and B readings ({ t_interval_exact } as readingOf gives them). Returns
 * { label, why }. Coverage, staleness and unread batches are labelSkill's; this applies rules 1 to 4 and the
 * interval part of rule 5. `whyNoB` names the cause when A contains 0 and B has no interval.
 */
function labelFor(
  readingA,
  readingB,
  { whyNoB = 'B has fewer than 2 counted tasks, so it has no interval' } = {},
) {
  const intervalA = exactInterval(readingA);
  if (!intervalA)
    return {
      label: LABELS.noData,
      why: 'A has fewer than 2 counted tasks, so it has no interval',
    };
  if (intervalA[0] > 0)
    return {
      label: LABELS.helps,
      why: `A lower end ${formatGap(intervalA[0])} is above 0`,
    };
  if (intervalA[1] < 0)
    return {
      label: LABELS.harm,
      why: `A upper end ${formatGap(intervalA[1])} is below 0`,
    };
  const intervalB = exactInterval(readingB);
  if (!intervalB)
    return {
      label: LABELS.noData,
      why: `A ${formatInterval(intervalA)} contains 0 and ${whyNoB}`,
    };
  if (intervalB[0] > 0)
    return {
      label: LABELS.conventions,
      why: `A ${formatInterval(intervalA)} contains 0 and B lower end ${formatGap(intervalB[0])} is above 0`,
    };
  return {
    label: LABELS.none,
    why: `A ${formatInterval(intervalA)} and B ${formatInterval(intervalB)}: neither lower end is above 0`,
  };
}

/**
 * The suggested verdict of a skill from its label and pooled readings (VERDICT_RULES). `label` is the skill's label,
 * `readingA` and `readingB` the readings it was read from ({ mean_gap, t_interval_exact }). Returns
 * { verdict, why, action }. A NO DATA skill gets `no data`, with the label's reason as the action.
 */
function verdictFor(label, readingA, readingB, { noDataWhy = '' } = {}) {
  const intervalA = exactInterval(readingA);
  if (label === LABELS.noData || !intervalA)
    return {
      verdict: VERDICTS.noData,
      why: 'the skill is NO DATA',
      action: noDataWhy || 'See why the skill is NO DATA.',
    };
  const meanA = readingA.mean_gap;
  const meanB =
    readingB && typeof readingB.mean_gap === 'number'
      ? readingB.mean_gap
      : null;
  const rulesGain = meanB !== null && meanB >= VERDICT_B_STRONG;
  const pruneAction = rulesGain ? VERDICT_ACTIONS.fix : VERDICT_ACTIONS.prune;
  const leanPruneAction = rulesGain
    ? VERDICT_ACTIONS.fix
    : VERDICT_ACTIONS.leanPrune;
  if (intervalA[0] > 0)
    return {
      verdict: VERDICTS.keep,
      why: `A lower end ${formatGap(intervalA[0])} is above 0`,
      action: VERDICT_ACTIONS.keep,
    };
  if (intervalA[1] < 0)
    return {
      verdict: VERDICTS.prune,
      why: `A upper end ${formatGap(intervalA[1])} is below 0`,
      action: pruneAction,
    };
  if (meanB === null)
    return {
      verdict:
        meanA <= VERDICT_A_FLOOR ? VERDICTS.leanPrune : VERDICTS.closeCall,
      why: `A mean ${formatGap(meanA)}, B has no mean`,
      action:
        meanA <= VERDICT_A_FLOOR ? leanPruneAction : VERDICT_ACTIONS.closeCall,
    };
  const means = `A mean ${formatGap(meanA)}, B mean ${formatGap(meanB)}`;
  if (meanA >= VERDICT_A_FLOOR && meanB >= VERDICT_B_STRONG)
    return {
      verdict: VERDICTS.leanKeep,
      why: means,
      action: VERDICT_ACTIONS.leanKeep,
    };
  if (meanA <= VERDICT_A_FLOOR || meanB < VERDICT_B_WEAK)
    return { verdict: VERDICTS.leanPrune, why: means, action: leanPruneAction };
  return {
    verdict: VERDICTS.closeCall,
    why: means,
    action: VERDICT_ACTIONS.closeCall,
  };
}

/** The fewest counted tasks a reading needs out of `tasks`: 12 of 16, rounded up for another size. */
const minCounted = (tasks) => Math.ceil((tasks * MIN_COUNTED) / PER_TASKS);

/**
 * Why the readings of `summary` (readSkill) cannot be labeled, one line per cause, in a fixed order. Options:
 *   batches       the batch names the skill's baseline has; each one must be read by both readings
 *   batchErrors   [{ batch, error }] for the batches whose judge jobs could not be listed
 *   bWaiting      the batch names whose reading B waits for a refreshed baseline (plan row `read_b` false). B is
 *                 not checked in them, and with any of them B's coverage is not checked either: labelSkill labels
 *                 from A alone.
 * An empty list means the skill can be labeled.
 */
function noDataReasons(
  summary,
  { batches = [], batchErrors = [], bWaiting = [] } = {},
) {
  if (!isPlainObject(summary)) return ['the skill was not read'];
  if (summary.error) return [`the skill could not be read: ${summary.error}`];
  const reasons = [];
  for (const { batch, error } of batchErrors)
    reasons.push(`batch ${batch} could not be read: ${error}`);
  const excludedIn = (batch) =>
    summary.exclusions.filter((record) => record.batch === batch).length;
  for (const batch of batches) {
    if (batchErrors.some((entry) => entry.batch === batch)) continue;
    if (bWaiting.includes(batch)) {
      // B has no work here by design. Without B's task count, any exclusion in the batch leaves A's gaps to the
      // coverage rule.
      if (!summary.A.by_batch[batch] && excludedIn(batch) === 0)
        reasons.push(`batch ${batch} was not read: A has no judge job in it`);
      continue;
    }
    const readB = summary.B_all.by_batch[batch];
    if (!readB) {
      reasons.push(`batch ${batch} was not read: B has no judge job in it`);
      continue;
    }
    // A batch whose every task a person has excluded from A has nothing for A to read, and that is not an error.
    if (!summary.A.by_batch[batch] && excludedIn(batch) < readB.tasks)
      reasons.push(`batch ${batch} was not read: A has no judge job in it`);
  }
  const need = minCounted(summary.tasks);
  const coverage = [['A', summary.A]];
  if (!bWaiting.length) coverage.push(['B', summary.B_all]);
  for (const [name, reading] of coverage)
    if (reading.tasks_counted < need)
      reasons.push(
        `${name} counts ${reading.tasks_counted} of the skill's ${summary.tasks} tasks, below ${need} (12 of every 16)`,
      );
  for (const [name, reading] of coverage)
    for (const [batch, read] of Object.entries(reading.by_batch || {}))
      if (read.tasks_counted < minCounted(read.tasks))
        reasons.push(
          `${name} counts ${read.tasks_counted} of batch ${batch}'s ${read.tasks} tasks, below ${minCounted(read.tasks)} (batch coverage rule, 12 of every 16 in each batch)`,
        );
  for (const [name, reading] of [
    ['A', summary.A],
    ['B', summary.B_all],
  ])
    if (reading.judgments.stale > 0)
      reasons.push(
        `${name} has ${reading.judgments.stale} stale judgment(s): made from other inputs and not read until the judge job makes them again`,
      );
  return reasons;
}

/**
 * True when A's mean gap has the same sign in every batch that has one, false when it does not, and null when fewer
 * than 2 batches have a mean. A batch mean of exactly 0 has no sign, so it never agrees.
 */
function aBatchesAgree(readingA) {
  const means = Object.values((readingA && readingA.by_batch) || {})
    .map((batch) => batch.mean_gap)
    .filter((mean) => typeof mean === 'number');
  if (means.length < 2) return null;
  return means.every((mean) => mean > 0) || means.every((mean) => mean < 0);
}

/**
 * The guard result of a skill over its batches, from its guard report entries (guard-report.js buildGuardReport,
 * `skills[skill].batches`). Per batch: the guard MET rates and `loss`. Pooled: the mean of the per-task guard gaps of
 * every batch that has guard data, with a 95% t interval, and `loss` when any batch has one.
 */
function poolGuard(batchEntries) {
  const entries = Object.values(batchEntries || {});
  const batches = entries.map((entry) => ({
    batch: entry.batch,
    data: !!entry.guard.data,
    items: entry.guard.items,
    with_rate: entry.guard.with_rate,
    without_rate: entry.guard.without_rate,
    loss: entry.guard.loss,
    note: entry.guard.note,
  }));
  const withData = entries.filter((entry) => entry.guard.data);
  if (!withData.length)
    return {
      data: false,
      note: NO_GUARD_DATA,
      batches,
      gap: null,
      loss: null,
      loss_batches: [],
    };
  const gaps = withData.flatMap((entry) =>
    entry.guard.gap.per_task.map((row) => row.gap),
  );
  const stats = gapStats(gaps);
  const lossBatches = withData
    .filter((entry) => entry.guard.loss)
    .map((entry) => entry.batch);
  return {
    data: true,
    note: null,
    batches,
    gap: {
      tasks_counted: stats.tasks,
      mean_gap: round4(stats.mean_gap),
      t_interval: stats.t_interval && stats.t_interval.map(round4),
    },
    loss: lossBatches.length > 0,
    loss_batches: lossBatches,
  };
}

/** The part of a reading the label table shows, with the unrounded interval the label rules read. */
const briefOf = (reading) =>
  reading
    ? {
        tasks: reading.tasks,
        tasks_counted: reading.tasks_counted,
        mean_gap: reading.mean_gap,
        t_interval: reading.t_interval,
        t_interval_exact: reading.t_interval_exact,
      }
    : null;

/**
 * The label entry of one skill. Options:
 *   summary        readSkill result ({ skill, tasks, A, B, B_all, exclusions, ... } or { skill, error })
 *   batches        the batch names of the skill's baseline
 *   batchErrors    [{ batch, error }] for batches that could not be listed
 *   bWaiting       batch names whose reading B waits for a refreshed baseline; with any, the label is read from A
 *                  alone and B counts as having no interval
 *   guardEntries   the skill's guard report batch entries, or null when there is no guard report for it
 * Returns { skill, label, why, verdict, verdict_why, verdict_action, no_data, A, B, B_all, a_batches_agree, guard }.
 * `no_data` lists every reason the skill is NO DATA (empty otherwise), and `why` is the first one, or the rule that
 * gave the label. `verdict` is the suggested verdict (verdictFor), read from the same readings as the label.
 */
function labelSkill({
  summary,
  batches = [],
  batchErrors = [],
  bWaiting = [],
  guardEntries = null,
}) {
  if (!isPlainObject(summary) || typeof summary.skill !== 'string')
    throw new TypeError('summary must be a readSkill result');
  const waiting = [...new Set(bWaiting)];
  const noData = noDataReasons(summary, {
    batches,
    batchErrors,
    bWaiting: waiting,
  });
  const read = !summary.error;
  const ruled =
    noData.length || !read
      ? { label: LABELS.noData, why: noData[0] }
      : waiting.length
        ? labelFor(summary.A, null, {
            whyNoB: `reading B waits for a refreshed baseline in batch ${waiting.join(', ')}`,
          })
        : labelFor(summary.A, summary.B);
  if (!noData.length && ruled.label === LABELS.noData) noData.push(ruled.why);
  const suggested = verdictFor(
    ruled.label,
    read ? summary.A : null,
    read && !waiting.length ? summary.B : null,
    { noDataWhy: noData[0] },
  );
  return {
    skill: summary.skill,
    label: ruled.label,
    why: ruled.why,
    verdict: suggested.verdict,
    verdict_why: suggested.why,
    verdict_action: suggested.action,
    no_data: noData,
    A: read ? briefOf(summary.A) : null,
    B: read ? briefOf(summary.B) : null,
    B_all: read ? briefOf(summary.B_all) : null,
    a_batches_agree: read ? aBatchesAgree(summary.A) : null,
    guard: guardEntries ? poolGuard(guardEntries) : null,
  };
}

module.exports = {
  LABELS,
  LABEL_RULES,
  LABEL_RULES_DATE,
  BATCH_RULES,
  BATCH_RULES_DATE,
  MIN_COUNTED,
  PER_TASKS,
  NO_GUARD_DATA,
  labelFor,
  verdictFor,
  VERDICTS,
  VERDICT_RULES,
  VERDICT_RULES_DATE,
  minCounted,
  noDataReasons,
  aBatchesAgree,
  poolGuard,
  labelSkill,
};
