// SPDX-License-Identifier: Apache-2.0
/**
 * The driver's `report` command: reads the stored answers and judgments of a run, applies the label rules and
 * writes `bench/out/<run-id>/report.json` and `report.md` (layout.reportJson, layout.reportMd). Offline: it makes no
 * model, AWS or network call and spends nothing. It writes those two files and nothing else.
 *
 * For each selected skill:
 *   1. `plan` says whether the skill can be run. A skill it does not plan (no baseline, no agent, an
 *      invalid baseline) is NO DATA with that status. A batch whose reading B waits for a refreshed baseline (rules or
 *      tasks stale) is still read by A: the skill is labeled from A alone, and is NO DATA only when A contains 0
 *      (the reason names the batch).
 *   2. The judge jobs of both scales are the ones the judge job itself lists (judge-job.js planJudging), so a
 *      judgment counts here exactly when the judge job counts it as current.
 *   3. Readings (readings-report.js readSkill), the guard result (guard-report.js), the label (labels.js) and the
 *      report figures (report.js skillDetails).
 * `convention-control` is a control, not a measured skill: it is read the same way and goes to the controls check,
 * never to the label table. The dose ladder (--skills dose-ladder, controls.js) has no plan row: its items are read by
 * A from the judgments of the ladder's authored answers and go to the controls check too.
 *
 * The run's spend comes from `ledgerFile` (the shared ledger, or a stub run's own one). Both files are redacted and
 * written through temporary files: each is written to a temporary file first, and the two renames follow. A write
 * that fails before the renames leaves both previous files. A failure or a kill between the two renames can leave the
 * new `report.json` beside the old `report.md`; running `report` again replaces both. A write that fails is an I/O
 * error the driver reports as "cannot write" (exit 74), naming the file the report was meant for.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { collectBatches, buildGuardReport } = require('./guard-report');
const { selectedLadder, splitSelection } = require('./controls');
const { itemNames } = require('./dose-ladder');
const { createJudgeInput } = require('./judge-input');
const { RUNNABLE_STATUSES, planJudging } = require('./judge-job');
const { labelSkill } = require('./labels');
const { readLedger } = require('./ledger');
const { buildPlan } = require('./plan');
const {
  CONVENTION_CONTROL,
  buildReadingsReport,
  ladderDoses,
  readSkill,
} = require('./readings-report');
const { INPUT_CEILING, redact } = require('./redact');
const {
  buildReport,
  renderReportMarkdown,
  skillDetails,
  spendOf,
} = require('./report');

/** What the stdout line gives for a label of a run that is not trusted: the cell text of report.md. */
const WITHHELD_LABEL = 'withheld (controls: FAIL)';

/** Errors that are bugs in the benchmark, never a problem with one skill's files: they are thrown on. */
const isBug = (error) =>
  error instanceof TypeError ||
  error instanceof ReferenceError ||
  error instanceof SyntaxError ||
  error instanceof RangeError;
const messageOf = (error) =>
  String((error && error.message) || error).split('\n')[0];

/**
 * A report text the redactor cannot scan (a free text of more than INPUT_CEILING characters). It comes from the data
 * the report reads, not from a bug, so the driver answers it as a usage error (exit 64) and names the field.
 */
class ReportError extends Error {}

/** True for an error `fs` raised: Node sets a string `code` and `syscall` on these. */
const isSystemError = (error) =>
  error instanceof Error &&
  typeof error.code === 'string' &&
  typeof error.syscall === 'string';

/**
 * Writes the files `[{ file, text }]` as a pair (mode 0600, folders 0700). Every text goes to a temporary file in its
 * folder first; only when all are written is each renamed into place, so a full disk or a folder that cannot be
 * written leaves the files that were there before untouched, and no temporary file stays. A target that is a folder
 * is refused before any rename. A system error carries `writing` and the path of the file it was meant for, so the
 * driver says "cannot write" and not "cannot read", and names the report and not its temporary file.
 */
function writeFiles(files) {
  const temporaries = [];
  let target = null;
  try {
    for (const { file, text } of files) {
      target = file;
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      temporaries.push(temporary);
      fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    }
    for (const { file } of files) {
      target = file;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        throw Object.assign(
          new Error(`EISDIR: illegal operation on a directory, rename ${file}`),
          { code: 'EISDIR', syscall: 'rename' },
        );
    }
    files.forEach(({ file }, index) => {
      target = file;
      fs.renameSync(temporaries[index], file);
    });
  } catch (error) {
    for (const temporary of temporaries) fs.rmSync(temporary, { force: true });
    if (isSystemError(error)) {
      error.writing = true;
      error.path = target;
    }
    throw error;
  }
}

/**
 * What the report reads of one skill: { summary, label, details, convention }. `row` is the skill's plan row.
 */
function readOneSkill({
  layout,
  config,
  row,
  judgeInput,
  armsTmpRoot,
  warnings,
}) {
  const skill = row.skill;
  const batches = layout.batches(skill);
  const fail = (error) => {
    const summary = { skill, error };
    return {
      summary,
      label: labelSkill({ summary, batches }),
      details: skillDetails({ summary }),
    };
  };
  if (!RUNNABLE_STATUSES.has(row.status))
    return fail(`plan does not run it: ${row.status}`);
  if (row.status !== 'ready') warnings.push(`${skill}: ${row.status}`);
  let planned;
  try {
    const listFor = (scale) =>
      planJudging({
        layout,
        config,
        skills: [skill],
        scale,
        judgeInput,
        ...(armsTmpRoot ? { armsTmpRoot } : {}),
      });
    planned = { items: listFor('items'), outcome: listFor('outcome') };
  } catch (error) {
    if (isBug(error)) throw error;
    return fail(`its judge jobs could not be listed: ${messageOf(error)}`);
  }
  for (const list of Object.values(planned)) warnings.push(...list.warnings);
  const jobs = {
    itemsJobs: planned.items.jobs,
    outcomeJobs: planned.outcome.jobs,
  };
  const summary = readSkill({
    skill,
    ...jobs,
    excluded: planned.outcome.excluded,
  });
  const guard = buildGuardReport(collectBatches(jobs.itemsJobs));
  const bWaiting = row.batches
    .filter((entry) => entry.read_b === false)
    .map((entry) => entry.batch);
  return {
    summary,
    label: labelSkill({
      summary,
      batches,
      bWaiting,
      guardEntries: guard.skills[skill] ? guard.skills[skill].batches : null,
    }),
    details: skillDetails({ summary, ...jobs }),
  };
}

/**
 * The ladder input of the readings report (readings-report.js ladderDoses): each dose item read by A from the
 * judgments the judge job counts as current. Returns [{ dose, n, skill, summary }] in dose order.
 */
function readLadderControl({ layout, config, ladder, judgeInput, warnings }) {
  const items = itemNames(ladder);
  const planned = planJudging({
    layout,
    config,
    skills: items,
    scale: 'outcome',
    judgeInput,
    ladder,
  });
  warnings.push(...planned.warnings);
  const summaries = Object.fromEntries(
    items.map((item) => [
      item,
      readSkill({
        skill: item,
        outcomeJobs: planned.jobs,
        excluded: planned.excluded,
      }),
    ]),
  );
  return ladderDoses(ladder.doses, summaries);
}

/**
 * Builds the report of `skills` in the run of `layout`. Reads files and writes nothing. Options:
 *   layout, config, skills   the layout, the settings and the selected skill names
 *   ledgerFile               the ledger the run books into (default: layout.ledgerFile)
 *   now                      clock for `generated_at`
 *   provider                 `live` (default) or `stub`; a stub report says it is not a measurement
 *   armsTmpRoot              where the arms are built for their manifests (default: the system temp dir)
 * Returns { report, markdown }.
 */
function collectReport({
  layout,
  config,
  skills,
  ledgerFile = layout.ledgerFile,
  now = Date.now,
  provider = 'live',
  armsTmpRoot,
}) {
  const { skills: planned, ladder: wantsLadder } = splitSelection(skills);
  const plan = buildPlan({ layout, config, skills: planned });
  const warnings = [...plan.warnings];
  // The subject runner stores an answer as it is. A text that holds one of the run's credential values stops that run
  // (claude-run.js, sweepTrace), so no stored answer holds one and the report, which has none of those values, needs
  // no literals here.
  const judgeInput = createJudgeInput({ literals: [] });
  const measured = [];
  let convention = null;
  for (const row of plan.skills) {
    const read = readOneSkill({
      layout,
      config,
      row,
      judgeInput,
      armsTmpRoot,
      warnings,
    });
    if (row.skill === CONVENTION_CONTROL) convention = read.summary;
    else measured.push(read);
  }
  const ladder = wantsLadder
    ? readLadderControl({
        layout,
        config,
        ladder: selectedLadder(layout).ladder,
        judgeInput,
        warnings,
      })
    : null;
  const generatedAt = new Date(now()).toISOString();
  const readings = buildReadingsReport({
    skills: measured.map((entry) => entry.summary),
    convention,
    ladder,
    generatedAt,
  });
  let spend = null;
  try {
    spend = spendOf(readLedger(ledgerFile, { now }), layout.runId);
  } catch (error) {
    if (isBug(error)) throw error;
    warnings.push(`the spend ledger could not be read: ${messageOf(error)}`);
  }
  const report = buildReport({
    runId: layout.runId,
    generatedAt,
    provider,
    skills: measured,
    readings,
    spend,
    warnings: [...new Set(warnings)],
  });
  return { report, markdown: renderReportMarkdown(report) };
}

/**
 * Builds the report and writes report.json and report.md into the run folder. Returns the one-line result the
 * driver prints: { report: 'written', run_id, report_json, report_md, controls_status, labels_published, labels }.
 */
function writeReport(options) {
  const { layout } = options;
  const { report, markdown } = collectReport(options);
  // Free text in the report comes from the baseline, a person, a judge record and the warnings that quote them. It is redacted once
  // more here, as every other output of the benchmark is, so a secret-shaped string never lands in a report file.
  // report.json is redacted string by string (keys too), not as serialized text: JSON writes an inner quote as \",
  // and the rules that allow a quote before a value do not match through the backslash. Both texts are made before
  // either file is written, so a text that cannot be scanned stops the command with nothing written.
  const scrub = (text, what) => {
    const clean = redact(text, { maxChars: Infinity });
    if (
      text.length &&
      clean.startsWith('[REDACTED: ') &&
      !text.startsWith('[REDACTED: ')
    )
      throw new ReportError(
        `${what} is a text of ${text.length} characters, too long for the redactor to scan (the limit is ${INPUT_CEILING}); shorten it in the file it comes from`,
      );
    return clean;
  };
  // `where` is the path of the value in report.json, such as skills[0].exclusions[0].reason.
  const scrubValue = (value, where = '') => {
    const what = where ? `report.json field ${where}` : 'report.json';
    if (typeof value === 'string') return scrub(value, what);
    if (Array.isArray(value))
      return value.map((inner, index) =>
        scrubValue(inner, `${where}[${index}]`),
      );
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          scrub(key, `a key in ${what}`),
          scrubValue(inner, where ? `${where}.${key}` : key),
        ]),
      );
    return value;
  };
  const json = `${JSON.stringify(scrubValue(report), null, 2)}\n`;
  const markdownText = scrub(markdown, 'report.md');
  writeFiles([
    { file: layout.reportJson, text: json },
    { file: layout.reportMd, text: markdownText },
  ]);
  return {
    report: 'written',
    run_id: layout.runId,
    report_json: layout.reportJson,
    report_md: layout.reportMd,
    controls_status: report.controls_status,
    labels_published: report.labels_published,
    // The label of a run that is not trusted is withheld here as in report.md, not only in the markdown.
    labels: Object.fromEntries(
      report.skills.map((entry) => [
        entry.skill,
        report.labels_published ? entry.label : WITHHELD_LABEL,
      ]),
    ),
  };
}

module.exports = { ReportError, collectReport, writeReport };
