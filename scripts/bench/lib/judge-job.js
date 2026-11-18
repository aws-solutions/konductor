// SPDX-License-Identifier: Apache-2.0
/**
 * The judge job: one reading (scale `items`, reading B, or `outcome`, reading A) of the selected skills. Each judge
 * seat scores each stored answer on its own against a checklist, and the result is one judgment file per task, seat
 * and arm (layout.judgmentFile). A judge call sees one answer and is never told its arm or that another answer exists.
 * PAID: every judgment is one judge call through OpenCode on Bedrock (opencode.js judgeCall), booked in the ledger.
 *
 * Order of work:
 *   1. `plan` for the same skills (plan.js) must pass, as for the pairs job. Only skills `plan` plans are judged; the
 *      others are listed as skipped. Reading B waits for a refreshed baseline when the rules or the batch are stale
 *      (tasks.js read_b), so such a batch has no `items` work; reading A needs only the tasks. A dose ladder item
 *      (--ladder) is not given to `plan`: the ladder must pass its audit, and its items are read by A only, with the
 *      ladder's authored answers (dose-ladder.js judgingSets) and their request-only checklists.
 *   2. The judge jobs are the ones job planning lists for the scale (jobs.js planJobs): every task, seat and arm. A
 *      task a person has excluded from reading A (bench/exclusions.json) has no `outcome` job and is listed with its
 *      reason.
 *   3. The checklist the judge is shown: on `items` the task's rules checklist, with one bucket per item from the
 *      bucket sidecar; on `outcome` the request-only checklist (scale-view.js). A task with no current request-only
 *      checklist waits for it and is never judged against another one.
 *   4. The job's answer must be current (pairs.js answerCurrent with today's answer inputs). A missing or stale answer
 *      makes the judgment wait for the pairs job. An answer stored as `not_loaded` is an invalid task for its arm: it
 *      is never judged and the task does not count in either reading.
 *   5. The answer goes through the judge-input step (judge-input.js): sanitize, redact, cap, leak scan. An answer
 *      that is not eligible is never sent to a judge. The job writes an `ineligible` judgment record for that arm
 *      that says why, with no call and no cost, so the task does not count in either reading, and a rerun does not
 *      ask again until an input changes. A judge prompt above the byte limit of one command-line argument (possible
 *      for a capped answer in a script of several bytes per character) is recorded the same way. While one arm's answer
 *      is not loaded, not eligible or blocked by the provider for good, the other arm's judgments of that task are not
 *      made either (no call, no file):
 *      a seat counts only with both arms valid, so they could never count. They are pending again once that answer
 *      can be used.
 *   6. A judgment on disk is current when its input digest (judge-prompt.js judgmentProvenance: the arm and that
 *      arm's answer hash, the checklist hash, the judge prompt hash, the judge model, the sanitizer version and rules
 *      hash) equals today's. The other arm's answer is not part of it, so redoing one answer leaves the other arm's
 *      judgments current. A current judgment is never made again. One that is not current is pending; when it is made
 *      again the old file is kept as `<file>.superseded-<time>`. The OpenCode version is recorded on every judgment
 *      and is not part of the digest.
 *   7. The projection (one call per pending judgment at the upper estimate, the p90, of its seat's model in the cost
 *      profile) must fit under max_usd with
 *      what the run has already spent or reserved. The ledger also refuses each call that would pass a limit.
 *   8. Each seat has its own pool (judge_concurrency, judge_concurrency_by_seat), so a slow seat cannot hold the fast
 *      seats' slots. The call timeout is the seat's (judge_timeout_ms_by_seat, else judge_timeout_ms).
 *
 * A judgment file holds only a finished result: `valid` (the judge's labels and the answer's score), `ineligible`,
 * or `refused` (below). A failed judgment writes no judgment file: the judgment stays pending and a rerun asks again.
 * So `plan`, which counts a judgment file as done, never counts a failure as done.
 *
 * Failures:
 *   - a failed call, a timeout or a reply the strict parser rejects is retried with a growing pause, up to 3 tries
 *     in this launch (retry.js). A judgment that fails every try is kept as `<file>.failed-<time>` (the error, the
 *     last reply, the provider blocks so far) and stays pending.
 *   - a provider block is confirmed once per launch and counted across launches (the `.failed-` records with the same
 *     inputs). At MAX_REFUSALS blocks the judgment is written as `refused`: it is not tried again until an input
 *     changes, its seat is invalid for the task, and the job ends `partial` naming it.
 *   - an error that says the call can never work (access denied, an invalid request, no such model) is not retried.
 *     Only the provider's errors are sorted by their text: a reply the parser rejects is always a temporary failure,
 *     whatever words the judge used in it.
 *   - 4 judgments in a row that fail every try (blocks and permanent errors excluded) stop the job (systemic): that
 *     points at a credential or provider problem, not bad luck.
 *   - fresh credentials are exported once for the configured profile, and no call starts within 3 minutes of their
 *     expiry; a credential error from a call stops the job too. Nothing more is written for that judgment.
 *   - a result that cannot be stored (a full disk, a read-only folder) and a bug in a call end the job with that error:
 *     the calls in flight finish, no new call starts.
 *
 * Results. `done` when every judgment of the reading is current. `partial` when a judgment failed, was blocked by the
 * provider, or still waits for an answer or a checklist: the summary names them. `stopped` for a credential problem,
 * a spend stop, a ledger that cannot be used, or the systemic stop; finished judgments are kept and a rerun resumes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const awsCredentials = require('./aws-credentials');
const { CredentialError } = awsCredentials;
const { judgeConcurrency, rubricWriterModel } = require('./config');
const { callCost } = require('./cost-profile');
const { loadBaseline, loadExclusions } = require('./baseline');
const { FormatError } = require('./formats');
const { itemNames, judgingSets, validateLadder } = require('./dose-ladder');
const { splitTasks } = require('./exclusions');
const { createJudgeInput } = require('./judge-input');
const {
  judgeFor,
  judgmentProvenance,
  renderJudgePrompt,
} = require('./judge-prompt');
const {
  MIN_SEATS,
  SCORE_MAX,
  SCORE_MIN,
  aggregateTask,
  resolveScale,
  scoreJudgment,
} = require('./judge-scale');
const { estimatedCallsLine, planJobs, trackEstimatedCalls } = require('./jobs');
const { SCALES } = require('./layout');
const {
  createLedger,
  readLedger,
  LedgerError,
  SpendStopError,
} = require('./ledger');
const opencode = require('./opencode');
const {
  RUNNABLE_STATUSES,
  STATUS_NOT_LOADED,
  STATUS_OK,
  answerCurrent,
  writeRecord,
} = require('./pairs');
const { buildPlan } = require('./plan');
const { createPools } = require('./pool');
const { readJsonFile } = require('./read-file');
const { createRedactor, redact } = require('./redact');
const { bookedUsd } = require('./request-checklist');
const {
  ATTEMPTS,
  MAX_REFUSALS: RETRY_MAX_REFUSALS,
  SYSTEMIC_AFTER,
  CallError,
  SystemicFailureError,
  classifyError,
  createBreaker,
  withRetry,
} = require('./retry');
const { viewOutcomeTask } = require('./scale-view');
const { fileTime, supersede } = require('./supersede');
const { judgeRequest, loadTaskSet } = require('./tasks');

const JUDGMENT_KIND = 'judgment';
const STATUS_VALID = 'valid';
const STATUS_INELIGIBLE = 'ineligible';
const STATUS_REFUSED = 'refused';
const STATUS_FAILED = 'failed';
/** The statuses of a judgment file that is finished: a current one is never made again. */
const DONE_STATUSES = new Set([
  STATUS_VALID,
  STATUS_INELIGIBLE,
  STATUS_REFUSED,
]);
/** Tries per judgment within one launch: the call and 2 retries with a growing pause (retry.js). */
const JUDGE_ATTEMPTS = ATTEMPTS;
/**
 * Provider blocks one judgment may collect across launches before it is no longer tried. A launch confirms a block
 * once (retry.js MAX_REFUSALS), so a judgment blocked on every try reaches this on its second launch, and one that
 * got through on a later launch is not lost.
 */
const MAX_REFUSALS = 3;
/** Judgments in a row that fail every try (blocks and permanent errors excluded) before the job stops. */
const JUDGE_SYSTEMIC_AFTER = SYSTEMIC_AFTER;
const FAILED_MARK = '.failed-';
const STOP_MESSAGE_CHARS = 400;
const REASON_CHARS = 2000;
const RAW_TEXT_CHARS = 20000;
const LISTED_WAITS = 10;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * judgeCall threw something that is not a stop: a call it refused to start, or a bug. Fatal, so it is never retried
 * and the pools start no new call; the job then throws it on.
 */
class JudgeCallBug extends Error {
  constructor(cause) {
    super(
      `the judge call threw: ${(cause && cause.message) || String(cause)}`,
      {
        cause,
      },
    );
    this.name = 'JudgeCallBug';
    this.fatal = true;
  }
}

/**
 * A reply the strict parser rejected. Its message holds text the judge chose (an unexpected field name, for one), so
 * the job never sorts it by what it says: retry.js classes provider errors by their message, and a reply that names
 * `ExpiredToken` or `AccessDenied` must not stop the job or skip the retries. It is always a temporary failure.
 */
class InvalidReplyError extends Error {
  constructor(scored) {
    super(`invalid reply (${scored.kind}): ${scored.invalid}`);
    this.name = 'InvalidReplyError';
  }
}

/** The retry class of a failed try: a provider error by its text (retry.js), an invalid reply always `transient`. */
const classifyTry = (error) =>
  error instanceof InvalidReplyError ? 'transient' : classifyError(error);

/** The judgment record in `file`, or null when there is none or it cannot be read as JSON. */
function readJudgment(file) {
  try {
    const record = readJsonFile(file);
    return isPlainObject(record) ? record : null;
  } catch {
    return null;
  }
}

/** The guard items of `job`'s checklist: the items of the `guard` bucket (reading B), none on reading A. */
const guardItemsOf = (job) =>
  job.buckets ? job.buckets.filter((bucket) => bucket === 'guard').length : 0;

/**
 * True when a `valid` record has what taskGaps reads from it, matching `job`: its seat and arm, a score from
 * SCORE_MIN to SCORE_MAX, and the guard its checklist gives (null with no guard item, else { items, met } with the
 * checklist's count of guard items and met from 0 to items).
 */
function validFieldsMatch(record, job) {
  if (record.seat !== job.seat || record.arm !== job.arm) return false;
  if (
    !Number.isFinite(record.score) ||
    record.score < SCORE_MIN ||
    record.score > SCORE_MAX
  )
    return false;
  const expected = guardItemsOf(job);
  if (expected === 0) return record.guard === null;
  const { guard } = record;
  return (
    isPlainObject(guard) &&
    guard.items === expected &&
    Number.isFinite(guard.met) &&
    guard.met >= 0 &&
    guard.met <= guard.items
  );
}

/**
 * True when `record` is a finished judgment of `job` made from the job's inputs (judgmentProvenance): the job's
 * scale, the same input digest, and a status that is done. A `valid` record must also pass validFieldsMatch, because
 * taskGaps hands those fields to aggregateTask, which throws on a bad one and would stop every command for the reading.
 * A failed, unreadable or other-scale record, one made from other inputs, or a valid one with a field out of place is
 * not current: it is set aside and made again.
 */
function judgmentCurrent(record, job) {
  return (
    isPlainObject(record) &&
    record.kind === JUDGMENT_KIND &&
    record.scale === job.scale &&
    DONE_STATUSES.has(record.status) &&
    isPlainObject(record.inputs) &&
    !!job.inputs &&
    record.inputs.input_sha256 === job.inputs.input_sha256 &&
    (record.status !== STATUS_VALID || validFieldsMatch(record, job))
  );
}

/**
 * The stored answer of one judge job and arm: { state, record } with state `ok` (a current answer with text),
 * `not_loaded` (current, stored as not loaded), `missing` (no file) or `stale` (another digest, or a text that does
 * not match its hash).
 */
function readAnswer(layout, job, arm) {
  const file = layout.answerFile(job.skill, job.batch, job.task.id, arm);
  if (!fs.existsSync(file)) return { state: 'missing', record: null };
  if (!answerCurrent(file, job.task.inputs[arm]))
    return { state: 'stale', record: null };
  const record = readJsonFile(file);
  if (record.status === STATUS_NOT_LOADED)
    return { state: 'not_loaded', record };
  return {
    state: record.status === STATUS_OK ? 'ok' : 'stale',
    record,
  };
}

/** The bucket of each rules checklist item of `taskId`, in item order, from the batch's bucket sidecar. */
function itemBuckets(buckets, taskId, itemCount) {
  const items = buckets && buckets.scenarios && buckets.scenarios[taskId];
  if (!isPlainObject(items))
    throw new Error(`the bucket sidecar has no entry for task ${taskId}`);
  return Array.from({ length: itemCount }, (_, index) => {
    const entry = items[String(index + 1)];
    if (!entry || typeof entry.bucket !== 'string')
      throw new Error(
        `the bucket sidecar has no bucket for item ${index + 1} of task ${taskId}`,
      );
    return entry.bucket;
  });
}

/** What the judgment record keeps of one answer's judge-input step: the counts, never the text. */
const shownSummary = (prepared) => ({
  eligible: prepared.eligible,
  reason: prepared.reason,
  redacted: prepared.redacted,
  truncated: prepared.truncated,
  chars_in: prepared.chars_in,
  removed_chars: prepared.removed_chars,
  removed_share: prepared.removed_share,
  removed_by_rule: prepared.removed_by_rule,
  leaks: prepared.leaks.map(({ id, count }) => ({ id, count })),
});

/** `text` on one line: whitespace runs, newlines included, become one space. */
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * Runs a write of a judgment record. A write error is thrown on as the I/O error, marked as a write so job.js reports
 * "cannot write" (exit 74); the seats' pool treats it as fatal (see the handler around judgeOne) and starts no more
 * calls, because a folder that cannot be written fails every later write the same way.
 */
function storing(write) {
  try {
    return write();
  } catch (error) {
    // job.js reads the flag only for a system error (a string code and syscall), so mark only those.
    if (typeof error.code === 'string' && typeof error.syscall === 'string')
      error.writing = true;
    throw error;
  }
}

const jobLabel = (job) =>
  `${job.skill}/${job.batch}/${job.task.id}:${job.scale}:${job.seat}:${job.arm}`;

/**
 * The judge jobs of `skills` for `scale`, each with its state. Reads files and writes nothing. Options:
 *   layout, config, skills   the layout, the settings and the skill names to judge (plan has passed them)
 *   scale                    'items' or 'outcome'
 *   judgeInput               createJudgeInput(...) result
 *   armsTmpRoot              where loadTaskSet builds the arms for their manifests (default: the system temp dir)
 *   ladder                   the dose ladder (an object) whose items `skills` may also name, or null. An item is
 *                            judged on `outcome` only, against its request-only checklist, with the authored answers
 *                            of the ladder (dose-ladder.js judgingSets); on `items` it has no job.
 * Returns { jobs, excluded, warnings } where each job is a jobs.js judge job plus
 *   { file, label, checklist, buckets, checklist_meta, answer, shown, rendered, inputs, state, reason }
 * and state is
 *   done         a current judgment is on disk
 *   pending      the judgment can be made now
 *   waiting      the job's answer is missing or stale, or the request-only checklist is missing, stale or unsafe
 *   not_loaded   the job's answer is stored as not loaded: never judged, the task does not count
 *   ineligible   the job's answer is not eligible for judging, or the judge prompt is above the byte limit of one
 *                command-line argument (opencode.js MAX_PROMPT_BYTES): an `ineligible` record is written, no call is made
 *   other_arm_unusable
 *                the judgment could be made, but the other arm's answer for the same task and seat cannot be used
 *                (otherArmUnusable): the seat can never count, so no call is made and no file is written. It is
 *                pending again once the other arm's answer can be used.
 * `rendered` is renderJudgePrompt's result for a judgment that is not current and whose answer is eligible (else
 * null): the prompt the call sends, so the byte limit is checked on the text that is sent.
 */
function planJudging({
  layout,
  config,
  skills,
  scale,
  judgeInput,
  armsTmpRoot,
  ladder = null,
}) {
  resolveScale(scale);
  const exclusions = loadExclusions(layout);
  const writer = scale === 'outcome' ? rubricWriterModel(config) : null;
  const ladderItems = ladder ? itemNames(ladder) : [];
  const fromLadder = ladderItems.length
    ? judgingSets(
        ladder,
        skills.filter((skill) => ladderItems.includes(skill)),
      )
    : null;
  // The seats judge the same answer, so it goes through the judge-input step once.
  const prepared = new Map();
  const prepare = (job, record) => {
    const key = `${job.skill}/${job.batch}/${job.task.id}:${job.arm}`;
    if (!prepared.has(key))
      prepared.set(
        key,
        judgeInput.prepare(record.text, {
          skill: job.skill,
          // Text the task's request holds is the user's own and stays in the answer (sanitize.js request guard).
          request: judgeRequest(job.task).request,
        }),
      );
    return prepared.get(key);
  };
  const jobs = [];
  const excluded = [];
  const warnings = [];
  for (const skill of skills) {
    const isItem = ladderItems.includes(skill);
    // A dose ladder item is read by A only: it has no rules checklist, so it has no `items` job.
    if (isItem && scale !== 'outcome') continue;
    let taskSet;
    let ruleIds = [];
    let bucketsOf = new Map();
    if (isItem) taskSet = fromLadder.taskSets[skill];
    else {
      ({ taskSet } = loadTaskSet({
        layout,
        config,
        skill,
        ...(armsTmpRoot ? { tmpRoot: armsTmpRoot } : {}),
      }));
      const baseline = loadBaseline(layout, skill);
      ruleIds = baseline.rules
        ? baseline.rules.rules.map((rule) => rule.id)
        : [];
      bucketsOf = new Map(
        baseline.batches.map((entry) => [entry.batch, entry.buckets]),
      );
    }
    if (scale === 'outcome')
      for (const { batch, tasks } of taskSet.batches)
        excluded.push(
          ...splitTasks(exclusions, batch, tasks).excluded.map((record) => ({
            skill,
            ...record,
          })),
        );
    const planned = planJobs([taskSet], config, { exclusions }).judge.filter(
      (job) => job.scale === scale,
    );
    warnings.push(...taskSet.warnings.map((warning) => `${skill}: ${warning}`));
    for (const planJob of planned) {
      const job = {
        ...planJob,
        file: layout.judgmentFile(
          scale,
          planJob.skill,
          planJob.batch,
          planJob.task.id,
          planJob.seat,
          planJob.arm,
        ),
        checklist: null,
        buckets: null,
        checklist_meta: null,
        answer: null,
        shown: null,
        rendered: null,
        inputs: null,
        state: 'pending',
        reason: null,
      };
      job.label = jobLabel(job);
      jobs.push(job);
      if (scale === 'outcome') {
        const view = viewOutcomeTask(planJob.task, {
          skill,
          batch: planJob.batch,
          layout,
          model: writer,
          ruleIds,
        });
        if (view.status !== 'ok') {
          job.state = 'waiting';
          job.reason = `the request-only checklist is ${view.status}: ${view.reason}`;
          continue;
        }
        job.checklist = judgeRequest(view.task).checklist;
        job.checklist_meta = view.task.checklist;
      } else {
        job.checklist = judgeRequest(planJob.task).checklist;
        job.buckets = itemBuckets(
          bucketsOf.get(planJob.batch),
          planJob.task.id,
          job.checklist.length,
        );
      }
      const stored = isItem
        ? {
            state: 'ok',
            record: fromLadder.answer(skill, planJob.task.id, job.arm),
          }
        : readAnswer(layout, job, job.arm);
      if (['missing', 'stale'].includes(stored.state)) {
        job.state = 'waiting';
        job.reason = `waits for the pairs job: the ${job.arm} answer is ${stored.state}`;
        continue;
      }
      if (stored.state === 'not_loaded') {
        job.state = 'not_loaded';
        job.reason = `the ${job.arm} answer is stored as not loaded`;
        continue;
      }
      job.answer = stored.record;
      job.shown = prepare(job, stored.record);
      job.inputs = judgmentProvenance({
        scale,
        arm: job.arm,
        answerSha256: stored.record.answer_sha256,
        answer: job.shown,
        // The bucket of each item decides which items are guard items, so it is part of what the judgment was made
        // from: a sidecar edit that moves an item to another bucket makes the stored judgments pending again.
        checklist: job.buckets
          ? job.checklist.map((item, index) => ({
              item,
              bucket: job.buckets[index],
            }))
          : job.checklist,
        judgeModel: job.model,
        input: judgeInput,
        openCodeVersion: null,
      });
      const onDisk = readJudgment(job.file);
      if (judgmentCurrent(onDisk, job)) {
        job.state = 'done';
        job.record_status = onDisk.status;
        if (onDisk.status === STATUS_REFUSED)
          job.reason = `the provider blocked the judge ${onDisk.refusals} time(s); not tried again until an input changes`;
        continue;
      }
      if (!job.shown.eligible) {
        job.state = 'ineligible';
        job.reason = `the ${job.arm} answer is not eligible: ${job.shown.reason}`;
        continue;
      }
      // The answer cap counts characters, but the prompt goes to the judge as one command-line argument, which is
      // capped in bytes: a capped answer in a script of 3 or 4 bytes per character can still pass it. judgeCall
      // refuses such a prompt, so it is recorded here, with no call, instead of stopping the whole job there.
      // The prompt rendered here is the one the call sends (judgeOne), so the byte check measures what is sent.
      job.rendered = renderJudgePrompt({
        scale,
        request: judgeRequest(job.task).request,
        checklist: job.checklist,
        answer: job.shown,
      });
      const promptBytes = Buffer.byteLength(job.rendered.prompt, 'utf8');
      if (promptBytes > opencode.MAX_PROMPT_BYTES) {
        job.state = 'ineligible';
        job.reason = `the judge prompt is ${promptBytes} bytes, above the ${opencode.MAX_PROMPT_BYTES}-byte limit of one command-line argument`;
      }
    }
  }
  holdOtherArms(jobs);
  return { jobs, excluded, warnings };
}

/**
 * Why the answer of `job` cannot be used for its task and seat in this reading, or null when it can (or may yet):
 * it is stored as not loaded, it is not eligible (about to be recorded so, or recorded so), or its judgment on this
 * seat is refused (the provider blocked it for good, until an input changes).
 */
function otherArmUnusable(job) {
  if (job.state === 'not_loaded') return 'is stored as not loaded';
  if (
    job.state === 'ineligible' ||
    (job.state === 'done' && job.record_status === STATUS_INELIGIBLE)
  )
    return 'is not eligible';
  if (job.state === 'done' && job.record_status === STATUS_REFUSED)
    return 'was blocked by the provider for good on this seat';
  return null;
}

/**
 * A seat counts for a task only with a valid judgment for both arms (taskGaps), so a pending judgment whose other
 * arm cannot be used would be paid for and never read. Such a job becomes `other_arm_unusable`. A judgment already
 * made is kept, and a job that waits still waits.
 */
function holdOtherArms(jobs) {
  const bySeat = new Map();
  for (const job of jobs) {
    const key = `${job.skill}\u0000${job.batch}\u0000${job.task.id}\u0000${job.seat}`;
    if (!bySeat.has(key)) bySeat.set(key, []);
    bySeat.get(key).push(job);
  }
  for (const seatJobs of bySeat.values())
    for (const job of seatJobs) {
      if (job.state !== 'pending') continue;
      const other = seatJobs.find(
        (entry) => entry.arm !== job.arm && otherArmUnusable(entry),
      );
      if (!other) continue;
      job.state = 'other_arm_unusable';
      job.reason = `not judged: the ${other.arm} answer ${otherArmUnusable(other)}, so this seat cannot count`;
    }
}

/** The fields every judgment record starts with: what was judged, by whom, from what. */
function recordHead(job, status, openCodeVersion) {
  const prompt = judgeFor(job.scale);
  return {
    kind: JUDGMENT_KIND,
    status,
    scale: job.scale,
    reading: prompt.reading,
    skill: job.skill,
    batch: job.batch,
    task_id: job.task.id,
    seat: job.seat,
    arm: job.arm,
    judge_model: job.model,
    prompt_version: prompt.version,
    prompt_sha256: prompt.sha256,
    item_count: job.checklist.length,
    checklist: job.checklist_meta,
    inputs: { ...job.inputs, opencode_version: openCodeVersion ?? null },
    answer: {
      answer_sha256: job.answer.answer_sha256,
      arm_blinding_version: job.answer.arm_blinding_version ?? null,
      judge_input: shownSummary(job.shown),
    },
  };
}

/** The record of a judgment that was not made because an answer is not eligible: no call, no cost. */
function ineligibleRecord(job, { now = Date.now } = {}) {
  return {
    ...recordHead(job, STATUS_INELIGIBLE, null),
    reason: redact(job.reason, { maxChars: REASON_CHARS }),
    usd: 0,
    written_at: new Date(now()).toISOString(),
  };
}

/**
 * The record of a valid judgment. `scored` is scoreJudgment's valid result and `result` the judgeCall result. The
 * reply text is kept, redacted and capped, so a person can read why.
 */
function validRecord(
  job,
  {
    scored,
    result,
    openCodeVersion,
    attempts,
    refusals = 0,
    usd,
    now = Date.now,
    redactText = redact,
  },
) {
  return {
    ...recordHead(job, STATUS_VALID, openCodeVersion),
    labels: scored.labels,
    score: scored.score,
    guard: scored.guard,
    reason:
      scored.reason === null
        ? null
        : redactText(scored.reason, { maxChars: REASON_CHARS }),
    normalized: scored.normalized,
    raw_text: redactText(result.text, { maxChars: RAW_TEXT_CHARS }),
    attempts,
    refusals,
    usage: result.usage ?? null,
    usage_source: result.usageSource ?? null,
    reported_usd: result.reportedUsd ?? null,
    usd,
    ms: result.ms ?? null,
    judged_at: new Date(now()).toISOString(),
  };
}

/** Writes `record` to the job's judgment file; a file already there (not current) is kept as `.superseded-<time>`. */
function writeJudgment(job, record, now) {
  const setAside = supersede(job.file, now);
  writeRecord(job.file, record);
  return setAside;
}

/**
 * The record of a judgment that failed every try of this launch (`failed`), or that the provider has now blocked
 * MAX_REFUSALS times across launches (`refused`). `error` is the CallError, `last` the last try's { result, scored }.
 * The reply of the last try is kept, redacted and capped, so a person can see what the judge sent.
 */
function failedRecord(
  job,
  {
    status,
    error,
    refusals,
    attempts,
    last,
    usd,
    openCodeVersion,
    now,
    redactText = redact,
  },
) {
  return {
    ...recordHead(job, status, openCodeVersion),
    error_kind: error.kind,
    error: redactText(error.message, { maxChars: REASON_CHARS }),
    invalid_reply:
      last && last.scored && !last.scored.valid ? last.scored.kind : null,
    raw_text:
      last && last.result && last.result.text
        ? redactText(last.result.text, { maxChars: RAW_TEXT_CHARS })
        : null,
    refusals,
    attempts,
    usd,
    failed_at: new Date(now()).toISOString(),
  };
}

/**
 * Keeps a failed judgment's record next to the judgment file as `<file>.failed-<time>` (`-2`, `-3`, ... when the
 * name is taken). The judgment file itself is not written, so the judgment stays pending and `plan`, which counts a
 * judgment file as done, still counts it pending.
 */
function keepFailed(job, record, now) {
  const base = `${job.file}${FAILED_MARK}${fileTime(now)}`;
  let target = base;
  for (let copy = 2; fs.existsSync(target); copy += 1)
    target = `${base}-${copy}`;
  writeRecord(target, record);
  return target;
}

/**
 * Provider blocks already recorded for this judgment with today's inputs: the most any kept `.failed-` record of it
 * with the same input digest says. 0 when there is none, or its inputs changed (a new checklist, answer or prompt
 * starts the count again).
 */
function priorRefusals(job) {
  const dir = path.dirname(job.file);
  const prefix = `${path.basename(job.file)}${FAILED_MARK}`;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let most = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const record = readJudgment(path.join(dir, name));
    if (
      record &&
      isPlainObject(record.inputs) &&
      record.inputs.input_sha256 === job.inputs.input_sha256 &&
      Number.isInteger(record.refusals)
    )
      most = Math.max(most, record.refusals);
  }
  return most;
}
/** One judgment as aggregateTask takes it: { seat, scale, arm, valid, score, guard }. */
function scoredOf(record) {
  return {
    seat: record.seat,
    scale: record.scale,
    arm: record.arm,
    valid: record.status === STATUS_VALID,
    score: record.score,
    guard: record.guard ?? null,
  };
}

/**
 * Per task: the task gap of this reading from its current judgments (judge-scale.js aggregateTask). A seat counts
 * when it gave a valid judgment for both arms, and a task counts when at least MIN_SEATS seats count; a task with an
 * answer that is not loaded or not eligible never counts. A record must name the seat and arm of the job it was read
 * for: one that names another is left out, as if it had no file, and the row says so when the task does not count.
 * `readRecord(job)` reads a done job's record (default: its judgment file).
 * Returns [{ skill, batch, task_id, counted, gap, seats_valid, invalid }] in job order, one row per task.
 */
function taskGaps(jobs, { readRecord = (job) => readJudgment(job.file) } = {}) {
  const tasks = new Map();
  for (const job of jobs) {
    const key = `${job.skill}\u0000${job.batch}\u0000${job.task.id}`;
    if (!tasks.has(key))
      tasks.set(key, {
        skill: job.skill,
        batch: job.batch,
        task_id: job.task.id,
        scale: job.scale,
        records: [],
        misplaced: [],
        blocked: null,
      });
    const row = tasks.get(key);
    if (job.state === 'not_loaded' || job.state === 'ineligible')
      row.blocked = row.blocked || job.reason;
    if (job.state === 'done') {
      const record = readRecord(job);
      if (record && (record.seat !== job.seat || record.arm !== job.arm)) {
        row.misplaced.push(`${job.seat} ${job.arm}`);
        // An ineligible record says the answer must not count; dropping it would let the task count anyway.
        if (record.status === STATUS_INELIGIBLE)
          row.blocked =
            row.blocked ||
            `the ineligible judgment of ${job.seat} ${job.arm} names another seat or arm than its job`;
      } else if (record) row.records.push(record);
    }
  }
  return [...tasks.values()].map((row) => {
    if (
      row.blocked ||
      row.records.some((record) => record.status === STATUS_INELIGIBLE)
    )
      return {
        skill: row.skill,
        batch: row.batch,
        task_id: row.task_id,
        counted: false,
        gap: null,
        seats_valid: 0,
        invalid:
          row.blocked ||
          row.records.find((record) => record.status === STATUS_INELIGIBLE)
            .reason,
      };
    const aggregate = aggregateTask(row.records.map(scoredOf), {
      scale: row.scale,
      minSeats: MIN_SEATS,
    });
    return {
      skill: row.skill,
      batch: row.batch,
      task_id: row.task_id,
      counted: aggregate.valid,
      gap: aggregate.gap,
      seats_valid: aggregate.seats_valid,
      invalid:
        aggregate.invalid && row.misplaced.length
          ? `${aggregate.invalid}; the judgment of ${row.misplaced.join(', ')} names another seat or arm than its job`
          : aggregate.invalid,
    };
  });
}

/** The stop a thrown error means, or null for an error that is not a stop (a bug, which is thrown on). */
function stopFor(error) {
  const message = redact(String(error && error.message), {
    maxChars: STOP_MESSAGE_CHARS,
  });
  if (
    error instanceof CredentialError ||
    (error instanceof CallError && error.kind === 'credential')
  )
    return { kind: 'credentials', message };
  if (error instanceof SpendStopError) return { kind: 'spend', message };
  if (error instanceof LedgerError) return { kind: 'ledger', message };
  if (error instanceof SystemicFailureError)
    return { kind: 'systemic', message };
  return null;
}

/** The default credential source: a fresh `aws configure export-credentials` for the configured profile. */
const exportForConfig = (config) =>
  awsCredentials.exportCredentials({
    profile: awsCredentials.resolveProfile(config),
    region: config.aws_region,
  });

/** USD the run has spent or reserved so far, from the ledger. Throws LedgerError for a ledger that cannot be read. */
function runUsdSoFar(layout) {
  const totals = readLedger(layout.ledgerFile).runs.get(layout.runId);
  return totals ? totals.spent + totals.reserved : 0;
}

const roundUsd = (usd) => Number(Number(usd || 0).toFixed(4));
/** The upper estimate (p90) of one judge call with `model`, from the cost profile. */
const judgeCallP90 = (config, model) => callCost(config, 'judge', model).p90;
const countState = (jobs, state) =>
  jobs.filter((job) => job.state === state).length;

/** The default OpenCode version reader: `opencode --version` in a private sandbox (opencode.js). */
const readVersionForConfig = (config) =>
  opencode.readOpenCodeVersion({ region: config.aws_region });

/**
 * Runs the judge job for one reading. Options:
 *   layout, config   createLayout(...) and loadConfig(...)
 *   skills           the selected skill names (already checked to exist)
 *   scale            'items' (reading B) or 'outcome' (reading A)
 *   dryRun           list the pending judgments and stop; nothing is spent or written
 *   log              (line) => void, one line per event (default: nothing)
 *   judgeCall        the call (default opencode.js judgeCall); tests pass a stub
 *   callOptions      extra options for every judgeCall (tests: run, bin, tmpRoot, baseEnv; costProfile, which also
 *                    prices what the job books)
 *   getCredentials   async (config) => credentials (default: export for the configured profile)
 *   readVersion      async (config) => the OpenCode version (default `opencode --version`)
 *   now              () => ms, for the expiry check and the file times
 *   retry            extra options for retry.js withRetry (tests: sleep, baseMs)
 *   armsTmpRoot      where the arms are built for their manifests (tests)
 *   ladder           the dose ladder (an object or a file path) whose items `skills` may also name, or null. The
 *                    items are not given to `plan`; the ladder must pass its audit instead (dose-ladder.js).
 *
 * Returns { status, refused, stop, skipped, scale, excluded, jobs, done, pending, waiting, not_loaded, ineligible,
 * other_arm_unusable, projected_usd, results, blocked, remaining, tasks, cut_off, warnings, usd, estimated } where
 * status is
 *   refused   nothing was spent: `plan` refused the skills, or the projection is above max_usd
 *   dry-run   the pending judgments were listed
 *   done      every judgment of the reading is current
 *   partial   a judgment failed, was blocked by the provider, or waits for an answer or a checklist
 *   stopped   a stop ended the job (`stop`: { kind, message }, kind credentials, spend, ledger or systemic)
 * `waiting` lists [{ judgment, reason }] for the judgments that wait; `results` is { judged, ineligible, failed,
 * refused } with the labels judged and set ineligible by this run, { judgment, kind, reason } for each that failed and
 * { judgment, reason } for each this run found blocked for good. `blocked` lists every current `refused` judgment.
 * `remaining` is the count of judgments still not current, and `tasks` the per-task gaps (taskGaps) after the run.
 * `estimated` is null, or { calls, models } for the calls charged at their mean because the CLI reported no
 * usable cost (jobs.js trackEstimatedCalls).
 */
async function runJudging({
  layout,
  config,
  skills,
  scale,
  dryRun = false,
  log = () => {},
  judgeCall = opencode.judgeCall,
  callOptions = {},
  getCredentials = exportForConfig,
  readVersion = readVersionForConfig,
  now = Date.now,
  retry = {},
  armsTmpRoot,
  ladder = null,
}) {
  if (!SCALES.includes(scale))
    throw new TypeError(
      `runJudging: scale must be one of ${SCALES.join(', ')}, got ${JSON.stringify(scale)}`,
    );
  const summary = {
    status: 'refused',
    refused: [],
    stop: null,
    skipped: [],
    scale,
    excluded: [],
    jobs: 0,
    done: 0,
    pending: 0,
    waiting: [],
    not_loaded: 0,
    ineligible: 0,
    other_arm_unusable: 0,
    projected_usd: 0,
    results: { judged: [], ineligible: [], failed: [], refused: [] },
    cut_off: 0,
    blocked: [],
    remaining: 0,
    tasks: [],
    warnings: [],
    usd: 0,
    estimated: null,
  };
  const ladderItems = ladder ? itemNames(ladder) : [];
  const ladderSelected = skills.filter((name) => ladderItems.includes(name));
  const realSkills = skills.filter((name) => !ladderItems.includes(name));
  let runnable = [];
  // As in the checklist job: `plan` judges the skills, and the ladder is checked by its own audit.
  if (realSkills.length) {
    const plan = buildPlan({ layout, config, skills: realSkills });
    summary.warnings.push(...plan.warnings);
    if (!plan.ok) {
      summary.refused.push(...plan.refused);
      return summary;
    }
    runnable = plan.skills.filter((row) => {
      if (RUNNABLE_STATUSES.has(row.status)) return true;
      summary.skipped.push({ skill: row.skill, status: row.status });
      return false;
    });
  }
  if (ladderSelected.length) {
    const audit = validateLadder(ladder);
    if (!audit.ok) {
      summary.refused.push(
        `the dose ladder fails its audit: ${audit.problems.slice(0, LISTED_WAITS).join('; ')}`,
      );
      return summary;
    }
    // A run of ladder items alone skips `plan`, which would have refused a malformed exclusions file.
    try {
      loadExclusions(layout);
    } catch (error) {
      if (!(error instanceof FormatError)) throw error;
      summary.refused.push(error.message);
      return summary;
    }
  }
  const judged = [...runnable.map((row) => row.skill), ...ladderSelected];

  // The subject runner stores an answer as it is. A text that holds one of the run's credential values stops that run
  // (claude-run.js, sweepTrace), so no stored answer holds one and the judge job, which has none of those values, needs
  // no literals here.
  const judgeInput = createJudgeInput({ literals: [] });
  const planFor = () =>
    planJudging({
      layout,
      config,
      skills: judged,
      scale,
      judgeInput,
      armsTmpRoot,
      ladder: ladderSelected.length ? ladder : null,
    });
  const planned = planFor();
  const { jobs } = planned;
  summary.excluded = planned.excluded;
  summary.warnings.push(...planned.warnings);
  const describe = (list) => {
    summary.jobs = list.length;
    summary.done = countState(list, 'done');
    summary.not_loaded = countState(list, 'not_loaded');
    summary.ineligible = countState(list, 'ineligible');
    summary.other_arm_unusable = countState(list, 'other_arm_unusable');
    summary.pending = countState(list, 'pending');
    summary.waiting = list
      .filter((job) => job.state === 'waiting')
      .map((job) => ({ judgment: job.label, reason: job.reason }));
    summary.remaining = list.filter(
      (job) =>
        !['done', 'not_loaded', 'other_arm_unusable'].includes(job.state),
    ).length;
    summary.blocked = list
      .filter((job) => job.record_status === STATUS_REFUSED)
      .map((job) => ({ judgment: job.label, reason: job.reason }));
    summary.tasks = taskGaps(list);
  };
  describe(jobs);
  const prompt = judgeFor(scale);
  // Each pending judgment at its seat model's upper estimate (p90). The ledger reserves more for each call, its ceiling
  // (opencode.js callCeiling), so a projection that fits can still meet a ledger refusal when max_usd is tight.
  summary.projected_usd = roundUsd(
    jobs
      .filter((job) => job.state === 'pending')
      .reduce((total, job) => total + judgeCallP90(config, job.model), 0),
  );
  log(
    `judge: reading ${prompt.reading} (scale ${scale}, prompt v${prompt.version}); skills ${judged.join(', ') || 'none'}; ${summary.done}/${summary.jobs} judgment(s) current, ${summary.pending} to make, ${summary.waiting.length} waiting, ${summary.not_loaded} not judged (an answer not loaded), ${summary.ineligible} with an answer not eligible, ${summary.other_arm_unusable} not judged because the other arm's answer cannot be used; projected USD ${summary.projected_usd.toFixed(2)}`,
  );
  for (const { skill, status } of summary.skipped)
    log(`  skipped ${skill} (${status})`);
  for (const record of summary.excluded)
    log(
      `  ${record.skill}/${record.batch}/${record.id}: excluded from reading A (bench/exclusions.json, ${record.date}); not judged: ${record.reason}`,
    );
  for (const { judgment, reason } of summary.waiting.slice(0, LISTED_WAITS))
    log(`  ${judgment} waits: ${reason}`);
  if (summary.waiting.length > LISTED_WAITS)
    log(`  ... and ${summary.waiting.length - LISTED_WAITS} more waiting`);

  if (dryRun) {
    for (const job of jobs)
      if (job.state === 'pending')
        log(
          `  would judge ${job.label} (${job.model}, ${job.checklist.length} items, up to USD ${judgeCallP90(config, job.model).toFixed(4)})`,
        );
      else if (job.state === 'ineligible')
        log(`  would record ${job.label} as ineligible: ${job.reason}`);
    summary.status = 'dry-run';
    return summary;
  }

  // The calls charged at their mean because the CLI reported no usable cost; none before the ledger exists.
  let estimatedCalls = () => null;
  const finish = () => {
    describe(planFor().jobs);
    summary.estimated = estimatedCalls();
    if (summary.estimated)
      log(`judge: ${estimatedCallsLine(summary.estimated)}`);
    if (summary.cut_off)
      log(
        `judge: ${summary.cut_off} reply(ies) cut off at the output limit and not used; raise judge_max_output_tokens, or the seat's entry in judge_max_output_tokens_by_seat, if this keeps happening`,
      );
    for (const { judgment, reason } of summary.blocked)
      summary.warnings.push(
        `${judgment}: ${reason}; the task counts only if ${MIN_SEATS} other seats judged it`,
      );
    // A failed judgment has no file, so the replan above leaves it pending and counted in `remaining`. A judgment
    // whose other arm is the blocked one is counted in `blocked`.
    summary.status = summary.stop
      ? 'stopped'
      : summary.remaining || summary.blocked.length
        ? 'partial'
        : 'done';
    return summary;
  };

  // An answer that is not eligible is recorded without a call: nothing is spent, so no projection applies.
  for (const job of jobs.filter((entry) => entry.state === 'ineligible')) {
    storing(() => writeJudgment(job, ineligibleRecord(job, { now }), now));
    summary.results.ineligible.push(job.label);
    log(`  ${job.label}: ineligible, not judged: ${job.reason}`);
  }
  const pending = jobs.filter((job) => job.state === 'pending');
  if (!pending.length) return finish();

  let usd = 0;
  try {
    const spentSoFar = runUsdSoFar(layout);
    if (spentSoFar + summary.projected_usd > config.max_usd) {
      summary.refused.push(
        `the projected USD ${summary.projected_usd.toFixed(2)} on top of USD ${spentSoFar.toFixed(2)} already spent or reserved in run ${layout.runId} is above max_usd ${config.max_usd}; raise it to approve, or select fewer skills`,
      );
      summary.status = 'refused';
      return summary;
    }
    // Fresh credentials once for the job, then the expiry check before every call: no call starts within 3 minutes
    // of expiry. Every judge process gets these keys, so a call works without AWS_PROFILE in the shell.
    const credentials = await getCredentials(config);
    awsCredentials.assertFresh(credentials, { now, label: 'the judge job' });
    const credentialGuard = {
      assertFresh: (label) =>
        awsCredentials.assertFresh(credentials, { now, label }),
    };
    // The exported secret key and session token have no secret shape the module redactor knows, so the ledger, the
    // retry helper and the breaker get a redactor that removes these exact values too.
    const runRedactor = createRedactor({
      literals: opencode.exportedSecrets(credentials),
    });
    let openCodeVersion = null;
    try {
      openCodeVersion = await readVersion(config);
    } catch (error) {
      summary.warnings.push(
        `the OpenCode version could not be read, so the judgments record none: ${redact(String(error && error.message), { maxChars: STOP_MESSAGE_CHARS })}`,
      );
    }
    const tracker = trackEstimatedCalls(
      createLedger({
        file: layout.ledgerFile,
        limits: {
          max_usd: config.max_usd,
          total_cap_usd: config.total_cap_usd,
        },
        runId: layout.runId,
        redact: runRedactor,
      }),
    );
    estimatedCalls = tracker.estimated;
    const { ledger } = tracker;
    // Shared by every seat: 4 judgments in a row that fail every try stop the job, whichever seats they are on.
    const breaker = createBreaker({
      after: JUDGE_SYSTEMIC_AFTER,
      redact: runRedactor,
    });

    const judgeOne = async (job) => {
      const prior = priorRefusals(job);
      let refusalsNow = 0;
      let attempts = 0;
      let judgmentUsd = 0;
      let last = null;
      const tryOnce = async () => {
        attempts += 1;
        let result;
        try {
          result = await judgeCall({
            ...callOptions,
            ledger,
            config,
            modelId: job.model,
            seat: job.seat,
            prompt: job.rendered.prompt,
            label: job.label,
            timeoutMs: opencode.judgeTimeoutMs(config, job.seat),
            credentialGuard,
            credentials,
          });
        } catch (error) {
          // judgeCall reports a failed call in its result. What it throws is a stop (credentials, spend, the
          // ledger), or a call it refused to start (an unsafe model id, a prompt too long), which is a bug here:
          // neither may be retried as if the provider had failed.
          if (error && error.fatal) throw error;
          throw new JudgeCallBug(error);
        }
        const callUsd = bookedUsd(
          result,
          config,
          'judge',
          job.model,
          callOptions.costProfile,
        );
        usd += callUsd;
        judgmentUsd += callUsd;
        last = { result, scored: null };
        // A try whose reply reached the output limit and could not be used (the model stopped for length, or the
        // strict parser cannot read it) is counted apart from other failures: a limit set too low shows up here.
        // A try that is retried and cut off again counts again.
        const countCutOff = () => {
          if (result.cutOff === true) summary.cut_off += 1;
        };
        if (!result.ok) {
          countCutOff();
          // A timeout, a throttle and any other failure are sorted by retry.js from the redacted error and stderr.
          const error = opencode.judgeCallError(result);
          if (classifyError(error) === 'refusal') refusalsNow += 1;
          throw error;
        }
        last.scored = scoreJudgment({
          scale,
          text: result.text,
          arm: job.arm,
          itemCount: job.checklist.length,
          buckets: job.buckets,
        });
        // A reply the strict parser rejects is a failed try like any other: it is retried, never scored.
        if (!last.scored.valid) {
          countCutOff();
          throw new InvalidReplyError(last.scored);
        }
        return last;
      };
      let outcome;
      try {
        outcome = await withRetry(tryOnce, {
          attempts: JUDGE_ATTEMPTS,
          // A block counts across launches. A launch confirms a block once (retry.js), and never tries more blocks
          // than the judgment has left.
          maxRefusals: Math.max(
            1,
            Math.min(RETRY_MAX_REFUSALS, MAX_REFUSALS - prior),
          ),
          // The breaker is not passed to withRetry: it counts a failure only after the failed record is stored (below),
          // so the stop that follows loses no paid judgment.
          classify: classifyTry,
          redact: runRedactor,
          ...retry,
        });
      } catch (error) {
        // A stop (credentials, spend, ledger, systemic) or a bug goes on to the pool, which starts no new call.
        if (!(error instanceof CallError) || error.fatal) throw error;
        const refusals = prior + refusalsNow;
        const status =
          refusals >= MAX_REFUSALS ? STATUS_REFUSED : STATUS_FAILED;
        const record = failedRecord(job, {
          status,
          error,
          refusals,
          attempts,
          last,
          usd: roundUsd(judgmentUsd),
          openCodeVersion,
          now,
          redactText: runRedactor,
        });
        // One line: a reply can steer the text of its own parse error, and a newline in it would forge a log line.
        const reason = oneLine(
          runRedactor(error.message, { maxChars: REASON_CHARS }),
        );
        if (status === STATUS_REFUSED) {
          storing(() => writeJudgment(job, record, now));
          summary.results.refused.push({ judgment: job.label, reason });
          log(
            `  ${job.label}: blocked by the provider ${refusals} time(s); not tried again until an input changes`,
          );
        } else {
          storing(() => keepFailed(job, record, now));
          summary.results.failed.push({
            judgment: job.label,
            kind: error.kind,
            reason,
          });
          log(
            `  ${job.label}: failed (${error.kind}), stays pending: ${reason}`,
          );
        }
        // Counted after the record is stored, so the systemic stop that this may throw loses no paid judgment.
        // A permanent failure or a provider block neither counts nor resets the streak.
        if (error.kind === 'transient') breaker.recordFailure(reason);
        return;
      }
      breaker.recordSuccess();
      const record = validRecord(job, {
        scored: outcome.scored,
        result: outcome.result,
        openCodeVersion,
        attempts,
        refusals: prior + refusalsNow,
        usd: roundUsd(judgmentUsd),
        now,
        redactText: runRedactor,
      });
      const setAside = storing(() => writeJudgment(job, record, now));
      summary.results.judged.push(job.label);
      log(
        `  ${job.label}: score ${record.score.toFixed(2)}${attempts > 1 ? ` after ${attempts} tries` : ''}${setAside ? ` (stale judgment kept as ${path.basename(setAside)})` : ''}`,
      );
    };

    // Whatever escapes judgeOne is a stop (already fatal), a failure to store a result (a full disk, a read-only
    // folder) or a bug. All of them are fatal: a call whose result cannot be stored is paid for and lost, and so would
    // be every call after it, so the pools start no new call and the job throws the error once the calls in flight end.
    const judgeGuarded = async (job) => {
      try {
        return await judgeOne(job);
      } catch (error) {
        const fatal = error instanceof Error ? error : new Error(String(error));
        fatal.fatal = true;
        throw fatal;
      }
    };

    const pools = createPools({
      widths: Object.fromEntries(
        [...new Set(pending.map((job) => job.seat))].map((seat) => [
          seat,
          judgeConcurrency(config, seat),
        ]),
      ),
    });
    const bySeat = new Map();
    for (const job of pending) {
      if (!bySeat.has(job.seat)) bySeat.set(job.seat, []);
      bySeat.get(job.seat).push(job);
    }
    const settled = await Promise.allSettled(
      [...bySeat].map(([seat, list]) => pools.run(seat, list, judgeGuarded)),
    );
    // The first fatal error, thrown on once every seat's calls in flight have finished.
    const rejected = settled.find((outcome) => outcome.status === 'rejected');
    if (rejected) throw rejected.reason;
  } catch (error) {
    const stop = stopFor(error);
    if (!stop) throw error;
    summary.stop = stop;
  } finally {
    summary.usd = roundUsd(usd);
  }
  return finish();
}

module.exports = {
  JUDGMENT_KIND,
  STATUS_VALID,
  STATUS_INELIGIBLE,
  STATUS_REFUSED,
  STATUS_FAILED,
  JUDGE_ATTEMPTS,
  MAX_REFUSALS,
  JUDGE_SYSTEMIC_AFTER,
  FAILED_MARK,
  RUNNABLE_STATUSES,
  readJudgment,
  judgmentCurrent,
  itemBuckets,
  planJudging,
  ineligibleRecord,
  validRecord,
  failedRecord,
  priorRefusals,
  storing,
  taskGaps,
  stopFor,
  runJudging,
};
