// SPDX-License-Identifier: Apache-2.0
/**
 * The report writer: the summary (`report.json`) and the markdown report (`report.md`) of one run, built from the
 * readings (readings-report.js), the labels (labels.js), the guard result (guard-report.js) and the spend ledger.
 * Pure given `generatedAt` (the clock is read only when a caller leaves it out) and `readRecord`: it writes no file and
 * makes no call. The driver's `report` command gathers the inputs and writes the two files.
 *
 * What the report adds to the readings, per skill and reading. Each answer is judged on its own, so a seat gives a
 * task one judgment of the with answer and one of the without answer; these figures read a seat's two judgments
 * together, and a seat counts only with a valid judgment for both arms (as in the task gap):
 *
 *   seats agree    how many counted tasks had every counted seat vote the same way: WITH when the seat scored the
 *                  with answer higher, WITHOUT when lower, TIE when the same.
 *   item losses    (reading B) per rules checklist item, how many seats gave the with answer a lower label than the
 *                  without answer (MET > PARTIAL > MISSING) and how many a higher one; the items lost more often than
 *                  won are listed, worst first. A concrete thing the skill's answers miss.
 *
 * Only the tasks a reading counts are read for these figures, so none of them is read from a task the reading
 * leaves out. The controls verdict comes from the readings report: when it is FAIL the report says `controls: FAIL`
 * at the top and the labels are withheld from the markdown (report.json keeps them, with `labels_published` false).
 */
'use strict';

const { readJudgment, STATUS_VALID } = require('./judge-job');
const { WEIGHT } = require('./judge-scale');
const {
  LABEL_RULES,
  LABEL_RULES_DATE,
  LABELS,
  VERDICTS,
  VERDICT_RULES,
  VERDICT_RULES_DATE,
} = require('./labels');
const { ARMS } = require('./layout');
const { redact } = require('./redact');
const {
  CONTROLS_LINE,
  controlsTable,
  formatGap,
  formatInterval,
  formatReading,
  oneLine,
} = require('./report-text');
const { PROVIDERS } = require('./stub-provider');

const REPORT_VERSION = 1;
/** Items listed per skill in the item-loss table. */
const WORST_ITEMS = 8;
const CELL_CHARS = 110;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const taskKey = (batch, taskId) => `${batch}\u0000${taskId}`;
const defaultReadRecord = (job) => readJudgment(job.file);

/** The keys (batch and task) of the tasks a reading counts. */
const countedTasks = (reading) =>
  new Set(
    ((reading && reading.per_task) || [])
      .filter((row) => row.counted)
      .map((row) => taskKey(row.batch, row.task_id)),
  );

/**
 * The counted seats of the done jobs in `counted` tasks: [{ batch, task_id, seat, checklist, with, without }], one
 * per task and seat that has a valid record with a score for both arms (`with` and `without` are those records). A
 * record that names another seat or arm than its job is left out, as in the task gap, and a later record for the same
 * seat and arm replaces an earlier one.
 */
function countedSeats(jobs, { readRecord, counted }) {
  const bySeat = new Map();
  for (const job of jobs) {
    if (job.state !== 'done') continue;
    const key = taskKey(job.batch, job.task.id);
    if (!counted.has(key)) continue;
    const record = readRecord(job);
    if (!isPlainObject(record) || record.status !== STATUS_VALID) continue;
    if (typeof record.score !== 'number' || !ARMS.includes(record.arm))
      continue;
    if (record.seat !== job.seat || record.arm !== job.arm) continue;
    const seatKey = `${key}\u0000${job.seat}`;
    if (!bySeat.has(seatKey))
      bySeat.set(seatKey, {
        batch: job.batch,
        task_id: job.task.id,
        seat: job.seat,
        checklist: null,
        arms: new Map(),
      });
    const entry = bySeat.get(seatKey);
    entry.arms.set(record.arm, record);
    if (Array.isArray(job.checklist)) entry.checklist = job.checklist;
  }
  return [...bySeat.values()]
    .filter((entry) => ARMS.every((arm) => entry.arms.has(arm)))
    .map(({ arms, ...entry }) => ({
      ...entry,
      with: arms.get('with'),
      without: arms.get('without'),
    }));
}

/** The vote of one counted seat: which of its two answers it scored higher. */
const voteOf = (seat) =>
  seat.with.score > seat.without.score
    ? 'WITH'
    : seat.with.score < seat.without.score
      ? 'WITHOUT'
      : 'TIE';

/**
 * How the seats agree on one reading, over its counted tasks: { tasks, unanimous }, where `tasks` counts the tasks
 * with at least one counted seat and `unanimous` the tasks where every counted seat has the same vote.
 */
function seatAgreement(jobs, { readRecord = defaultReadRecord, counted }) {
  const byTask = new Map();
  for (const seat of countedSeats(jobs, { readRecord, counted })) {
    const key = taskKey(seat.batch, seat.task_id);
    if (!byTask.has(key)) byTask.set(key, new Set());
    byTask.get(key).add(voteOf(seat));
  }
  const tasks = [...byTask.values()];
  return {
    tasks: tasks.length,
    unanimous: tasks.filter((votes) => votes.size === 1).length,
  };
}

/**
 * Per rules checklist item of reading B: how often a seat gave the with answer a lower label than the without answer,
 * and how often a higher one, over the counted seats of the counted tasks (each seat's with judgment against its
 * without judgment). Returns
 *   { seat_pairs, with_worse, with_better, worst: [{ batch, task_id, item, text, worse, better, seat_pairs }] }
 * where `worst` holds at most `limit` items lost more often than won, the biggest margin first.
 */
function itemLosses(
  itemsJobs,
  { readRecord = defaultReadRecord, counted, limit = WORST_ITEMS },
) {
  const rows = new Map();
  let seatPairs = 0;
  let withWorse = 0;
  let withBetter = 0;
  for (const seat of countedSeats(itemsJobs, { readRecord, counted })) {
    const checklist = seat.checklist;
    const withLabels = seat.with.labels;
    const withoutLabels = seat.without.labels;
    if (
      !checklist ||
      !Array.isArray(withLabels) ||
      !Array.isArray(withoutLabels) ||
      withLabels.length !== checklist.length ||
      withoutLabels.length !== checklist.length
    )
      continue;
    seatPairs += 1;
    checklist.forEach((text, index) => {
      const withWeight = WEIGHT[withLabels[index]];
      const withoutWeight = WEIGHT[withoutLabels[index]];
      if (typeof withWeight !== 'number' || typeof withoutWeight !== 'number')
        return;
      const key = `${taskKey(seat.batch, seat.task_id)}\u0000${index}`;
      if (!rows.has(key))
        rows.set(key, {
          batch: seat.batch,
          task_id: seat.task_id,
          item: index + 1,
          text: String(text),
          worse: 0,
          better: 0,
          seat_pairs: 0,
        });
      const row = rows.get(key);
      row.seat_pairs += 1;
      if (withWeight < withoutWeight) {
        row.worse += 1;
        withWorse += 1;
      } else if (withWeight > withoutWeight) {
        row.better += 1;
        withBetter += 1;
      }
    });
  }
  const worst = [...rows.values()]
    .filter((row) => row.worse > row.better)
    .sort(
      (left, right) =>
        right.worse - right.better - (left.worse - left.better) ||
        right.worse - left.worse ||
        (left.batch < right.batch ? -1 : left.batch > right.batch ? 1 : 0) ||
        (left.task_id < right.task_id
          ? -1
          : left.task_id > right.task_id
            ? 1
            : 0) ||
        left.item - right.item,
    )
    .slice(0, limit);
  return {
    seat_pairs: seatPairs,
    with_worse: withWorse,
    with_better: withBetter,
    worst,
  };
}

/**
 * The figures of one skill the report adds to its readings. `summary` is readSkill's result; the jobs are the ones
 * it was read from. Returns { seats_agree: { A, B }, item_losses } (null figures for a skill that could not be read).
 */
function skillDetails({
  summary,
  itemsJobs = [],
  outcomeJobs = [],
  readRecord = defaultReadRecord,
}) {
  if (!summary || summary.error)
    return { seats_agree: null, item_losses: null };
  const ofSkill = (list) => list.filter((job) => job.skill === summary.skill);
  const readings = {
    A: { jobs: ofSkill(outcomeJobs), counted: countedTasks(summary.A) },
    B: { jobs: ofSkill(itemsJobs), counted: countedTasks(summary.B) },
  };
  return {
    seats_agree: Object.fromEntries(
      Object.entries(readings).map(([name, { jobs, counted }]) => [
        name,
        seatAgreement(jobs, { readRecord, counted }),
      ]),
    ),
    item_losses: itemLosses(readings.B.jobs, {
      readRecord,
      counted: readings.B.counted,
    }),
  };
}

const toCents = (usd) => Math.round(usd * 100) / 100;

/**
 * The spend part of the report from readLedger totals: this run's spend and reservations, the calls of this run
 * charged their mean because they reported no usable cost (`estimated_*`) or charged 0 because they ended before a
 * model step started (`unstarted_calls`), and the whole ledger, which other runs share (`ledger_*`).
 */
function spendOf(totals, runId) {
  const run = (totals && totals.runs && totals.runs.get(runId)) || {
    spent: 0,
    reserved: 0,
  };
  const runSources = (totals && totals.byRun && totals.byRun.get(runId)) || {
    estimated: { calls: 0, usd: 0 },
    unstarted: { calls: 0 },
  };
  return {
    run_spent_usd: toCents(run.spent),
    run_reserved_usd: toCents(run.reserved),
    ledger_total_usd: toCents((totals && totals.total) || 0),
    ledger_calls: (totals && totals.calls) || 0,
    estimated_calls: runSources.estimated.calls,
    estimated_usd: toCents(runSources.estimated.usd),
    unstarted_calls: runSources.unstarted.calls,
    ledger_estimated_calls:
      (totals && totals.estimated && totals.estimated.calls) || 0,
    ledger_estimated_usd: toCents(
      (totals && totals.estimated && totals.estimated.usd) || 0,
    ),
  };
}

/** The coverage figures of one reading. */
const coverageOf = (reading) => ({
  tasks: reading.tasks,
  tasks_counted: reading.tasks_counted,
  ...reading.judgments,
});

/**
 * The report summary (report.json). Pure. Options:
 *   runId, generatedAt   the run and the time to print
 *   provider             `live` (the default) or `stub`: a stub report says at the top that it is not a measurement
 *   skills               [{ label (labels.js labelSkill), summary (readSkill), details (skillDetails) }] in order
 *   readings             buildReadingsReport result (its controls and controls_status are used)
 *   spend                spendOf result, or null when the ledger could not be read
 *   warnings             lines to print at the end
 */
function buildReport({
  runId,
  generatedAt = new Date().toISOString(),
  provider = 'live',
  skills = [],
  readings,
  spend = null,
  warnings = [],
}) {
  if (!isPlainObject(readings))
    throw new TypeError('readings must be a readings report');
  if (!Array.isArray(skills)) throw new TypeError('skills must be an array');
  if (!PROVIDERS.includes(provider))
    throw new TypeError(`provider must be one of ${PROVIDERS.join(', ')}`);
  const published = readings.controls_status !== 'FAIL';
  return {
    version: REPORT_VERSION,
    run_id: runId,
    provider,
    generated_at: generatedAt,
    controls_status: readings.controls_status,
    trusted: readings.trusted,
    labels_published: published,
    label_rules_date: LABEL_RULES_DATE,
    label_rules: LABEL_RULES,
    verdict_rules_date: VERDICT_RULES_DATE,
    verdict_rules: VERDICT_RULES,
    pass_rules_date: readings.rules_date,
    pass_rules: readings.rules,
    scales: readings.scales,
    prompt_versions: readings.prompt_versions,
    skills: skills.map(({ label, summary, details }) => ({
      ...label,
      tasks: summary && !summary.error ? summary.tasks : 0,
      exclusions: summary && !summary.error ? summary.exclusions : [],
      length_ratio:
        summary && !summary.error
          ? {
              tasks: summary.length_ratio.tasks,
              mean: summary.length_ratio.mean,
            }
          : null,
      coverage:
        summary && !summary.error
          ? { A: coverageOf(summary.A), B: coverageOf(summary.B_all) }
          : null,
      by_batch:
        summary && !summary.error
          ? { A: summary.A.by_batch, B: summary.B.by_batch }
          : null,
      not_counted:
        summary && !summary.error
          ? { A: summary.A.not_counted, B: summary.B_all.not_counted }
          : null,
      ...details,
    })),
    controls: Object.fromEntries(
      Object.entries(readings.controls).map(([name, control]) => [
        name,
        control.evaluation,
      ]),
    ),
    spend,
    warnings: [...warnings],
  };
}

// ---- markdown ---------------------------------------------------------------------------------------------------------

/** A table cell: redacted first and cut after, so a cut cannot leave the front half of a secret that no rule matches. */
const cell = (text) => {
  const line = redact(oneLine(text), { maxChars: Number.POSITIVE_INFINITY });
  return line.length > CELL_CHARS
    ? `${line.slice(0, CELL_CHARS - 3)}...`
    : line;
};
const formatRate = (value) =>
  typeof value === 'number' ? `${Math.round(value * 100)}%` : 'n/a';
const formatUsd = (value) => `$${value.toFixed(2)}`;
const formatAgree = (value) =>
  value === null ? 'n/a (one batch)' : value ? 'yes' : 'no';

/** The guard cell of the label table: the pooled guard gap and the loss, or "no guard data". */
function guardCell(guard) {
  if (!guard) return 'n/a';
  if (!guard.data) return guard.note;
  const loss = guard.loss
    ? `GUARD LOSS in ${guard.loss_batches.map(oneLine).join(', ')}`
    : 'no loss';
  return `${formatGap(guard.gap.mean_gap)} ${formatInterval(guard.gap.t_interval)}, ${loss}`;
}

/** The lines at the top: the controls banner, then how to read a label. */
function headLines(report) {
  const lines = [
    '# Skill benchmark report',
    '',
    `Run \`${oneLine(report.run_id)}\`. Generated ${report.generated_at}. Label rules dated ${report.label_rules_date}; control pass rules dated ${report.pass_rules_date}.`,
    '',
  ];
  if (report.provider === 'stub')
    lines.push(
      '**STUB DATA: not a measurement.** This run used the stub provider, which makes up its answers, judgments and costs. Nothing below says anything about a skill.',
      '',
    );
  if (report.controls_status === 'FAIL')
    lines.push(
      '**controls: FAIL**',
      '',
      'A control failed or was not run, so this run is not trusted and its labels are withheld below (`report.json` keeps them, with `labels_published` false). Look first at the judge prompt, the model IDs and the checklist writer, not at the skills.',
      '',
    );
  else
    lines.push(
      `Controls: **${report.controls_status}** (${CONTROLS_LINE[report.controls_status]}).`,
      '',
    );
  lines.push(
    'How to read a label: it describes one run on generated tasks under one judge panel. It is not a keep or prune verdict. `teaches conventions` is a call for a person: the model follows the skill\'s rules, and a neutral judge cannot say whether the team wants them. `helps quality` has no positive control yet: read it as "A\'s interval is above 0 on these tasks" and nothing stronger.',
    '',
  );
  return lines;
}

/** The suggested verdicts at a glance: the skills under each verdict, in the rules' order. Withheld with the labels. */
function verdictSummary(report) {
  if (!report.skills.length) return [];
  const lines = ['## Suggested verdicts', ''];
  if (!report.labels_published)
    return [...lines, 'Withheld with the labels (controls: FAIL).', ''];
  lines.push('| Suggested verdict | Skills |', '| --- | --- |');
  for (const verdict of Object.values(VERDICTS)) {
    const names = report.skills
      .filter((skill) => skill.verdict === verdict)
      .map((skill) => `\`${oneLine(skill.skill)}\``);
    if (names.length)
      lines.push(`| ${verdict} (${names.length}) | ${names.join(', ')} |`);
  }
  lines.push(
    '',
    "A suggestion read from A and B by the rules below; the final call is the maintainer's. Each skill's section gives the action.",
    '',
  );
  return lines;
}

function labelTable(report) {
  if (!report.skills.length)
    return [
      '## Labels',
      '',
      'No skill was measured in this run (controls only).',
      '',
    ];
  const lines = [
    '## Labels',
    '',
    '| Skill | Label | Suggested verdict | A gap | B gap | Guard (pooled) | A batches agree |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const skill of report.skills) {
    const label = report.labels_published
      ? `**${skill.label}**`
      : 'withheld (controls: FAIL)';
    const verdict = report.labels_published
      ? oneLine(skill.verdict)
      : 'withheld';
    lines.push(
      `| \`${oneLine(skill.skill)}\` | ${label} | ${verdict} | ${formatReading(skill.A)} | ${formatReading(skill.B)} | ${guardCell(skill.guard)} | ${formatAgree(skill.a_batches_agree)} |`,
    );
  }
  lines.push(
    '',
    `A = \`${report.scales.A}\` (the request-only checklist), B = \`${report.scales.B}\` (the rules checklist, over the tasks A reads). Each answer is judged on its own. Gaps are with minus without on the 1 to 5 scale: the mean over the pooled tasks with a 95% t interval. The guard result and "A batches agree" are shown beside the label and change nothing.`,
    '',
  );
  return lines;
}

function controlLines(report) {
  return [
    '## Controls',
    '',
    ...controlsTable(Object.entries(report.controls)),
    '',
  ];
}

function skillLines(report, skill) {
  const name = oneLine(skill.skill);
  const label = report.labels_published ? skill.label : 'withheld';
  const lines = [
    `## ${name}`,
    '',
    `Label: **${label}**${report.labels_published && skill.why ? ` (${oneLine(skill.why)})` : ''}.`,
    '',
  ];
  if (report.labels_published)
    lines.push(
      `Suggested verdict: **${oneLine(skill.verdict)}** (${oneLine(skill.verdict_why)}). Action: ${oneLine(skill.verdict_action)}`,
      '',
    );
  if (skill.no_data.length) {
    lines.push('NO DATA because:', '');
    for (const reason of skill.no_data) lines.push(`- ${oneLine(reason)}`);
    lines.push('');
  }
  if (!skill.coverage) return lines;
  const batches = [
    ...new Set([
      ...Object.keys(skill.by_batch.A),
      ...Object.keys(skill.by_batch.B),
    ]),
  ];
  const guardOf = (batch) =>
    skill.guard && skill.guard.batches.find((entry) => entry.batch === batch);
  const guardBatchCell = (entry) =>
    !entry
      ? 'n/a'
      : !entry.data
        ? oneLine(entry.note)
        : `${formatRate(entry.with_rate)} with / ${formatRate(entry.without_rate)} without${entry.loss ? ' (GUARD LOSS)' : ''}`;
  lines.push(
    '| Batch | A gap | B gap | Guard MET rate |',
    '| --- | --- | --- | --- |',
  );
  for (const batch of batches)
    lines.push(
      `| ${oneLine(batch)} | ${formatReading(skill.by_batch.A[batch])} | ${formatReading(skill.by_batch.B[batch])} | ${guardBatchCell(guardOf(batch))} |`,
    );
  lines.push(
    `| **pooled** | ${formatReading(skill.A)} | ${formatReading(skill.B)} | ${guardCell(skill.guard)} |`,
  );
  if (skill.exclusions.length)
    lines.push(
      `| **pooled, B over all ${skill.B_all.tasks} tasks** | | ${formatReading(skill.B_all)} | |`,
    );
  lines.push('');
  for (const record of skill.exclusions)
    lines.push(
      `- Left out of A: ${oneLine(record.batch)}/${oneLine(record.id)} (${oneLine(record.date)}). Reason: ${oneLine(record.reason)}`,
    );
  lines.push(
    `- Seats agree (every counted seat scored the same arm higher, or both the same): A ${skill.seats_agree.A.unanimous} of ${skill.seats_agree.A.tasks} tasks; B ${skill.seats_agree.B.unanimous} of ${skill.seats_agree.B.tasks} tasks.`,
    `- Length ratio (with / without words, mean per task): ${typeof skill.length_ratio.mean === 'number' ? skill.length_ratio.mean.toFixed(2) : 'n/a'} (n=${skill.length_ratio.tasks}).`,
  );
  for (const [reading, coverage] of Object.entries(skill.coverage))
    lines.push(
      `- Coverage ${reading}: ${coverage.tasks_counted} of ${coverage.tasks} tasks counted; judgments ${coverage.done} of ${coverage.expected} done, ${coverage.pending} pending (${coverage.stale} stale), ${coverage.waiting} waiting, ${coverage.not_loaded} not loaded, ${coverage.ineligible} not eligible, ${coverage.other_arm_unusable} other arm unusable.`,
    );
  for (const [reading, rows] of Object.entries(skill.not_counted))
    for (const row of rows)
      lines.push(
        `- Not counted in ${reading}: ${oneLine(row.batch)}/${oneLine(row.task_id)}: ${oneLine(row.invalid)}`,
      );
  const losses = skill.item_losses;
  lines.push(
    '',
    `Rules checklist items (B): ${losses.seat_pairs} seat(s) with both judgments; the with answer got a lower label than the without answer on ${losses.with_worse} item labels and a higher one on ${losses.with_better}.`,
    '',
  );
  if (!losses.worst.length)
    lines.push('No item is lost more often than it is won.', '');
  else {
    lines.push(
      '| Batch | Task | Item | Checklist item | Worse | Better | Seats |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const row of losses.worst)
      lines.push(
        `| ${oneLine(row.batch)} | ${oneLine(row.task_id)} | ${row.item} | ${cell(row.text)} | ${row.worse} | ${row.better} | ${row.seat_pairs} |`,
      );
    lines.push('');
  }
  return lines;
}

function spendLines(report) {
  const lines = ['## Spend', ''];
  if (!report.spend)
    return [...lines, 'The spend ledger could not be read.', ''];
  const spend = report.spend;
  lines.push(
    `This run: ${formatUsd(spend.run_spent_usd)} spent, ${formatUsd(spend.run_reserved_usd)} reserved. The ledger: ${formatUsd(spend.ledger_total_usd)} over ${spend.ledger_calls} calls.`,
  );
  if (spend.estimated_calls)
    lines.push(
      '',
      `${spend.estimated_calls} call(s) of this run reported no usable cost and are charged at their mean (${formatUsd(spend.estimated_usd)}).`,
    );
  if (spend.unstarted_calls)
    lines.push(
      '',
      `${spend.unstarted_calls} call(s) of this run ended before a model step started and are charged ${formatUsd(0)}.`,
    );
  if (spend.ledger_estimated_calls > spend.estimated_calls)
    lines.push(
      '',
      `The whole ledger, shared with other runs, holds ${spend.ledger_estimated_calls} call(s) charged at their mean (${formatUsd(spend.ledger_estimated_usd)}).`,
    );
  return [...lines, ''];
}

/** The markdown of a report summary (buildReport). */
function renderReportMarkdown(report) {
  const lines = [
    ...headLines(report),
    ...verdictSummary(report),
    ...labelTable(report),
    `## Label rules (dated ${report.label_rules_date})`,
    '',
    report.label_rules,
    '',
    `## Suggested verdict rules (dated ${report.verdict_rules_date})`,
    '',
    report.verdict_rules,
    '',
    ...controlLines(report),
  ];
  for (const skill of report.skills) lines.push(...skillLines(report, skill));
  lines.push(...spendLines(report));
  if (report.warnings.length) {
    lines.push('## Warnings', '');
    for (const warning of report.warnings) lines.push(`- ${oneLine(warning)}`);
    lines.push('');
  }
  lines.push(
    `A label is not a verdict, and a suggested verdict is a suggestion: the final call is the maintainer's. Labels: ${Object.values(
      LABELS,
    )
      .map((label) => `\`${label}\``)
      .join(', ')}. Suggested verdicts: ${Object.values(VERDICTS)
      .map((verdict) => `\`${verdict}\``)
      .join(', ')}.`,
  );
  return `${lines.join('\n')}\n`;
}

module.exports = {
  REPORT_VERSION,
  WORST_ITEMS,
  seatAgreement,
  itemLosses,
  skillDetails,
  spendOf,
  buildReport,
  renderReportMarkdown,
};
