// SPDX-License-Identifier: Apache-2.0
/**
 * The judge driver: plans the judge calls of a skill, makes the ones not yet stored through a
 * grader plugin, stores each judgment, and builds the skill result. A library, with no command
 * line, no spend ledger and no provider code. `runJudging` makes calls; `scoreSkill` makes none
 * and only reads what is stored, which is how a published verdict is checked offline.
 *
 * ## Grader plugin contract
 *
 * A grader plugin is how a model reaches core. Core holds no provider SDK, no network code and no
 * credential. A seat of the judge roster names its plugin by id, and `plugins` maps ids to objects:
 *
 *     plugin = {
 *       id:        string,
 *       runGrader: (call) => result | Promise<result>,
 *       canServe?: (input_sha256) => boolean,       // optional pre-check, see below
 *     }
 *     call = {
 *       prompt:       string,   // the whole judge prompt; send it as the only user message
 *       model:        string,   // the seat's model, opaque to core
 *       limits:       { timeout_ms, max_output_tokens },   // hints; a plugin may be stricter
 *       seed:         integer,  // fixed per judge input and attempt; use it where a provider can
 *       input_sha256: string,   // the judge input digest; live plugins can ignore it
 *     }
 *     result = {
 *       status:   'ok' | 'refused' | 'invalid' | 'transient' | 'credential_error',
 *       raw_text: string | null,    // the model's reply text, untouched
 *       usage:    object | null,
 *       cost:     { usd: number } | null,
 *       error?:   string,           // a short message, already redacted by the plugin
 *     }
 *
 * `prompt`, `limits` and `seed` are the contract. `model` is the seat's model, which the plugin
 * needs to make a call. `input_sha256` is for plugins that serve stored replies (plugins/replay.js):
 * the prompt carries a random marker id that changes on every call, and the digest does not.
 *
 * What the plugin must do: give the judge no tools and no network beyond the model call, take its
 * credentials from the user's own environment, and redact secrets from `error`. What it must not
 * do: parse the reply (core does, with judge-scale.js), retry on its own, or read the stored run.
 *
 * Statuses. `ok`: `raw_text` holds a reply, which core reads. `refused`: the provider declined to
 * answer this input. `invalid`: the call was malformed or the reply was cut off. `transient`: a
 * failure worth trying again, such as a timeout or throttling. `credential_error`: the plugin has
 * no valid credential. It stops the whole run at once; every judgment stored so far is kept. A
 * plugin that throws is a bug in the plugin, and the error is not stored as a judgment.
 *
 * `canServe(input_sha256)`. A plugin that serves stored replies can say, before any call, which
 * inputs it has. When every plugin in use has it, the driver checks all pending calls first and
 * throws before the first call if any is missing, so a replay with a gap writes nothing.
 *
 * ## What is stored
 *
 * One judgment record per task, seat and order (store.js). It holds the prompt template version
 * and sha, the sanitizer version and rules hash, the scale, the seat, the order, the judge input
 * digest, the marker id (`nonce`), the reply text, the parsed result, the status, the number of
 * attempts, usage and cost. The digest covers the rendered prompt but not the marker id.
 *
 * A judgment is current only when its stored digest equals the one computed now. A call is made
 * only for a judgment that is not settled: none stored, a stale one (another template, sanitizer,
 * task, answer, seat or order), or a current one that gave no usable reply and has been tried fewer
 * than MAX_ATTEMPTS times. A settled judgment is never overwritten. A reply core cannot read is
 * stored with status `unparsable`, and a failed call with the plugin's status, so the pair's seat
 * then counts as `invalid` or `unscored` in the aggregation (aggregate.js).
 *
 * ## Control skills
 *
 * When the skill has a treatment spec (treatment-check.js), each task's stored with-arm run is
 * checked against it when the result is built, and a pair counts only if the run took the control's
 * direction. The check reads the stored reply and changed files, not what the judge was shown. A
 * skill with no spec is not checked, so every pair counts.
 *
 * ## The judge sees
 *
 * The prompt is built only by `judgePrompt` (judge-prompt.js). Of a task it gets the task object
 * and reads only `task` and `rubric`; of a pair it gets the reply and the start and final
 * workspaces and nothing else (no arm label, runner fingerprint, digest or load flag).
 */
const { judgePrompt, templateForScale } = require('../lib/judge-prompt');
const { resolveScale } = require('../lib/judge-scale');
const { SANITIZER_VERSION, RULES_HASH } = require('../lib/sanitize');
const { aggregateSkill } = require('../lib/aggregate');
const { DECISION_RULE_NAME, decisionRuleSha256 } = require('../lib/decision-rule');
const { validateJudgeConfig } = require('../lib/judge-roster');
const { planJobs } = require('../lib/plan');
const { collectOutcomes } = require('../lib/score');
const { parseReply, MAX_REPLY_CHARS } = require('../lib/judge-reply');
const { treatmentFor, treatmentText } = require('../lib/treatment-check');
const {
  PROVENANCE_VERSION,
  ARMS,
  judgmentInputs,
  resultInputs,
  sha256,
} = require('../lib/provenance');
const {
  JUDGMENT_STATUS,
  MAX_ATTEMPTS,
  pairCurrent,
  judgmentMatches,
  judgmentSettled,
  resultCurrent,
} = require('../lib/store');
const { assertSlug } = require('../lib/slug');

/** Hints passed to the plugin with every call. */
const DEFAULT_GRADER_LIMITS = Object.freeze({ timeout_ms: 120000, max_output_tokens: 2048 });

/** The marker id of the prompt that is hashed. Any fixed value works; the real call uses its own. */
const DIGEST_MARKER = 'digest-marker';

/** The longest plugin error text that is stored. */
const MAX_ERROR_CHARS = 500;

/** The statuses a plugin may return for a call that gave no reply, as the store names them. */
const NO_REPLY_STATUSES = Object.freeze([
  JUDGMENT_STATUS.REFUSED,
  JUDGMENT_STATUS.INVALID,
  JUDGMENT_STATUS.TRANSIENT,
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What the judge may be shown of one stored pair: the reply and the two workspaces. */
const armView = (pair) => ({ answer: pair.answer, start: pair.start, final: pair.final });

/** A deterministic integer seed for one judge input and attempt. */
const seedFor = (digest, attempt) => parseInt(sha256(`${digest}:${attempt}`).slice(0, 8), 16);

function credentialError(pluginId, text) {
  const detail = typeof text === 'string' && text ? `: ${text.slice(0, 200)}` : '';
  const err = new Error(
    `grader plugin ${pluginId} reported a credential error${detail}; judgments stored so far are kept`,
  );
  err.code = 'credential_error';
  return err;
}

/**
 * Everything both entry points need: the planned calls, each with the digest it should carry now,
 * the stored judgment, and whether it is settled.
 */
function prepare(options) {
  const { store, skill, taskSet, context } = options;
  assertSlug(skill, 'skill');
  if (!store || typeof store.readPair !== 'function') throw new TypeError('runJudging needs a store');
  if (!taskSet || !Array.isArray(taskSet.tasks)) throw new Error('taskSet.tasks must be an array');
  const settings = validateJudgeConfig(options.config);
  const scale = resolveScale(options.scale);
  const template = options.template || templateForScale(scale.id);
  const sanitizer = { version: SANITIZER_VERSION, hash: RULES_HASH };
  const templateId = { version: scale.promptVersion, sha256: template.sha256 };

  const { judge: planned } = planJobs({ [skill]: taskSet }, settings);

  const pairsByTask = new Map();
  const missingPairs = [];
  for (const task of taskSet.tasks) {
    const pairs = {};
    for (const arm of ARMS) {
      const stored = store.readPair(skill, task.id, arm);
      if (pairCurrent(stored, { skill, taskId: task.id, arm, request: task.task })) pairs[arm] = stored;
    }
    if (ARMS.every((arm) => pairs[arm])) pairsByTask.set(task.id, pairs);
    else missingPairs.push(task.id);
  }

  const render = (job, pairs, nonce) => {
    const [first, second] =
      job.order === 'with-first' ? [pairs.with, pairs.without] : [pairs.without, pairs.with];
    return judgePrompt(job.task, armView(first), armView(second), {
      context,
      scale: scale.id,
      template,
      limits: options.promptLimits,
      nonce,
    });
  };

  const entries = planned.map((job) => {
    const pairs = pairsByTask.get(job.task.id);
    const entry = { job, pairs, expected: null, record: null, settled: false };
    if (!pairs) return entry;
    const { prompt } = render(job, pairs, DIGEST_MARKER);
    entry.expected = {
      skill,
      taskId: job.task.id,
      seat: job.judge.seat,
      order: job.order,
      model: job.judge.model,
      inputs: judgmentInputs({
        request: job.task.task,
        rubric: job.task.rubric,
        prompt,
        template: templateId,
        scale: scale.id,
        sanitizer,
        order: job.order,
        seat: job.judge.seat,
      }),
    };
    entry.record = store.readJudgment(skill, job.task.id, job.judge.seat, job.order);
    entry.settled = judgmentSettled(entry.record, entry.expected);
    return entry;
  });

  return { options, settings, scale, entries, missingPairs, render, pairsByTask };
}

/** Builds the judgment record for one plugin result. */
function recordFor(entry, run, response, attempts, nonce) {
  const { job, expected } = entry;
  const { scale } = run;
  const base = {
    provenance_version: PROVENANCE_VERSION,
    skill: expected.skill,
    task_id: expected.taskId,
    seat: expected.seat,
    family: job.judge.family,
    plugin: job.judge.plugin,
    judge_model: expected.model,
    order: expected.order,
    judge_scale: scale.id,
    prompt_version: expected.inputs.prompt_version,
    prompt_sha256: expected.inputs.prompt_sha256,
    sanitizer_version: expected.inputs.sanitizer_version,
    sanitizer_rules_sha256: expected.inputs.sanitizer_rules_sha256,
    nonce,
    inputs: expected.inputs,
    attempts,
    usage: isObject(response.usage) ? response.usage : null,
    cost: isObject(response.cost) ? response.cost : null,
  };
  const text = typeof response.raw_text === 'string' ? response.raw_text : null;
  const failure = (status, error) => ({
    ...base,
    status,
    raw_text: text === null ? null : text.slice(0, MAX_REPLY_CHARS),
    parsed: null,
    error: typeof error === 'string' && error ? error.slice(0, MAX_ERROR_CHARS) : null,
  });

  if (NO_REPLY_STATUSES.includes(response.status)) return failure(response.status, response.error);
  if (response.status !== 'ok') {
    return failure(JUDGMENT_STATUS.INVALID, `unknown grader status ${JSON.stringify(String(response.status).slice(0, 40))}`);
  }
  const parsed = parseReply(scale.id, text, { rubricLength: job.task.rubric.length });
  if (parsed.winner === null) return failure(JUDGMENT_STATUS.UNPARSABLE, parsed.problem);
  return { ...base, status: JUDGMENT_STATUS.OK, raw_text: text, parsed, error: null };
}

/** The plugin a seat names, or a throw before any call. */
function pluginFor(seat, plugins) {
  const plugin = isObject(plugins) && Object.hasOwn(plugins, seat.plugin) ? plugins[seat.plugin] : null;
  if (!plugin || typeof plugin.runGrader !== 'function') {
    throw new Error(`seat ${seat.seat} names the plugin ${JSON.stringify(seat.plugin)}, which is not loaded`);
  }
  return plugin;
}

/**
 * Builds the skill result from stored judgments, or says what is still missing. Writes the result
 * unless the stored one is already current.
 */
function finish(run) {
  const { options, settings, scale, entries, missingPairs, pairsByTask } = run;
  const { store, skill, taskSet } = options;
  const unsettled = entries.filter((e) => e.expected && !e.settled);
  const base = {
    planned: entries.length,
    pending: unsettled.length + entries.filter((e) => !e.expected).length,
    missing_pairs: missingPairs,
  };
  if (base.pending > 0) return { ...base, complete: false, result: null, result_written: false };

  const records = entries.map((e) => store.readJudgment(skill, e.job.task.id, e.job.judge.seat, e.job.order));
  const { deltas, refused } = collectOutcomes(
    entries.map((e, i) => ({
      taskId: e.job.task.id,
      seat: e.job.judge.seat,
      order: e.job.order,
      record: records[i],
      rubricLength: e.job.task.rubric.length,
    })),
    scale.id,
  );
  const allPairs = taskSet.tasks.flatMap((task) => ARMS.map((arm) => pairsByTask.get(task.id)[arm]));
  const loaded = Object.fromEntries(taskSet.tasks.map((task) => [task.id, pairsByTask.get(task.id).with.loaded === true]));
  const rule = decisionRuleSha256();
  // A control skill's pair counts only if its stored with-arm run took the control's direction. A
  // skill with no treatment spec gets a record for every task that says it needs no check. The
  // records follow from the stored pairs and the specs, and both are covered by the result inputs.
  const treatment = treatmentFor(skill, taskSet, (id) => treatmentText(pairsByTask.get(id).with));
  const inputs = resultInputs({
    skill,
    ruleSha256: rule,
    pruneBlockedReason: taskSet.prune_blocked_reason,
    tasks: taskSet.tasks,
    pairs: allPairs,
    judgments: records,
    judges: settings.judges,
  });

  const stored = store.readResult(skill);
  if (resultCurrent(stored, inputs)) {
    return { ...base, complete: true, result: stored, result_written: false };
  }
  const aggregate = aggregateSkill({
    skill,
    taskSet,
    deltas,
    refused,
    loaded,
    treatment,
    cfg: { judges: settings.judges },
  });
  const record = {
    provenance_version: PROVENANCE_VERSION,
    skill,
    decision_rule: DECISION_RULE_NAME,
    rule_sha256: rule,
    scale: scale.id,
    judges: settings.judges.map((j) => ({ ...j })),
    orders: { judgeOrders: [...settings.judgeOrders], ordersPerPair: settings.ordersPerPair },
    inputs,
    result: aggregate,
  };
  store.writeResult(record);
  return { ...base, complete: true, result: record, result_written: true };
}

/**
 * Judges a skill's stored pairs and builds its result.
 *
 *   store         a run store (store.js `openStore`) holding the pair records
 *   skill         the skill name (a slug)
 *   taskSet       { tasks: [{ id, task, rubric, target_section }], prune_blocked_reason? }
 *   config        the judge settings: { judges: [{ seat, family, plugin, model }], judgeOrders?,
 *                 ordersPerPair? } (judge-roster.js)
 *   plugins       { [pluginId]: plugin } for every plugin a seat names
 *   context       the sanitizer context for the skill (sanitize.js)
 *   scale         a judge-scale.js id; default `overall`
 *   template      optional loadTemplate result, to judge with a draft prompt
 *   promptLimits  optional workspaceChanges limits, applied to both arms alike
 *   graderLimits  optional { timeout_ms, max_output_tokens } passed to the plugin
 *
 * Returns { complete, planned, pending, missing_pairs, calls, result, result_written }. `complete`
 * is true when every planned call has a settled judgment and every task has both pairs; then
 * `result` is the stored result record. A task whose pairs are missing or stale cannot be judged
 * and is listed in `missing_pairs`.
 */
async function runJudging(options) {
  const run = prepare(options);
  const { entries } = run;
  const pending = entries.filter((e) => e.expected && !e.settled);
  const graderLimits = { ...DEFAULT_GRADER_LIMITS, ...(options.graderLimits || {}) };

  // Fail closed before the first call: every plugin must be loaded, and a plugin that can say what
  // it can serve must be able to serve everything pending.
  const used = new Map(pending.map((e) => [e.job.judge.plugin, pluginFor(e.job.judge, options.plugins)]));
  for (const [id, plugin] of used) {
    if (typeof plugin.canServe !== 'function') continue;
    const missing = pending.filter(
      (e) => e.job.judge.plugin === id && !plugin.canServe(e.expected.inputs.judge_input_sha256),
    );
    if (missing.length) {
      throw new Error(
        `plugin ${id} cannot serve ${missing.length} of ${pending.length} pending judge calls, ` +
          `for example ${missing[0].expected.inputs.judge_input_sha256}; nothing was run`,
      );
    }
  }

  let calls = 0;
  for (const entry of pending) {
    const plugin = used.get(entry.job.judge.plugin);
    const digest = entry.expected.inputs.judge_input_sha256;
    // A stored judgment that is current but not settled keeps its count; a stale one starts over.
    let attempts = judgmentMatches(entry.record, entry.expected) ? entry.record.attempts : 0;
    while (!entry.settled) {
      attempts += 1;
      const { prompt, nonce } = run.render(entry.job, entry.pairs);
      const response = await plugin.runGrader({
        prompt,
        model: entry.job.judge.model,
        limits: graderLimits,
        seed: seedFor(digest, attempts),
        input_sha256: digest,
      });
      calls += 1;
      if (!isObject(response)) throw new TypeError(`plugin ${plugin.id} returned no result object`);
      if (response.status === 'credential_error') throw credentialError(plugin.id, response.error);
      entry.record = recordFor(entry, run, response, attempts, nonce);
      options.store.writeJudgment(entry.record);
      entry.settled = judgmentSettled(entry.record, entry.expected);
    }
  }

  return { ...finish(run), calls };
}

/**
 * Builds a skill's result from stored judgments alone: no plugin, no call. Same arguments as
 * `runJudging` without `plugins` and `graderLimits`. If a judgment is missing or stale the result
 * is not built and `complete` is false. A stored result that is still current is returned as it
 * is; one made under another decision rule or from other inputs is rebuilt and stored again.
 */
function scoreSkill(options) {
  return { ...finish(prepare(options)), calls: 0 };
}

module.exports = {
  DEFAULT_GRADER_LIMITS,
  MAX_ATTEMPTS,
  runJudging,
  scoreSkill,
};
