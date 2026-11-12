// SPDX-License-Identifier: Apache-2.0
/**
 * The pairs job: the subject runs of the selected skills, with and without the skill, for every task that has no
 * current answer. PAID: each run is one Claude Code call on Bedrock (claude-run.js).
 *
 * Order of work:
 *   1. `plan` for the same skills (plan.js) must pass: an invalid baseline or agent spec, a projected cost above
 *      max_usd, or a ledger past total_cap_usd refuses the job before anything is built or spent. Only
 *      skills that `plan` plans (ready, rules stale, tasks stale) are run; the others are listed as skipped.
 *      `plan` counts an answer as done when its file exists, so once the tasks are assembled the job adds the runs
 *      of answers that exist but are out of date (a skill edit, another model or profile) and checks the limits
 *      again with them (staleRerunRefusals).
 *   2. The tasks of each skill are assembled (tasks.js) with its arms kept on disk for the runs.
 *   3. A subject job is pending when its answer file is missing or not current: a different input digest, or a
 *      text that does not match its own hash. A pending answer file is renamed `<file>.superseded-<time>` and kept;
 *      it is never read again and never reused.
 *   4. The first pending run goes alone. If it is invalid for a reason other than the skill not loading, the job
 *      stops before any other run starts: stop kind `model` when a model other than the pinned subject model answered
 *      it, stop kind `setup` for any other problem (the message names it). The rest run with at most
 *      `subject_concurrency` at once.
 *   5. Each run is runSubjectTask (up to 3 tries; an invalid try's log is kept as `.rejected-<time>`).
 *        ok          the answer record is written with status `ok`
 *        not_loaded  every try was invalid because the `with` arm never loaded the skill, and for no other reason:
 *                    the record is written with status `not_loaded` and no text, so the task is reported as not
 *                    loaded and is not tried again until its inputs change.
 *        failed      nothing is written; the task stays pending and the next run tries it again. An invalid run is
 *                    also stored this way when any try had another problem (a result with no model, a model other
 *                    than the subject, tools beyond the grant, a tool outside the grant that ran, the `without`
 *                    arm loading the skill): those are faults of the setup, not of the skill.
 *
 * Stops. A credential problem (missing, long-term or expiring within the call timeout: aws-credentials.js), a spend stop
 * from the ledger, a ledger that cannot be used, and a security stop from the secret sweep end the job: no new run
 * starts, runs already going finish, and finished answers are kept. The result says which stop and why.
 *
 * Every answer and run folder is under bench/out/<run-id>/ (layout.js). Folders are mode 0700 and files 0600.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const proc = require('./proc');
const { removeArms } = require('./arms');
const { CredentialError } = require('./aws-credentials');
const {
  NEVER_LOADED_PROBLEM,
  RAW_LOG,
  SecurityStopError,
  modelUsageOk,
  runSubjectTask,
} = require('./claude-run');
const { estimatedCallsLine, planJobs, trackEstimatedCalls } = require('./jobs');
const {
  checkLimits,
  createLedger,
  LedgerError,
  readLedger,
  SpendStopError,
} = require('./ledger');
const { callCost } = require('./cost-profile');
const { buildPlan } = require('./plan');
const { fileSha256, sha256 } = require('./provenance');
const { readJsonFile } = require('./read-file');
const { redact } = require('./redact');
const { pool } = require('./pool');
const { SUPERSEDED_MARK, supersede } = require('./supersede');
const { ANSWER_KIND, loadTaskSet, subjectRequest } = require('./tasks');

const STATUS_OK = 'ok';
const STATUS_NOT_LOADED = 'not_loaded';
/**
 * The statuses `plan` counts calls for (plan.js keeps its own copy of the list); the pairs job runs the same skills.
 * Exported, so that a job for the same skills uses this one set.
 */
const RUNNABLE_STATUSES = new Set(['ready', 'rules stale', 'tasks stale']);
const GIT_TIMEOUT_MS = 10000;
const COMMIT = /^[0-9a-f]{40,64}$/;
const STOP_MESSAGE_CHARS = 400;
/**
 * The start of what claude-run.js runProblems says when a model other than the subject produced output. A first run
 * with this reason is a model stop; any other reason that is not the skill is a setup stop (tests pin it to
 * runProblems).
 */
const WRONG_MODEL_PROBLEM = 'a model other than the subject produced output';

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * True when `file` holds an answer made from `inputs` (tasks.js answerInputs): same digest, and either a text that
 * matches its own hash (status ok) or a not-loaded record. Anything else, including a file that is not JSON or not an
 * answer record, is not current.
 */
function answerCurrent(file, inputs) {
  let record;
  try {
    record = readJsonFile(file);
  } catch (unreadable) {
    return false;
  }
  if (
    !isPlainObject(record) ||
    record.kind !== ANSWER_KIND ||
    !isPlainObject(record.inputs) ||
    !inputs ||
    record.inputs.input_sha256 !== inputs.input_sha256
  )
    return false;
  if (record.status === STATUS_NOT_LOADED) return true;
  return (
    record.status === STATUS_OK &&
    typeof record.text === 'string' &&
    sha256(record.text) === record.answer_sha256
  );
}

/** The subject jobs whose answer file is not current. */
const pendingSubjectJobs = (layout, subjectJobs) =>
  subjectJobs.filter(
    (job) =>
      !answerCurrent(
        layout.answerFile(job.skill, job.batch, job.task.id, job.arm),
        job.task.inputs[job.arm],
      ),
  );

/** Two amounts to cents, or with the decimals it takes to tell them apart when cents would show them as equal. */
function moneyPair(first, second) {
  const cents = [first, second].map((amount) => amount.toFixed(2));
  return cents[0] === cents[1] ? [first.toFixed(4), second.toFixed(4)] : cents;
}

/**
 * The cost `plan` leaves out, and the refusals it causes. `plan` counts a subject run as done when its answer file
 * exists, but a file whose input digest no longer matches (answerCurrent) is run again, so after a skill edit, or
 * another model or runner profile, `plan` prices none of those runs. `stale` is the pending jobs whose file exists.
 * Their upper estimate (p90 of a subject call) is added to the plan's own figure and both limits are checked as
 * `plan` checks them: max_usd against this run's spend and reservations, total_cap_usd against the whole ledger.
 * Returns the refusal texts, none when `stale` is empty or the limits hold.
 */
function staleRerunRefusals({ layout, config, plan, stale }) {
  if (!stale.length) return [];
  const extraUsd =
    stale.length * callCost(config, 'subject', config.models.subject).p90;
  const callUsd = plan.pending_usd_p90_unrounded + extraUsd;
  // The plan that passed has just read this ledger, so a ledger that cannot be read here is not a refusal but a fault.
  const ledger = readLedger(layout.ledgerFile);
  const run = ledger.runs.get(layout.runId) || { spent: 0, reserved: 0 };
  const runUsd = run.spent + run.reserved;
  const what = `${stale.length} stored answer(s) are out of date and will be run again, and plan counts them as done; adding their upper estimate (p90) of $${extraUsd.toFixed(2)} to the plan's figure`;
  const refusals = [];
  const maxHit = checkLimits(
    { ...config, total_cap_usd: Infinity },
    { runUsd, totalUsd: 0, callUsd },
  );
  if (maxHit) {
    const [projected, limit] = moneyPair(maxHit.projected_usd, config.max_usd);
    refusals.push(
      `${what}, this run would reach $${projected} (it has spent or reserved $${runUsd.toFixed(2)} already), above max_usd $${limit}; raise max_usd (it cannot pass total_cap_usd $${config.total_cap_usd.toFixed(2)}), or select fewer skills`,
    );
  }
  const capHit = checkLimits(
    { ...config, max_usd: Infinity },
    { runUsd: 0, totalUsd: ledger.total + ledger.reserved, callUsd },
  );
  if (capHit) {
    const [projected, limit] = moneyPair(
      capHit.projected_usd,
      capHit.limit_usd,
    );
    refusals.push(
      `${what}, the ledger would reach $${projected} (it holds $${ledger.total.toFixed(2)} spent and $${ledger.reserved.toFixed(2)} reserved), above ${capHit.limit} $${limit}; raise total_cap_usd in bench/config.json, or move the ledger file aside to start a new count`,
    );
  }
  return refusals;
}

/**
 * The commit of the last change under skills/ (`git log -1 -- skills`), or null when the root is not a git checkout
 * or git cannot say. Recorded on each answer, never part of a digest.
 */
async function readSkillsVersion(root, { run = proc.run } = {}) {
  const result = await run(
    'git',
    ['-C', root, 'log', '-1', '--format=%H', '--', 'skills'],
    { timeoutMs: GIT_TIMEOUT_MS },
  );
  const commit = result.code === 0 ? String(result.stdout).trim() : '';
  return COMMIT.test(commit) ? commit : null;
}

/** Writes `record` as JSON to `file` through a temporary file in the same folder (mode 0600, folders 0700). */
function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * The stored answer of one task and arm. `outcome` is runSubjectTask's result. A not-loaded record keeps no text:
 * a try that was invalid is never judged, and its logs are kept as `.rejected-<time>` files in the run folder.
 */
function answerRecord({
  job,
  taskSet,
  runner,
  config,
  outcome,
  runDir,
  skillsVersion,
}) {
  const { result } = outcome;
  const withArm = job.arm === 'with';
  const isOk = outcome.status === STATUS_OK;
  const rawFile = path.join(runDir, RAW_LOG);
  const text = isOk ? result.text : null;
  return {
    kind: ANSWER_KIND,
    skill: job.skill,
    batch: job.batch,
    task_id: job.task.id,
    arm: job.arm,
    status: outcome.status,
    valid: isOk,
    condition: taskSet.condition.condition,
    load_mode: runner.loadMode,
    runner: runner.info,
    arm_blinding_version: taskSet.condition.arm_blinding_version,
    agent: taskSet.agent,
    skill_present: withArm,
    load_instruction: withArm && runner.explicitInstruction,
    inputs: job.task.inputs[job.arm],
    answer_sha256: text === null ? null : sha256(text),
    raw_sha256: isOk && fs.existsSync(rawFile) ? fileSha256(rawFile) : null,
    text,
    problems: result.problems,
    tries: outcome.tries,
    ms: result.ms,
    expected_model: config.models.subject,
    models_used: result.modelsUsed,
    model_ok: modelUsageOk(result.modelsUsed, config.models.subject),
    tools_reported: result.tools,
    skill_load: result.skillLoad,
    usage: result.usage,
    est_usd: callCost(config, 'subject', config.models.subject).mean,
    reported_usd: result.reportedUsd,
    tool_call_count: result.trace.tool_calls.length,
    tool_errors: result.toolErrors,
    permission_denials: result.permissionDenials,
    sweep_warning: result.sweepWarning,
    error: result.error,
    skills_version: skillsVersion,
    claude_code_version: result.trace.cli_version ?? null,
  };
}

/** A stop of `kind`: the message is redacted and cut, because it goes to the caller and the log. */
const stopOf = (kind, text) => ({
  kind,
  message: redact(String(text), { maxChars: STOP_MESSAGE_CHARS }),
});

/**
 * The reasons a run was invalid that are about the setup and not the skill: the problems of every try that ended
 * with an answer but was invalid, once each, leaving out that the `with` arm never loaded the skill. A run that is
 * `ok` has none. A try that failed outright is not read: its problems only say that no result came.
 */
function setupProblemsOf(outcome) {
  if (outcome.status === STATUS_OK) return [];
  const problems = new Set();
  for (const attempt of outcome.tries)
    if (attempt.ok && !attempt.valid)
      for (const problem of attempt.problems)
        if (problem !== NEVER_LOADED_PROBLEM) problems.add(problem);
  return [...problems];
}

/** True for the reason `runProblems` gives when a model other than the subject produced output in a try. */
const isWrongModelProblem = (problem) =>
  problem.startsWith(WRONG_MODEL_PROBLEM);

/**
 * The stop a thrown error means, or null for an error that is not a stop (a bug, which is thrown on). An error that
 * carries `traceQuarantine` (claude-run.js sets it when the raw log was quarantined for a value in the trace's text)
 * is a security stop whatever its own kind, a ledger failure for one: the message is the quarantine note, which names
 * the copy, then the error's own message.
 */
function stopFor(error) {
  const message = String(error && error.message);
  const quarantine = error && error.traceQuarantine;
  if (isPlainObject(quarantine))
    return stopOf(
      'security',
      `${typeof quarantine.note === 'string' && quarantine.note ? quarantine.note : 'SECURITY STOP: a raw log was quarantined for a value the run knows is secret.'} The run also ended with: ${message}`,
    );
  if (error instanceof CredentialError) return stopOf('credentials', message);
  if (error instanceof SpendStopError) return stopOf('spend', message);
  if (error instanceof SecurityStopError) return stopOf('security', message);
  if (error instanceof LedgerError) return stopOf('ledger', message);
  return null;
}

const jobLabel = (job) => `${job.skill}/${job.batch}/${job.task.id}:${job.arm}`;

/**
 * Runs the pairs job. Options:
 *   layout, config   createLayout(...) and loadConfig(...)
 *   skills           the selected skill names (already checked to exist)
 *   dryRun           list the pending runs and stop; nothing is spent or written under bench/out. The arms are built in a
 *                    temporary folder to read their manifests, and removed.
 *   log              (line) => void, one line per event (default: nothing)
 *   skillsVersion    recorded on each answer; default readSkillsVersion(layout.root)
 *   subject          extra options passed to every runSubjectTask call (for tests: run, bin, getCredentials, tmpRoot,
 *                    userHome, baseEnv, now, sleep, retryBaseMs, maxTries, timeoutMs)
 *   runTask          the per-task runner (default runSubjectTask), and armsTmpRoot where the arms are built
 *
 * Returns { status, refused, stop, skipped, jobs, pending, results, warnings, estimated } where status is
 *   refused   `plan` refused the skills (refused lists why); nothing was built or spent
 *   dry-run   the pending runs were listed
 *   done      every pending run gave a valid answer
 *   partial   at least one run failed or was not loaded; the rest are kept
 *   stopped   a stop ended the job (`stop`: { kind, message }, kind one of model, setup, credentials, spend, ledger,
 *             security)
 * and results is [{ skill, batch, task_id, arm, status }] with status ok, not_loaded, failed or skipped. `estimated`
 * (once runs were made) is null, or { calls, models } for the calls charged at their mean because Claude Code
 * reported no usable cost.
 */
async function runPairs({
  layout,
  config,
  skills,
  dryRun = false,
  log = () => {},
  skillsVersion,
  subject = {},
  runTask = runSubjectTask,
  armsTmpRoot,
}) {
  // A skill named twice would plan and run every one of its tasks twice.
  const plan = buildPlan({ layout, config, skills: [...new Set(skills)] });
  const summary = {
    status: 'refused',
    refused: plan.refused,
    stop: null,
    skipped: [],
    jobs: 0,
    pending: 0,
    results: [],
    warnings: [...plan.warnings],
  };
  if (!plan.ok) return summary;
  summary.refused = [];
  const runnable = plan.skills.filter((row) => {
    if (RUNNABLE_STATUSES.has(row.status)) return true;
    summary.skipped.push({ skill: row.skill, status: row.status });
    return false;
  });

  const loaded = [];
  try {
    for (const { skill } of runnable)
      loaded.push(
        loadTaskSet({
          layout,
          config,
          skill,
          keepArms: !dryRun,
          ...(armsTmpRoot ? { tmpRoot: armsTmpRoot } : {}),
        }),
      );
    const bySkill = new Map(
      loaded.map((entry) => [entry.taskSet.skill, entry]),
    );
    for (const { taskSet } of loaded)
      summary.warnings.push(
        ...taskSet.warnings.map((warning) => `${taskSet.skill}: ${warning}`),
      );
    const { subject: subjectJobs } = planJobs(
      loaded.map((entry) => entry.taskSet),
      config,
    );
    const pending = pendingSubjectJobs(layout, subjectJobs);
    summary.jobs = subjectJobs.length;
    summary.pending = pending.length;
    log(
      `pairs: skills ${runnable.map((row) => row.skill).join(', ') || 'none'}; subject runs ${subjectJobs.length - pending.length}/${subjectJobs.length} current, ${pending.length} to run; plan projects $${plan.pending_usd.toFixed(2)} (mean) and $${plan.pending_usd_p90.toFixed(2)} (p90, checked against the limits) for every pending call of these skills`,
    );
    // Answers that exist but are out of date: plan counted them as done, so their runs are priced here.
    const stale = pending.filter((job) =>
      fs.existsSync(
        layout.answerFile(job.skill, job.batch, job.task.id, job.arm),
      ),
    );
    if (stale.length)
      log(
        `pairs: ${stale.length} of the ${pending.length} runs replace an answer that is out of date; plan counts those as done, so their cost is added for the limits`,
      );
    const staleRefusals = staleRerunRefusals({ layout, config, plan, stale });
    if (staleRefusals.length) {
      summary.refused = staleRefusals;
      return summary;
    }
    for (const { skill, status } of summary.skipped)
      log(`  skipped ${skill} (${status})`);
    if (dryRun) {
      for (const job of pending) {
        const { runner, taskSet } = bySkill.get(job.skill);
        log(
          `  would run ${jobLabel(job)} (agent ${taskSet.agent}, load instruction ${job.arm === 'with' && runner.explicitInstruction ? 'yes' : 'no'}, tools ${runner.tools.join('+')})`,
        );
      }
      summary.status = 'dry-run';
      return summary;
    }
    if (!pending.length) {
      summary.status = 'done';
      return summary;
    }

    const tracker = trackEstimatedCalls(
      createLedger({
        file: layout.ledgerFile,
        limits: {
          max_usd: config.max_usd,
          total_cap_usd: config.total_cap_usd,
        },
        runId: layout.runId,
      }),
    );
    const { ledger } = tracker;
    const version =
      skillsVersion === undefined
        ? await readSkillsVersion(layout.root)
        : skillsVersion;
    const now = subject.now || Date.now;

    const runOne = async (job) => {
      const entry = {
        skill: job.skill,
        batch: job.batch,
        task_id: job.task.id,
        arm: job.arm,
        status: 'skipped',
      };
      summary.results.push(entry);
      if (summary.stop) return entry;
      const { runner, taskSet, arms } = bySkill.get(job.skill);
      const answerFile = layout.answerFile(
        job.skill,
        job.batch,
        job.task.id,
        job.arm,
      );
      const runDir = layout.subjectRunDir(
        job.skill,
        job.batch,
        job.task.id,
        job.arm,
      );
      const setAside = supersede(answerFile, now);
      if (setAside)
        log(
          `  ${jobLabel(job)}: stale answer kept as ${path.basename(setAside)}`,
        );
      fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
      let outcome;
      try {
        outcome = await runTask({
          ...subject,
          ledger,
          config,
          arms,
          arm: job.arm,
          skill: job.skill,
          runner,
          prompt: subjectRequest(job.task),
          label: jobLabel(job),
          runDir,
        });
      } catch (error) {
        const stop = stopFor(error);
        if (!stop) throw error;
        summary.stop = summary.stop || stop;
        entry.status = 'failed';
        log(`  ${jobLabel(job)}: STOP (${stop.kind}) ${stop.message}`);
        return entry;
      }
      entry.status = outcome.status;
      const { result } = outcome;
      const modelsUsed = Array.isArray(result.modelsUsed)
        ? result.modelsUsed
        : [];
      // Only a model that did answer and is not the subject is a wrong model; a result that names no model is a
      // setup problem of its own kind.
      if (modelsUsed.length && !modelUsageOk(modelsUsed, config.models.subject))
        entry.wrongModel = modelsUsed;
      // Not loaded is a fact about the skill, and the report gives the skill NO DATA for it, so it is stored only
      // when that is the sole problem of every try. Any other invalid run is a fault of the setup: nothing is stored
      // and the task stays pending, to be answered again once the setup is right.
      const setupProblems = setupProblemsOf(outcome);
      if (setupProblems.length) {
        entry.setupProblems = setupProblems;
        if (outcome.status === STATUS_NOT_LOADED) entry.status = 'failed';
      }
      if (entry.status !== 'failed')
        writeRecord(
          answerFile,
          answerRecord({
            job,
            taskSet,
            runner,
            config,
            outcome,
            runDir,
            skillsVersion: version,
          }),
        );
      log(
        `  ${jobLabel(job)} ${entry.status} loaded=${result.skillLoad.loaded} model_ok=${modelUsageOk(result.modelsUsed, config.models.subject)} tries=${outcome.tries.length}${result.error ? ` error: ${result.error}` : ''}`,
      );
      return entry;
    };

    // The first run goes alone: a wrong model or a credential problem shows here, before anything runs in parallel.
    const [first, ...rest] = pending;
    const firstEntry = await runOne(first);
    if (!summary.stop && (firstEntry.wrongModel || firstEntry.setupProblems))
      summary.stop = stopOf(
        firstEntry.wrongModel ||
          firstEntry.setupProblems.some(isWrongModelProblem)
          ? 'model'
          : 'setup',
        firstEntry.wrongModel
          ? `the first run was answered by ${JSON.stringify(firstEntry.wrongModel)}, not ${config.models.subject}`
          : `the first run was invalid for a reason that is not the skill: ${firstEntry.setupProblems.join('; ')}`,
      );
    if (summary.stop) {
      for (const job of rest)
        summary.results.push({
          skill: job.skill,
          batch: job.batch,
          task_id: job.task.id,
          arm: job.arm,
          status: 'skipped',
        });
    } else {
      // A stop is caught inside runOne, so only a bug reaches the pool as an error; it is thrown on after the
      // runs already going have finished.
      const outcomes = await pool(rest, config.subject_concurrency, runOne);
      const bug = outcomes.find((item) => item.error);
      if (bug) throw bug.error;
    }
    for (const entry of summary.results) {
      delete entry.wrongModel;
      delete entry.setupProblems;
    }
    summary.estimated = tracker.estimated();
    if (summary.estimated)
      log(`pairs: ${estimatedCallsLine(summary.estimated)}`);
    summary.status = summary.stop
      ? 'stopped'
      : summary.results.every((entry) => entry.status === 'ok')
        ? 'done'
        : 'partial';
    return summary;
  } finally {
    for (const entry of loaded) if (entry.arms) removeArms(entry.arms);
  }
}

module.exports = {
  SUPERSEDED_MARK,
  STATUS_OK,
  STATUS_NOT_LOADED,
  RUNNABLE_STATUSES,
  WRONG_MODEL_PROBLEM,
  supersede,
  answerCurrent,
  pendingSubjectJobs,
  setupProblemsOf,
  readSkillsVersion,
  writeRecord,
  answerRecord,
  moneyPair,
  runPairs,
};
