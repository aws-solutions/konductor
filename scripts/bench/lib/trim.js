// SPDX-License-Identifier: Apache-2.0
/**
 * The `trim` command: drops the easy tasks of a trusted run from the committed baselines.
 *
 * A task whose answer scores near the top of the 1 to 5 scale both WITHOUT and WITH the skill leaves almost no room
 * for a gain, and every later run still pays to answer and judge it. Reading A (the request-only checklist, `outcome`
 * scale) already stores how well each arm's answer meets the request, so a task leaves
 * `bench/baselines/<skill>/tasks-<batch>.json` and its `.buckets.json` sidecar when BOTH its without-arm and its
 * with-arm reading A means are at or above the threshold. A task that is easy without the skill but scores lower with
 * it stays: the skill may be hurting there, and a later run should keep measuring that. A task with no counted
 * with-arm judgment has no with-arm mean and is never dropped.
 *
 * What is read. The same stored judgments `report` reads: run-report.js collectReport lists the reading A judge jobs
 * (judge-job.js planJudging) and readSkill reads them; this module adds nothing to how a judgment is counted. A task's
 * means are judge-job.js taskGaps `without_mean` and `with_mean`: the mean over the counted seats of each arm's A
 * score.
 *
 * What is refused (UsageError, exit 64), before any file is touched:
 *   - the run has no report.json, or its report is not from a live run (a stub run is not a measurement);
 *   - the run is not trusted (`controls_status` is not PASS);
 *   - the report is stale: the judgments on disk now do not give the report's coverage, controls or per-batch readings;
 *   - a skill's reading A counts fewer than 12 of every 16 of its tasks (labels.js minCounted), so its means rest on
 *     too few tasks to drop anything;
 *   - the trim would leave a kept rule of a skill without a checklist item in every batch, so reading B could not read it;
 *   - a baseline file changed after the plan was made (checked again just before the first file is replaced).
 * A baseline that does not match MANIFEST.json before the command starts is refused too (exit 1): rewriting the
 * manifest afterwards would otherwise approve a change nobody reviewed.
 *
 * What changes. Per batch: the tasks with both means at or above the threshold are dropped, except that a batch keeps at
 * least `minPerBatch` tasks (the file format's minimum): the dropped tasks whose lower arm mean is lowest come back
 * first. A task with no counted reading A judgment (excluded from A, or not judged) is never dropped. Task files, bucket files and the
 * manifest are written through temporary files and renamed; `--dry-run` writes nothing.
 *
 * After a trim the run's report no longer matches the baselines (fewer tasks), so the next trim of that run is refused
 * as stale until `report` is run again, and the message says the run was trimmed already.
 *
 * Rules and items. A task holds the checklist items of reading B, each tagged with a rule in its bucket file. Dropping a
 * task can leave a batch with no item for a rule (`rules_emptied` in the printed line names those); reading B pools
 * the batches, so that is allowed as long as another batch of the skill still has an item for the rule.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { isDeepStrictEqual } = require('util');

const { UsageError } = require('./cli-args');
const { verifyBaselines, writeManifest } = require('./baseline-manifest');
const { LIMITS, validateBuckets, validateTasks } = require('./formats');
const { taskGaps } = require('./judge-job');
const { SCORE_MAX, SCORE_MIN } = require('./judge-scale');
const { minCounted } = require('./labels');
const { parseJson, readFile, readJsonFile } = require('./read-file');
const { collectReport } = require('./run-report');
const { round4 } = require('./gap-stats');
const { CONVENTION_CONTROL } = require('./readings-report');
const { DOSE_LADDER } = require('./controls');

const DEFAULT_THRESHOLD = 4.8;
/** A batch below the format's minimum is not a valid task file, so the minimum cannot be set lower. */
const DEFAULT_MIN_PER_BATCH = LIMITS.minScenarios;
/** Absorbs floating-point noise in a mean of several scores, so a mean of 4.8 is not read as 4.799999999999999. */
const MEAN_EPSILON = 1e-9;
/** The key the readings report gives the dose ladder in `controls`, and the name --skills gives it. */
const LADDER_REPORT_KEY = 'ladder';
/** The names --skills gives the controls of a run. */
const CONTROL_NAMES = [CONVENTION_CONTROL, DOSE_LADDER];

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const PLAIN_INTEGER = /^\d+$/;

/** The value of --threshold: a plain decimal on the 1 to 5 scale. */
function parseThreshold(text) {
  const value = PLAIN_DECIMAL.test(text) ? Number(text) : NaN;
  if (!(Number.isFinite(value) && value >= SCORE_MIN && value <= SCORE_MAX))
    throw new UsageError(
      `--threshold: must be a plain decimal from ${SCORE_MIN} to ${SCORE_MAX} such as ${DEFAULT_THRESHOLD}, got ${JSON.stringify(text)}`,
    );
  return value;
}

/** The value of --min-per-batch: a whole number, at least the number of tasks a task file needs. */
function parseMinPerBatch(text) {
  const value = PLAIN_INTEGER.test(text) ? Number(text) : NaN;
  if (!(Number.isSafeInteger(value) && value >= DEFAULT_MIN_PER_BATCH))
    throw new UsageError(
      `--min-per-batch: must be a whole number of at least ${DEFAULT_MIN_PER_BATCH} (a task file with fewer is not valid), got ${JSON.stringify(text)}`,
    );
  return value;
}

/** True when `mean` is a number at or above the threshold (a null or missing mean never is). */
const reaches = (mean, threshold) =>
  typeof mean === 'number' && mean >= threshold - MEAN_EPSILON;

/**
 * What one batch keeps. `entries` is [{ id, mean, withMean }] in file order: `mean` is the without-arm reading A mean
 * and `withMean` the with-arm one, each null for a task with no counted judgment. A task is easy only when both reach
 * the threshold. Returns { kept: [id], dropped: [{ id, without_mean, with_mean }], restored: [...same] }: `dropped` are
 * the tasks that leave and `restored` the easy ones that stay because the batch would fall below `minPerBatch`, taken
 * from the lowest of their two means up (file order breaks a tie).
 */
function decideBatch(entries, { threshold, minPerBatch }) {
  const easy = entries.filter(
    (entry) =>
      reaches(entry.mean, threshold) && reaches(entry.withMean, threshold),
  );
  const needed = Math.max(0, minPerBatch - (entries.length - easy.length));
  const restored = easy
    .map((entry, order) => ({ entry, order }))
    .sort(
      (a, b) =>
        Math.min(a.entry.mean, a.entry.withMean) -
          Math.min(b.entry.mean, b.entry.withMean) || a.order - b.order,
    )
    .slice(0, needed)
    .map(({ entry }) => entry);
  const gone = new Set(
    easy.filter((entry) => !restored.includes(entry)).map((entry) => entry.id),
  );
  const view = (entry) => ({
    id: entry.id,
    without_mean: round4(entry.mean),
    with_mean: round4(entry.withMean),
  });
  return {
    kept: entries.filter((entry) => !gone.has(entry.id)).map((e) => e.id),
    dropped: entries.filter((entry) => gone.has(entry.id)).map(view),
    restored: entries.filter((entry) => restored.includes(entry)).map(view),
  };
}

/** The parts of a report two reads of the same judgments must agree on; the clock and the spend are left out. */
function fingerprint(report) {
  const normalized = JSON.parse(JSON.stringify(report));
  return {
    controls_status: normalized.controls_status,
    trusted: normalized.trusted,
    controls: normalized.controls,
    skills: normalized.skills.map((entry) => ({
      skill: entry.skill,
      tasks: entry.tasks,
      coverage: entry.coverage && entry.coverage.A,
      by_batch: entry.by_batch && entry.by_batch.A,
      not_counted:
        entry.not_counted &&
        entry.not_counted.A.map(({ batch, task_id: id }) => [batch, id]),
    })),
  };
}

/** The names `report` was run with, rebuilt from the stored report: its skills, then the controls it includes. */
function selectionOf(report) {
  return [
    ...report.skills.map((entry) => entry.skill),
    ...(report.controls[CONVENTION_CONTROL] ? [CONVENTION_CONTROL] : []),
    ...(report.controls[LADDER_REPORT_KEY] ? [DOSE_LADDER] : []),
  ];
}

/**
 * The stored report of the run, checked and re-read from the judgments on disk. Throws UsageError for each refusal in
 * the module comment. Returns { report, fresh, outcomeJobs } where `fresh` is the report the judgments give now.
 */
function readTrustedRun({ layout, config, collect, now }) {
  let stored;
  try {
    stored = readJsonFile(layout.reportJson);
  } catch (error) {
    if (error && error.code === 'ENOENT')
      throw new UsageError(
        `run "${layout.runId}" has no report (${layout.reportJson}); run \`report\` for it first`,
      );
    if (error && error.name === 'JsonFileError')
      throw new UsageError(`the report cannot be read: ${error.message}`);
    throw error;
  }
  if (
    stored === null ||
    typeof stored !== 'object' ||
    !Array.isArray(stored.skills) ||
    stored.controls === null ||
    typeof stored.controls !== 'object'
  )
    throw new UsageError(
      `${layout.reportJson} is not a report of this benchmark; run \`report\` for the run again`,
    );
  let storedFingerprint;
  try {
    storedFingerprint = fingerprint(stored);
  } catch {
    throw new UsageError(
      `${layout.reportJson} is not a report of this benchmark; run \`report\` for the run again`,
    );
  }
  if (stored.provider !== 'live')
    throw new UsageError(
      `the report of run "${layout.runId}" is not from a live run (provider: ${stored.provider ?? 'missing'}), so it is not a measurement; only a live run can trim the baselines`,
    );
  if (stored.controls_status !== 'PASS')
    throw new UsageError(
      `run "${layout.runId}" is not trusted (controls_status is ${stored.controls_status}, not PASS); a run whose controls did not pass cannot say which tasks are easy`,
    );
  const read = collect({
    layout,
    config,
    skills: selectionOf(stored),
    provider: stored.provider,
    now,
  });
  if (!isDeepStrictEqual(storedFingerprint, fingerprint(read.report))) {
    // A trim leaves the baselines with fewer tasks than the report counted, which is the usual reason for this refusal.
    const trimmed = stored.skills
      .filter((entry) => {
        const now = read.report.skills.find(
          (candidate) => candidate.skill === entry.skill,
        );
        return now && now.tasks < entry.tasks;
      })
      .map((entry) => entry.skill);
    throw new UsageError(
      trimmed.length
        ? `the report of run "${layout.runId}" is stale: the baselines of ${trimmed.join(', ')} have fewer tasks than it counted, so this run was trimmed already and a second trim of it would find nothing new; run \`report\` for the run again to see its readings on the trimmed baselines`
        : `the report of run "${layout.runId}" is stale: the judgments and baselines on disk no longer give its readings; run \`report\` for the run again`,
    );
  }
  return { report: stored, fresh: read.report, outcomeJobs: read.outcomeJobs };
}

/** The skills to trim: `requested` or, without it, every skill of the report. Each must be one the report measured. */
function chooseSkills(report, requested) {
  const measured = report.skills.map((entry) => entry.skill);
  if (!requested) return measured;
  const controls = requested.filter((name) => CONTROL_NAMES.includes(name));
  if (controls.length)
    throw new UsageError(
      `--skills: ${controls.join(', ')} ${controls.length === 1 ? 'is a control' : 'are controls'}, and controls are never trimmed`,
    );
  const unknown = requested.filter((name) => !measured.includes(name));
  if (unknown.length)
    throw new UsageError(
      `--skills: not measured in this run's report: ${unknown.join(', ')}. The report has ${measured.join(', ')}`,
    );
  return requested;
}

/** Refuses a skill whose reading A counts too few tasks to read means from (labels.js minCounted, 12 of every 16). */
function requireCoverage(fresh, skills) {
  const short = [];
  for (const skill of skills) {
    const entry = fresh.skills.find((candidate) => candidate.skill === skill);
    if (!entry || !entry.coverage) {
      short.push(`${skill} could not be read`);
      continue;
    }
    const need = minCounted(entry.tasks);
    if (entry.coverage.A.tasks_counted < need)
      short.push(
        `${skill} counts ${entry.coverage.A.tasks_counted} of ${entry.tasks} tasks in reading A, below ${need} (12 of every 16)`,
      );
  }
  if (short.length)
    throw new UsageError(
      `reading A covers too few tasks to trim: ${short.join('; ')}`,
    );
}

/** The rules that have a checklist item in the tasks `taskIds` of one batch, as a Set of rule ids. */
function rulesWithItems(buckets, taskIds) {
  const found = new Set();
  for (const id of taskIds)
    for (const item of Object.values(buckets.scenarios[id]))
      found.add(item.rule_id);
  return found;
}

/** The rule ids in `before` that are not in `after`. */
const emptiedRules = (before, after) =>
  [...before].filter((id) => !after.has(id));

/**
 * Every change the trim makes, without writing anything:
 * { summary: { <skill>: { <batch>: { kept, [kept_ids], dropped, restored, [rules_emptied] } } },
 *   files: [{ file, text, before }] }.
 * `files` holds only the task and bucket files that change, already checked against their formats; `before` is the
 * text the plan was made from, which applyChanges compares with the file just before it replaces it. `kept_ids` is
 * there with `listKept`. `rules_emptied` lists the rules whose last item in the batch leaves with the dropped
 * tasks. Throws UsageError when a rule would have no item left in any batch of its skill.
 */
function planTrim({
  layout,
  fresh,
  skills,
  outcomeJobs,
  threshold,
  minPerBatch,
  listKept = false,
}) {
  const summary = {};
  const files = [];
  for (const skill of skills) {
    const gaps = taskGaps(outcomeJobs[skill] || []);
    // The report counts tasks through readSkill and this module through taskGaps; they must agree, or the means
    // below would come from other tasks than the coverage that was checked.
    const reported = fresh.skills.find((entry) => entry.skill === skill);
    const counted = gaps.filter((row) => row.counted).length;
    if (counted !== reported.coverage.A.tasks_counted)
      throw new Error(
        `${skill}: the report counts ${reported.coverage.A.tasks_counted} reading A tasks but the judgments give ${counted}`,
      );
    const rows = new Map(
      gaps.map((row) => [`${row.batch}\u0000${row.task_id}`, row]),
    );
    const rules = readJsonFile(layout.rulesFile(skill));
    summary[skill] = {};
    const rulesBefore = new Set();
    const rulesAfter = new Set();
    for (const batch of layout.batches(skill)) {
      const tasksFile = layout.tasksFile(skill, batch);
      const tasksSource = readFile(tasksFile, 'utf8');
      const tasks = parseJson(tasksSource, tasksFile);
      const entries = tasks.scenarios.map((scenario) => {
        const row = rows.get(`${batch}\u0000${scenario.id}`);
        const counted = Boolean(row && row.counted);
        return {
          id: scenario.id,
          mean: counted ? row.without_mean : null,
          withMean: counted ? row.with_mean : null,
        };
      });
      const decision = decideBatch(entries, { threshold, minPerBatch });
      const keep = new Set(decision.kept);
      const bucketsFile = layout.bucketsFile(skill, batch);
      const bucketsSource = readFile(bucketsFile, 'utf8');
      const buckets = parseJson(bucketsSource, bucketsFile);
      const before = rulesWithItems(buckets, Object.keys(buckets.scenarios));
      const after = rulesWithItems(
        buckets,
        Object.keys(buckets.scenarios).filter((id) => keep.has(id)),
      );
      before.forEach((id) => rulesBefore.add(id));
      after.forEach((id) => rulesAfter.add(id));
      const emptied = emptiedRules(before, after);
      summary[skill][batch] = {
        kept: decision.kept.length,
        ...(listKept ? { kept_ids: decision.kept } : {}),
        dropped: decision.dropped,
        restored: decision.restored,
        ...(emptied.length ? { rules_emptied: emptied } : {}),
      };
      if (!decision.dropped.length) continue;
      const nextTasks = {
        ...tasks,
        scenarios: tasks.scenarios.filter((scenario) => keep.has(scenario.id)),
      };
      const nextBuckets = {
        ...buckets,
        scenarios: Object.fromEntries(
          Object.entries(buckets.scenarios).filter(([id]) => keep.has(id)),
        ),
      };
      const problems = [
        ...validateTasks(nextTasks, { skill, batch, rules }).errors,
        ...validateBuckets(nextBuckets, { rules, tasks: nextTasks }).errors,
      ];
      if (problems.length)
        throw new Error(
          `the trimmed ${skill} ${batch} would not be a valid baseline: ${problems[0]}`,
        );
      files.push(
        {
          file: tasksFile,
          text: `${JSON.stringify(nextTasks, null, 2)}\n`,
          before: tasksSource,
        },
        {
          file: bucketsFile,
          text: `${JSON.stringify(nextBuckets, null, 2)}\n`,
          before: bucketsSource,
        },
      );
    }
    // Reading B pools the batches of a skill, so a rule needs an item in one of them.
    const lost = emptiedRules(rulesBefore, rulesAfter);
    if (lost.length)
      throw new UsageError(
        `trimming ${skill} would leave ${lost.join(', ')} without a checklist item in any batch, so reading B could not read ${lost.length === 1 ? 'that rule' : 'those rules'}; raise --threshold or leave ${skill} out of --skills`,
      );
  }
  return { summary, files };
}

/**
 * Writes `files` ([{ file, text }]) as a set: each text goes to a temporary file beside its target (with the target's
 * file mode, which a baseline keeps under version control) and only then are all renamed into place, so a full disk
 * or a folder that cannot be written leaves every file as it was. A system error carries `writing` so the driver says
 * "cannot write".
 */
function writeFiles(files) {
  const temporaries = [];
  let target = null;
  try {
    for (const { file, text } of files) {
      target = file;
      const mode = fs.statSync(file).mode & 0o777;
      const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      temporaries.push(temporary);
      fs.writeFileSync(temporary, text, { mode, flag: 'wx' });
      fs.chmodSync(temporary, mode);
    }
    files.forEach(({ file }, index) => {
      target = file;
      fs.renameSync(temporaries[index], file);
    });
  } catch (error) {
    for (const temporary of temporaries) fs.rmSync(temporary, { force: true });
    if (
      error instanceof Error &&
      typeof error.code === 'string' &&
      typeof error.syscall === 'string'
    ) {
      error.writing = true;
      error.path = target;
    }
    throw error;
  }
}

/**
 * Replaces the task and bucket files and then the manifest.
 *
 * First each file is compared with the text the plan was made from (`before` of a file entry, `manifestBefore` for the
 * manifest). A file that differs was edited after the plan, and replacing it would lose that edit, so nothing is
 * written and UsageError says which files changed. The check narrows the window to the time between the comparison
 * and the renames; it is not a lock.
 *
 * Renames cannot be made one transaction, so when any step fails each file is written back from its old text, one at
 * a time, so one that cannot be restored does not keep the others from it. The error thrown is the first failure; its
 * `hint` names the files that could not be put back, which `git checkout -- bench/baselines` repairs, and the driver
 * prints it after its own line (describeFailure). That keeps a task file from staying trimmed while its bucket file
 * or the manifest still has the old tasks.
 * `writeSet` is writeFiles (tests replace it).
 */
function applyChanges({
  layout,
  files,
  manifestBefore,
  writeManifestFile,
  writeSet = writeFiles,
}) {
  const originals = [
    ...files.map(({ file, before }) => ({ file, text: before })),
    { file: layout.manifestFile, text: manifestBefore },
  ];
  const changed = originals
    .filter(({ file, text }) => fs.readFileSync(file, 'utf8') !== text)
    .map(({ file }) => file);
  if (changed.length)
    throw new UsageError(
      `${changed.join(', ')} changed after the trim was planned, so nothing was written; run trim again`,
    );
  try {
    writeSet(files);
    writeManifestFile(layout);
  } catch (error) {
    const notRestored = [];
    for (const original of originals) {
      try {
        writeSet([original]);
      } catch {
        notRestored.push(original.file);
      }
    }
    // A hint and not a longer message: the driver prints a system error from its code and path alone.
    if (notRestored.length && error instanceof Error)
      error.hint = `these files could not be put back and may be half trimmed: ${notRestored.join(', ')}; run git checkout -- bench/baselines`;
    throw error;
  }
}

/**
 * Runs the command. Options:
 *   layout, config   the layout of the run and the settings (as `report` takes them)
 *   skills           the skills to trim (default: every skill of the run's report)
 *   threshold, minPerBatch, dryRun
 *   listKept         add `kept_ids` (the ids of the tasks that stay) to each batch of the printed line
 *   collect, now, writeManifestFile   run-report.js collectReport, the clock and baseline-manifest.js writeManifest
 *                    (tests replace them)
 * Returns { ok, problems, result }: `result` is the line to print, and `problems` the baseline problems found before
 * or after the write (ok is false then, and `result` is null when they were found before). Throws UsageError for a
 * refusal.
 */
function runTrim({
  layout,
  config,
  skills,
  threshold = DEFAULT_THRESHOLD,
  minPerBatch = DEFAULT_MIN_PER_BATCH,
  dryRun = false,
  listKept = false,
  collect = collectReport,
  now = Date.now,
  writeManifestFile = writeManifest,
}) {
  const { report, fresh, outcomeJobs } = readTrustedRun({
    layout,
    config,
    collect,
    now,
  });
  const chosen = chooseSkills(report, skills);
  requireCoverage(fresh, chosen);
  const before = verifyBaselines(layout);
  if (before.problems.length)
    return {
      ok: false,
      problems: before.problems.map((problem) => `before the trim, ${problem}`),
      result: null,
    };
  const manifestBefore = readFile(layout.manifestFile, 'utf8');
  const { summary, files } = planTrim({
    layout,
    fresh,
    skills: chosen,
    outcomeJobs,
    threshold,
    minPerBatch,
    listKept,
  });
  const result = {
    trim: dryRun ? 'dry-run' : 'done',
    run_id: layout.runId,
    threshold,
    min_per_batch: minPerBatch,
    skills: summary,
    manifest: dryRun ? 'not written' : 'unchanged',
  };
  if (dryRun || !files.length) return { ok: true, problems: [], result };
  applyChanges({ layout, files, manifestBefore, writeManifestFile });
  const after = verifyBaselines(layout);
  result.manifest = 'refreshed';
  return { ok: after.problems.length === 0, problems: after.problems, result };
}

module.exports = {
  DEFAULT_THRESHOLD,
  DEFAULT_MIN_PER_BATCH,
  parseThreshold,
  parseMinPerBatch,
  decideBatch,
  chooseSkills,
  fingerprint,
  runTrim,
  applyChanges,
  writeFiles,
};
