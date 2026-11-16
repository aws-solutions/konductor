// SPDX-License-Identifier: Apache-2.0
/**
 * Claude Code subject runner: one locked-down `claude` process per answer, on Bedrock.
 *
 * One launch (subjectRun), in this order:
 *   1. Export fresh short-lived credentials for the profile (aws-credentials.js) and refuse to start when they expire
 *      within the call timeout (and never within 3 minutes). Make a fresh canary for this launch (redact.js newCanary).
 *   2. Reserve the call's upper estimate in the spend ledger: the larger of the subject model's p90 and the run's own
 *      budget cap (`runner.maxBudgetUsd`), because a run may cost up to its cap. A limit stops the run here, before any
 *      process starts.
 *   3. Make a private scratch folder (mode 0700) in the system temp folder, with an empty working directory and
 *      a private HOME inside it. Build the environment from nothing (subject-isolation.js subjectEnv: the three
 *      exported values, the canary, Bedrock switches, region, PATH, HOME), the settings with the deny rules, and
 *      the flags (runner.js subjectFlags: `--tools Skill`, no MCP server, no settings file, no saved session, the
 *      budget cap, the arm's plugin folder and agent).
 *   4. Send the request on stdin as one stream-json user message, write the raw event log to `<runDir>/raw.jsonl`
 *      (mode 0600), settle the ledger with the cost Claude Code reports, and delete the scratch folder. The raw log is
 *      written before the ledger is touched, so a ledger failure never loses what a paid call printed.
 *   5. Run the secret sweep (sweep.js) over the run folder. A value handed to the child (a credential or the canary)
 *      in any stored file quarantines the file and throws SecurityStopError, and so does a file the sweep could not
 *      scan (it is reported, not quarantined): the answer is not judged and the run stops. Other secret-shaped text is
 *      a warning; the redactor replaces it before a judge sees it.
 *   6. Read the trace (claude-trace.js) and check its text for the same values (trace-sweep.js): a value printed in
 *      pieces across turns is whole in the joined answer, though no file holds it. A hit quarantines the raw log
 *      like the file sweep does, with the pieces of the value redacted in the copy too, and throws SecurityStopError.
 *   7. Check the run. A run is invalid when
 *        - the `with` arm never loaded the skill,
 *        - the `without` arm loaded it,
 *        - no result event ended the run,
 *        - a model other than the subject produced output, or
 *        - the tools Claude Code reports go beyond the grant (Skill), or a tool outside it ran.
 *
 * runSubjectTask runs up to 3 launches for one task and arm. An invalid or failed run's raw log is renamed
 * `raw.jsonl.rejected-<time>` and kept, then the run is redone. After 3 invalid tries the task is `not_loaded`,
 * and the report gives the skill NO DATA. A credential error, a spend stop and a security stop are thrown and
 * never retried.
 *
 * Nothing here decides where a run folder lives or writes the answer record; the pairs runner does both.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const proc = require('./proc');
const { readClaudeCodeTrace } = require('./claude-trace');
const { REPO_ROOT, ARMS } = require('./layout');
const { SAFE_SEGMENT } = require('./names');
const { createRedactor, newCanary } = require('./redact');
const { classifyError, retryDelayMs } = require('./retry');
const { subjectFlags, toolsWithinGrant } = require('./runner');
const { DEFAULT_SETTINGS } = require('./sanitize');
const {
  subjectEnv,
  createPrivateHome,
  subjectSettings,
} = require('./subject-isolation');
const {
  quarantineFile,
  sweepRun,
  securityNote,
  warningNote,
} = require('./sweep');
const {
  sweepTrace,
  traceSecurityNote,
  redactTraceLog,
} = require('./trace-sweep');
const { fileTime, setAside, supersede } = require('./supersede');
const awsCredentials = require('./aws-credentials');
const { reservationFor } = require('./ledger');

const DEFAULT_SUBJECT_TIMEOUT_MS = 300000;
/** Launches per task and arm before the task is reported as not loaded. */
const MAX_TRIES = 3;
const RAW_LOG = 'raw.jsonl';
const REJECTED_MARK = '.rejected-';
const UNSAVED_MARK = '.unsaved-';
const MAX_UNSAVED_COPIES = 100;
// The scratch folder name starts with the sanitizer's scratch prefix, so a path the model repeats is removed
// from the answer before judging, like the arms' own folders.
const SCRATCH_PREFIX = `${DEFAULT_SETTINGS.scratchPrefix}-subject-`;
const ERROR_CHARS = 1000;
const LIST_ITEMS = 10;
// The one tool the subject is granted, as Claude Code names it.
const SKILL_TOOL = 'Skill';
/**
 * What runProblems says of a `with` run that never loaded the skill. It is the one reason for an invalid run that is
 * about the skill and not about the setup, so the pairs runner tells the two apart by this text.
 */
const NEVER_LOADED_PROBLEM = 'the with arm never loaded the skill';

/** The secret sweep found a value handed to the child, or could not scan a file. The run must stop. */
class SecurityStopError extends Error {
  constructor(note, sweep, cause = null) {
    super(note, cause ? { cause } : undefined);
    this.name = 'SecurityStopError';
    this.fatal = true;
    this.sweep = sweep;
  }
}

const quoteList = (items) =>
  items
    .slice(0, LIST_ITEMS)
    .map((item) => JSON.stringify(String(item).slice(0, 80)))
    .join(', ') + (items.length > LIST_ITEMS ? ', ...' : '');

/** One stream-json user message holding the request. */
const userMessage = (prompt) =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`;

/**
 * Whether the skill under test was loaded, from the event log only (never from the answer text):
 *   { loaded, attempts: [{ name, status }], otherSkillLoads: [name] }
 * `loaded` is true only when a call of Claude Code's own `Skill` tool, named `<plugin>:<skill>`, returned without an
 * error. The bare name does not count: for a skill named like one of Claude Code's own skills (`code-review`) it is
 * that skill, not the one under test. The tool is matched by its exact name: an MCP tool called `mcp__<server>__Skill`
 * is a different tool and never counts.
 */
function checkSkillLoad(trace, plugin, skill) {
  const attempts = trace.tool_calls
    .filter((call) => call.raw_tool_name === SKILL_TOOL)
    .map((call) => {
      const { skill: skillArgument, name: nameArgument } = call.arguments;
      const name =
        typeof skillArgument === 'string' && skillArgument
          ? skillArgument
          : typeof nameArgument === 'string' && nameArgument
            ? nameArgument
            : null;
      return { name, status: call.status };
    });
  const target = `${plugin}:${skill}`;
  const isTarget = (name) => name === target;
  return {
    loaded: attempts.some(
      (attempt) => isTarget(attempt.name) && attempt.status === 'completed',
    ),
    attempts,
    otherSkillLoads: attempts
      .filter(
        (attempt) => !isTarget(attempt.name) && attempt.status === 'completed',
      )
      .map((attempt) => attempt.name),
  };
}

/**
 * True when every model the result event reports is the subject model, and there is at least one. A `[1m]`-style
 * suffix (a context-window label) is ignored.
 */
function modelUsageOk(modelsUsed, model) {
  const bare = (name) => String(name).replace(/\[.*\]$/, '');
  return (
    Array.isArray(modelsUsed) &&
    modelsUsed.length > 0 &&
    modelsUsed.every((name) => bare(name) === model)
  );
}

/**
 * Why a run is invalid, as a list of short reasons; empty when it is valid. `skillLoad` comes from
 * checkSkillLoad, `runner` from runner.js forSkill.
 */
function runProblems({ arm, trace, skillLoad, model, runner }) {
  const problems = [];
  if (arm === 'with' && !skillLoad.loaded) problems.push(NEVER_LOADED_PROBLEM);
  if (arm === 'without' && skillLoad.loaded)
    problems.push('the without arm loaded the skill');
  // The models, the cost and the final answer come from the result event, so a log without one proves nothing.
  if (!trace.result_seen) problems.push('no result event ended the run');
  else if (!modelUsageOk(trace.models_used, model))
    problems.push(
      trace.models_used.length
        ? `a model other than the subject produced output: ${quoteList(trace.models_used)}`
        : 'the result event reports no model usage',
    );
  if (!toolsWithinGrant(trace.available_tools, runner))
    problems.push(
      trace.available_tools === null
        ? 'no init event lists the tools Claude Code loaded'
        : `the reported tools go beyond the grant: ${quoteList(trace.available_tools)}`,
    );
  // A tool that ran but is not in the grant means the restriction did not hold, whatever the init event said. The
  // exact name is compared, so `mcp__<server>__Skill` is not the granted Skill tool.
  const ranOutside = trace.tool_calls
    .filter((call) => call.status === 'completed')
    .filter((call) => !runner.tools.includes(call.raw_tool_name))
    .map((call) => call.raw_tool_name);
  if (ranOutside.length)
    problems.push(`a tool outside the grant ran: ${quoteList(ranOutside)}`);
  return problems;
}

const hasTokenCounts = (usage) =>
  !!usage &&
  [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
  ].some((field) => Number.isFinite(usage[field]) && usage[field] > 0);

function requirePlainFolder(description, folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw new TypeError(`${description} must be an absolute path`);
  if (!fs.lstatSync(folder).isDirectory())
    throw new Error(`${description} ${folder} is not a plain folder`);
}

function requireArms(arms, arm) {
  if (!ARMS.includes(arm))
    throw new TypeError(
      `arm must be one of ${ARMS.join(', ')}, got ${JSON.stringify(arm)}`,
    );
  if (
    !arms ||
    typeof arms.withDir !== 'string' ||
    typeof arms.withoutDir !== 'string' ||
    !arms.agentsJson ||
    typeof arms.agentsJson[arm] !== 'string' ||
    typeof arms.agent !== 'string' ||
    typeof arms.plugin !== 'string'
  )
    throw new TypeError('arms must come from arms.js buildArms');
}

/**
 * The default credential source: a fresh `aws configure export-credentials` for the configured profile.
 * `run` and `baseEnv` are passed through for tests.
 */
const exportForConfig =
  ({ run, baseEnv }) =>
  (config) =>
    awsCredentials.exportCredentials({
      profile: awsCredentials.resolveProfile(config, baseEnv),
      region: config.aws_region,
      run,
      baseEnv,
    });

/**
 * One subject launch. Returns
 *   { ok, valid, problems, text, trace, skillLoad, modelsUsed, tools, toolErrors, permissionDenials, usage,
 *     usageSource, reportedUsd, ms, timedOut, rawFile, sweepWarning, error, stderr }
 * and does not throw for a failed or invalid run: `ok` is false for a failed one (exit, timeout, an error
 * result, no answer) and `valid` is true only for an ok run with no problem.
 *
 * Throws, before any process starts, for bad input (`skill` must be a safe name), a raw log that already exists,
 * a credential problem (CredentialError) or a spend stop. Throws SecurityStopError after the run when the file sweep
 * is not clean or a value handed to the child is in the trace's text. When something else throws after the process
 * ran, the stored log gets the same two sweeps (sweepAfterThrow) and that error is rethrown as it is, with
 * `traceQuarantine` set when the log was quarantined for a value in the trace's text. When `raw.jsonl` cannot be written
 * (another job made it during the call), the paid output is kept as `raw.jsonl.unsaved-<time>`, swept like the
 * rest, and the write error is thrown after the call is settled.
 *
 * Options:
 *   ledger      createLedger(...) for this run
 *   config      the loaded settings (models.subject, aws_region, aws_profile and estimate_usd_per_call.subject, the
 *               fallback price, are read)
 *   arms        a buildArms result; `arm` is `with` or `without`
 *   skill       the skill under test; `runner` is forSkill(skill, ...)
 *   prompt      the request; `label` names the call in the ledger
 *   runDir      an existing folder for this task and arm, where the raw log goes and the sweep looks
 *   getCredentials  async (config) => { accessKeyId, secretAccessKey, sessionToken, expiration } (default: export
 *               for the configured profile). Their expiration must be at least `timeoutMs` away.
 *   costProfile the cost profile the run is reserved and charged from (cost-profile.js; default: the committed one).
 *               The run reserves the larger of the subject model's p90 and the runner's budget cap, and is charged the
 *               model's mean when Claude Code reports no cost.
 *   timeoutMs, run, bin, tmpRoot, userHome, repoRoot, baseEnv, now  for tests and the live check
 */
async function subjectRun({
  ledger,
  config,
  arms,
  arm,
  skill,
  runner,
  prompt,
  label,
  runDir,
  getCredentials = null,
  costProfile,
  timeoutMs = DEFAULT_SUBJECT_TIMEOUT_MS,
  run = proc.run,
  bin = 'claude',
  tmpRoot = os.tmpdir(),
  userHome = os.homedir(),
  repoRoot = REPO_ROOT,
  baseEnv = process.env,
  now = Date.now,
}) {
  if (!ledger || typeof ledger.reserve !== 'function')
    throw new TypeError('subjectRun: ledger is required (createLedger)');
  if (!config || !config.estimate_usd_per_call || !config.models)
    throw new TypeError('subjectRun: config is required (loadConfig)');
  requireArms(arms, arm);
  if (typeof skill !== 'string' || !SAFE_SEGMENT.test(skill))
    throw new TypeError(
      `subjectRun: skill must be a safe name, got ${JSON.stringify(skill)}`,
    );
  if (!runner || !Array.isArray(runner.tools) || !(runner.maxBudgetUsd > 0))
    throw new TypeError('subjectRun: runner must come from forSkill');
  if (typeof prompt !== 'string' || !prompt.trim())
    throw new TypeError('subjectRun: prompt must be a non-empty string');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('subjectRun: timeoutMs must be a number above 0');
  requirePlainFolder('runDir', runDir);
  const rawFile = path.join(runDir, RAW_LOG);
  if (fs.existsSync(rawFile))
    throw new Error(
      `${rawFile} already exists; set it aside before a new launch`,
    );
  const model = config.models.subject;
  const settings = subjectSettings({ userHome, repoRoot });

  const credentials = await (
    getCredentials || exportForConfig({ run, baseEnv })
  )(config);
  // The credentials must outlast the call, so the margin is the call timeout when that is longer than the default.
  awsCredentials.assertFresh(credentials, {
    now,
    label,
    marginMs: Math.max(awsCredentials.EXPIRY_MARGIN_MS, timeoutMs),
  });
  const canary = newCanary();
  const literals = [
    credentials.accessKeyId,
    credentials.secretAccessKey,
    credentials.sessionToken,
    canary,
  ];
  const redact = createRedactor({ literals });

  const price = reservationFor(config, 'subject', model, costProfile);
  // The run is allowed to cost up to its cap, so reserving only the p90 would let a call pass a limit by the
  // difference.
  const reservation = await ledger.reserve(
    Math.max(price.usd, runner.maxBudgetUsd),
    redact(label, { maxChars: Infinity }),
    {
      ...price.options,
      ttlMs: timeoutMs + 60000,
    },
  );
  let scratch = null;
  let started = false;
  let settleStarted = false;
  let stored = null;
  let outcome;
  try {
    scratch = fs.mkdtempSync(path.join(tmpRoot, SCRATCH_PREFIX));
    fs.chmodSync(scratch, 0o700);
    const cwd = path.join(scratch, 'work');
    fs.mkdirSync(cwd, { mode: 0o700 });
    const home = createPrivateHome(scratch);
    const env = subjectEnv({
      credentials,
      region: config.aws_region,
      home,
      canary,
      pathValue: baseEnv.PATH,
      userHome,
    });
    const args = subjectFlags({
      model,
      pluginDir: arm === 'with' ? arms.withDir : arms.withoutDir,
      agentsJson: arms.agentsJson[arm],
      agent: arms.agent,
      runner,
      settings,
    });
    started = true;
    const processResult = await run(bin, args, {
      cwd,
      env,
      stdin: userMessage(prompt),
      timeoutMs,
    });
    // What the paid call printed is stored before the ledger or the trace can fail.
    stored = storeRawLog(rawFile, processResult.stdout, now);
    const trace = readClaudeCodeTrace(processResult.stdout);
    const usable = hasTokenCounts(trace.usage);
    const ok =
      processResult.code === 0 &&
      !processResult.timedOut &&
      !processResult.overflow &&
      !trace.result_is_error &&
      trace.response_text.trim().length > 0;
    // The ledger charges the cost Claude Code reported (`total_cost_usd`); with none usable it charges the run's mean,
    // so a paid run is never booked as $0. The flag is set before the call: a reservation is settled once, so a
    // settle that threw is not tried again below.
    settleStarted = true;
    reservation.settle({
      model,
      usage: usable ? trace.usage : undefined,
      reportedUsd: trace.cost_usd ?? undefined,
      ok,
    });
    outcome = { processResult, trace, usable, ok };
  } catch (error) {
    // A throw after the process ran leaves its log in the run folder: sweep it before the error goes up.
    if (stored && stored.file) {
      const stop = sweepAfterThrow(error, {
        runDir,
        file: stored.file,
        literals,
        now,
      });
      if (stop) throw stop;
    }
    throw error;
  } finally {
    // Once a process may have started, a throw keeps the call counted at its mean. Before that it cost
    // nothing. The scratch folder is deleted whatever the ledger does.
    try {
      if (!settleStarted) {
        if (started) reservation.settle({ model, ok: false });
        else reservation.cancel();
      }
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  const { processResult, trace, usable, ok } = outcome;
  const sweep = sweepRun(runDir, { literals, quarantine: true, now });
  if (!sweep.clean) throw new SecurityStopError(securityNote(sweep), sweep);
  // The answer and the tool results are joined from several events, so a value printed in pieces is whole there and
  // in no file.
  const textSweep = sweepTrace(trace, { literals });
  if (!textSweep.clean) {
    let quarantined = null;
    let failure = null;
    if (stored.file) {
      try {
        quarantined = quarantineRawLog(runDir, stored.file, { literals, now });
      } catch (error) {
        // A log that cannot be set aside is reported, and the run stops all the same.
        failure = error;
      }
    }
    throw new SecurityStopError(
      traceSecurityNote(textSweep, {
        quarantined,
        quarantineFailed: failure !== null,
      }),
      textSweep,
      failure,
    );
  }
  if (stored.error)
    throw new Error(
      `could not write ${rawFile}: ${stored.error.message}; ${
        stored.file
          ? `the call's output is kept as ${stored.file}`
          : "the call's output could not be kept either"
      }`,
      { cause: stored.error },
    );

  const skillLoad = checkSkillLoad(trace, arms.plugin, skill);
  const problems = runProblems({ arm, trace, skillLoad, model, runner });
  let error = null;
  if (!ok) {
    if (trace.errors.length)
      error = trace.errors.map((entry) => entry.message).join(' | ');
    else if (processResult.timedOut) error = 'timeout';
    else if (processResult.overflow)
      error = 'output too large: the process was stopped';
    else if (processResult.code !== 0)
      error = `exit ${processResult.code}: ${processResult.stderr}`;
    else error = 'empty answer';
  }
  return {
    ok,
    valid: ok && problems.length === 0,
    problems,
    text: trace.response_text,
    trace,
    skillLoad,
    modelsUsed: trace.models_used,
    tools: trace.available_tools,
    toolErrors: trace.tool_calls.filter((call) => call.status === 'error')
      .length,
    permissionDenials: trace.permission_denials,
    usage: usable ? trace.usage : null,
    usageSource: usable ? 'stream' : 'none',
    reportedUsd: trace.cost_usd,
    ms: processResult.ms,
    timedOut: !!processResult.timedOut,
    rawFile,
    sweepWarning: warningNote(sweep),
    error: error === null ? null : redact(error, { maxChars: ERROR_CHARS }),
    stderr: redact(processResult.stderr, { maxChars: ERROR_CHARS }),
  };
}

/**
 * Quarantines the stored raw log (`file`, in `runDir`) the way the file sweep quarantines a file (sweep.js
 * quarantineFile): a mode 0600 copy `<name>~quarantined-<time>` and the original removed. The copy has the exact
 * values and every secret shape replaced, and also a value printed in pieces across events, which no line holds
 * whole (trace-sweep.js redactTraceLog). Returns the name of the copy. Throws when the copy cannot be made; the
 * original is then still there.
 */
function quarantineRawLog(runDir, file, { literals, now }) {
  const redactCopy = createRedactor({ literals, maxChars: Infinity });
  return quarantineFile(runDir, path.relative(runDir, file), {
    text: fs.readFileSync(file, 'utf8'),
    redactCopy: (text) => redactCopy(redactTraceLog(text, { literals })),
    now,
  });
}

/**
 * Sets `name` on a thrown value that takes properties. A thrown string, null or frozen error stays as it is.
 */
function annotate(thrown, name, value) {
  if (thrown === null || typeof thrown !== 'object') return;
  try {
    thrown[name] = value;
  } catch {
    // A frozen error keeps its shape.
  }
}

/**
 * The sweeps of the run folder after a throw that came once the raw log was stored: the file sweep, then the same
 * trace text check as after a normal return. Returns the SecurityStopError to throw in place of `thrown` when the
 * file sweep is not clean, and null otherwise, so `thrown` is rethrown as it is.
 *
 * A trace hit quarantines the raw log (quarantineRawLog) and sets `traceQuarantine` { quarantined, note } on the error
 * that goes up, `quarantined` being null when the copy could not be made. A sweep that throws never replaces the
 * error: its failure is set as `sweepFailure` and, when the error has no cause, as its `cause`.
 */
function sweepAfterThrow(thrown, { runDir, file, literals, now }) {
  const failures = [];
  let stop = null;
  try {
    const late = sweepRun(runDir, { literals, quarantine: true, now });
    if (!late.clean) stop = new SecurityStopError(securityNote(late), late);
  } catch (error) {
    failures.push(error);
  }
  const target = stop || thrown;
  try {
    // The file sweep may have set the log aside already; then there is nothing left to read.
    if (fs.existsSync(file)) {
      const textSweep = sweepTrace(
        readClaudeCodeTrace(fs.readFileSync(file, 'utf8')),
        { literals },
      );
      if (!textSweep.clean) {
        let quarantined = null;
        try {
          quarantined = quarantineRawLog(runDir, file, { literals, now });
        } catch (error) {
          failures.push(error);
        }
        annotate(target, 'traceQuarantine', {
          quarantined,
          note: traceSecurityNote(textSweep, {
            quarantined,
            quarantineFailed: quarantined === null,
          }),
        });
      }
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    const failure =
      failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'the sweeps of the run folder failed');
    annotate(target, 'sweepFailure', failure);
    if (target && typeof target === 'object' && target.cause === undefined)
      annotate(target, 'cause', failure);
  }
  return stop;
}

/**
 * Writes the output of a paid call to `rawFile` (mode 0600), never over a file that is already there. When that
 * fails, the output goes to `<rawFile>.unsaved-<time>` instead (`-2`, `-3`, ... after the time when the name is
 * taken), so a call that was paid for is never lost. Does not throw: returns { file, error }, where `file` is where
 * the output is (null when no write worked) and `error` is why the first write failed (null when it worked).
 */
function storeRawLog(rawFile, stdout, now) {
  const write = (target) =>
    fs.writeFileSync(target, stdout, { mode: 0o600, flag: 'wx' });
  try {
    write(rawFile);
    return { file: rawFile, error: null };
  } catch (error) {
    const base = `${rawFile}${UNSAVED_MARK}${fileTime(now)}`;
    for (let copy = 1; copy <= MAX_UNSAVED_COPIES; copy += 1) {
      const target = copy === 1 ? base : `${base}-${copy}`;
      try {
        write(target);
        return { file: target, error };
      } catch (retry) {
        if (retry.code !== 'EEXIST') break;
      }
    }
    return { file: null, error };
  }
}

/**
 * Up to `maxTries` launches of one task and arm (subjectRun takes the same options). Returns
 *   { status, result, tries: [{ ok, valid, problems, error, rejected }] }
 * where `status` is `ok` (the last launch is valid; its raw log is `<runDir>/raw.jsonl`), `not_loaded` (every try
 * was invalid) or `failed` (a failed try among them, or a failure that a retry cannot fix). Each rejected raw log
 * is kept as `raw.jsonl.rejected-<time>`. A raw log left by an earlier job is kept as
 * `raw.jsonl.superseded-<time>` before the first launch. A name that is already taken gets `-2`, `-3`, ... added
 * after the time, so no kept log is overwritten.
 *
 * Thrown and never retried: a credential problem (also one a failed run reports), a spend stop and a security
 * stop. A failure that a retry cannot fix (a missing model, an access denial) ends the tries at once.
 */
async function runSubjectTask({
  maxTries = MAX_TRIES,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryBaseMs,
  ...options
}) {
  if (!Number.isInteger(maxTries) || maxTries < 1)
    throw new TypeError('maxTries must be a whole number, 1 or more');
  const now = options.now || Date.now;
  requirePlainFolder('runDir', options.runDir);
  const rawFile = path.join(options.runDir, RAW_LOG);
  supersede(rawFile, now);
  const tries = [];
  let result = null;
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    if (attempt > 1)
      await sleep(
        retryDelayMs(
          attempt,
          retryBaseMs === undefined ? {} : { baseMs: retryBaseMs },
        ),
      );
    result = await subjectRun(options);
    const entry = {
      ok: result.ok,
      valid: result.valid,
      problems: result.problems,
      error: result.error,
      rejected: null,
    };
    tries.push(entry);
    if (result.valid) return { status: 'ok', result, tries };
    entry.rejected = path.basename(setAside(rawFile, REJECTED_MARK, now));
    if (!result.ok) {
      const kind = classifyError(
        new Error([result.error, result.stderr].filter(Boolean).join(' | ')),
      );
      if (kind === 'credential')
        throw new awsCredentials.CredentialError(
          `the subject run was refused for its credentials: ${result.error}`,
        );
      if (kind === 'permanent') break;
    }
  }
  const allInvalid = tries.every((entry) => entry.ok && !entry.valid);
  return { status: allInvalid ? 'not_loaded' : 'failed', result, tries };
}

module.exports = {
  DEFAULT_SUBJECT_TIMEOUT_MS,
  MAX_TRIES,
  NEVER_LOADED_PROBLEM,
  RAW_LOG,
  SCRATCH_PREFIX,
  SecurityStopError,
  userMessage,
  checkSkillLoad,
  modelUsageOk,
  runProblems,
  subjectRun,
  runSubjectTask,
};
