// SPDX-License-Identifier: Apache-2.0
/**
 * OpenCode judge client: one judge call through the OpenCode CLI on Bedrock.
 *
 * Each call gets a fresh private sandbox (mode 0700) with its own project config and its own XDG config,
 * data and state dirs, so no user config, MCP server, session database or background service is shared with
 * anything else. The config:
 *   - enables only the Bedrock provider and turns sharing off;
 *   - denies every tool, including any tool a newer OpenCode adds (`"*": "deny"`), and turns code execution
 *     off (`tools.execute: false`) so no fetch() runs. A judge gets everything it needs inside the prompt;
 *   - sets no AWS profile: credentials are the keys the job exported for its profile, else the parent's
 *     environment (lib/child-env.js).
 *
 * Model ids use the inference-profile form and must match MODEL_ID; anything else is refused before a
 * process starts or money is reserved. Every call reserves its upper estimate (the p90 of its kind and model in
 * the cost profile) in the spend ledger first, and settles the cost OpenCode reports after (the sum of its
 * per-step `cost`), success or not. A call that reports no usable cost is charged its mean, so a paid call is
 * never booked as $0, unless it ended before any model step started (`modelStarted` false): that call reached
 * no model and is charged 0. A model whose cost OpenCode reports low (`cliReportsLow` in the profile) is
 * charged at least its mean.
 * Error text is redacted before it is returned, with the exported secret key and session token removed exactly.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const proc = require('./proc');
const { childEnv, CREDENTIAL_VARS } = require('./child-env');
const { redact, createRedactor } = require('./redact');
const { readOpenCodeTrace } = require('./opencode-trace');
const { reservationFor } = require('./ledger');

const MODEL_ID = /^[A-Za-z0-9._:/-]{3,120}$/;
// A reasoning-effort level is appended to the model as OpenCode's `#<variant>` suffix, so it gets its own
// strict pattern: MODEL_ID rejects `#` on purpose. OpenCode itself rejects a level the model's catalog entry
// does not have ("Variant unavailable for ..."), before any model call.
const REASONING_EFFORT = /^[a-z]{3,10}$/;
const SESSION_ID = /"sessionID":"(ses_[A-Za-z0-9_]{1,100})"/;
const PROVIDER = 'amazon-bedrock';
const SESSION_EXPORT_TIMEOUT_MS = 60000;
const VERSION_TIMEOUT_MS = 30000;
// Linux refuses a single argument longer than 128 KiB (MAX_ARG_STRLEN) with E2BIG. The prompt is one
// argument, so a longer one is refused here, before money is reserved, with a reason a person can act on.
const MAX_PROMPT_BYTES = 128 * 1024 - 1;
/** The kinds of OpenCode call, each priced by its own cost profile entry (cost-profile.js): a judgment, a checklist. */
const CALL_KINDS = Object.freeze(['judge', 'writer']);
// The longest call timeout judgeCall accepts: the upper bound config.js allows for judge_timeout_ms.
const MAX_CALL_TIMEOUT_MS = 3600000;
const ERROR_CHARS = 400;
const STDERR_CHARS = 2000;

// Pinned judge models that need an OpenCode model entry of their own, because OpenCode's catalog default
// output cap for them is wrong for a judge reply. Newer OpenCode versions refuse a custom entry without
// `limit.context`, so the entry carries the model's short-context limit too.
const TERRA_MODEL_ID = 'us.openai.gpt-6.1-terra';
const MODEL_CONFIGS = Object.freeze({
  [TERRA_MODEL_ID]: Object.freeze({
    configId: 'benchmark-gpt-6-1-terra',
    contextTokens: 272000,
    outputTokens: 128000,
  }),
});

// Tools denied by name as well as by "*", so a reader of the config sees what is closed.
const DENIED_TOOLS = Object.freeze([
  'read',
  'glob',
  'grep',
  'list',
  'edit',
  'bash',
  'webfetch',
  'websearch',
  'task',
  'external_directory',
  'todowrite',
  'question',
  'lsp',
  'skill',
  'doom_loop',
]);

// Own keys only: a model id such as `constructor` passes MODEL_ID and must not read Object.prototype.
const modelConfigFor = (modelId) =>
  Object.hasOwn(MODEL_CONFIGS, modelId) ? MODEL_CONFIGS[modelId] : undefined;

/** The lockdown config written into a call's sandbox. `region` is the Bedrock region (config.aws_region). */
function judgeConfig({ modelId = null, region }) {
  if (typeof region !== 'string' || !region)
    throw new TypeError('judgeConfig: region is required (config.aws_region)');
  const bedrock = { settings: { region } };
  const modelConfig = modelConfigFor(modelId);
  if (modelConfig) {
    bedrock.models = {
      [modelConfig.configId]: {
        // Both spellings of the Bedrock model id: newer OpenCode versions read `id`, older ones `modelID`.
        id: modelId,
        modelID: modelId,
        limit: {
          context: modelConfig.contextTokens,
          output: modelConfig.outputTokens,
        },
        settings: { maxTokens: modelConfig.outputTokens },
      },
    };
  }
  const permission = { '*': 'deny' };
  for (const tool of DENIED_TOOLS) permission[tool] = 'deny';
  return {
    $schema: 'https://opencode.ai/config.json',
    enabled_providers: [PROVIDER],
    share: 'disabled',
    // Both spellings: OpenCode versions differ in which key they read.
    provider: { [PROVIDER]: bedrock },
    providers: { [PROVIDER]: bedrock },
    permission,
    tools: { execute: false },
  };
}

/** The model name OpenCode is given: the config id for a model with its own entry, else the model id. */
const opencodeModelId = (modelId) =>
  modelConfigFor(modelId)?.configId || modelId;

function assertModelId(modelId) {
  if (typeof modelId !== 'string' || !MODEL_ID.test(modelId))
    throw new Error(
      `refusing to run: unsafe model id ${JSON.stringify(String(modelId).slice(0, 60))}`,
    );
}

/**
 * The `-m` argument of `opencode run`: amazon-bedrock/<model>, plus `#<effort>` when a reasoning effort is set.
 * The effort is not part of the model id: the model id is what judgment provenance records, and a runtime
 * setting must not make stored judgments stale.
 */
function modelArg(modelId, reasoningEffort = null) {
  assertModelId(modelId);
  const base = `${PROVIDER}/${opencodeModelId(modelId)}`;
  if (reasoningEffort === null || reasoningEffort === undefined) return base;
  if (!REASONING_EFFORT.test(String(reasoningEffort)))
    throw new Error(
      `refusing to run: unsafe reasoning effort ${JSON.stringify(String(reasoningEffort).slice(0, 20))}`,
    );
  return `${base}#${reasoningEffort}`;
}

/**
 * The call timeout of a judge seat: config.judge_timeout_ms_by_seat[seat], else config.judge_timeout_ms.
 * loadConfig has checked both, so this only reads them.
 */
function judgeTimeoutMs(config, seat) {
  const bySeat = config.judge_timeout_ms_by_seat || {};
  return Object.hasOwn(bySeat, seat) ? bySeat[seat] : config.judge_timeout_ms;
}

/**
 * Environment for one judge call: the parent's environment through childEnv (no profile), with OpenCode's
 * config, data and state dirs pointed into the call's sandbox, so that the user's global OpenCode config
 * (which can declare MCP servers) is not loaded and no session database or server state is shared. Tool
 * shims that find their own data through XDG_* (mise) have their dirs pinned to the current values first.
 *
 * `credentials` ({ accessKeyId, secretAccessKey, sessionToken }, exported by the job for the configured profile)
 * replace every credential variable of the parent, as for the subject runner: OpenCode reads no profile, so
 * without them a call made from a shell with no AWS_PROFILE would have no credentials at all.
 */
function judgeEnv(sandbox, { region, base = process.env, credentials } = {}) {
  const home = base.HOME || os.homedir();
  const xdg = (name, fallback) => base[name] || path.join(home, fallback);
  const pinned = {};
  const pin = (name, xdgName, fallback) => {
    if (base[name] === undefined)
      pinned[name] = path.join(xdg(xdgName, fallback), 'mise');
  };
  pin('MISE_DATA_DIR', 'XDG_DATA_HOME', '.local/share');
  pin('MISE_CONFIG_DIR', 'XDG_CONFIG_HOME', '.config');
  pin('MISE_CACHE_DIR', 'XDG_CACHE_HOME', '.cache');
  pin('MISE_STATE_DIR', 'XDG_STATE_HOME', '.local/state');
  return childEnv({
    region,
    base: credentials ? withoutCredentialVars(base) : base,
    extra: {
      ...pinned,
      ...(credentials ? credentialVars(credentials) : {}),
      XDG_CONFIG_HOME: sandbox.xdgConfig,
      XDG_DATA_HOME: sandbox.xdgData,
      XDG_STATE_HOME: sandbox.xdgState,
      OPENCODE_CONFIG: path.join(sandbox.project, 'opencode.json'),
      OPENCODE_DISABLE_AUTOUPDATE: '1',
    },
  });
}

const withoutCredentialVars = (base) =>
  Object.fromEntries(
    Object.entries(base).filter(([name]) => !CREDENTIAL_VARS.test(name)),
  );

/** The AWS variables of exported credentials; a missing key or secret is refused, a missing token is left out. */
function credentialVars(credentials) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials;
  if (
    typeof accessKeyId !== 'string' ||
    !accessKeyId ||
    typeof secretAccessKey !== 'string' ||
    !secretAccessKey
  )
    throw new TypeError(
      'judgeEnv: credentials must have accessKeyId and secretAccessKey',
    );
  return {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    ...(typeof sessionToken === 'string' && sessionToken
      ? { AWS_SESSION_TOKEN: sessionToken }
      : {}),
  };
}

// The redactor refuses a literal under 8 characters (it would remove ordinary words); a real secret is far longer.
const MIN_SECRET_CHARS = 8;
/** The secret parts of exported credentials, as literals for the redactor. The key id is public and has a pattern. */
const exportedSecrets = ({ secretAccessKey, sessionToken }) =>
  [secretAccessKey, sessionToken].filter(
    (value) => typeof value === 'string' && value.length >= MIN_SECRET_CHARS,
  );

// Sandboxes of calls still in flight when the process exits (an abort from another pool worker calls
// process.exit) are removed here, so no session database with judged answers is left in the temp dir.
const liveSandboxes = new Set();
let sandboxHookInstalled = false;
function removeSandbox(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort: the temp dir is the OS's to clean */
  }
  liveSandboxes.delete(root);
}

/** Creates a call's sandbox (mode 0700, config file 0600) under `tmpRoot` and writes the lockdown config. */
function makeSandbox({ modelId = null, region, tmpRoot = os.tmpdir() }) {
  const config = judgeConfig({ modelId, region });
  if (!sandboxHookInstalled) {
    sandboxHookInstalled = true;
    process.on('exit', () => {
      for (const root of liveSandboxes) removeSandbox(root);
    });
  }
  const root = fs.mkdtempSync(path.join(tmpRoot, 'bench-judge-'));
  liveSandboxes.add(root);
  fs.chmodSync(root, 0o700);
  const sandbox = {
    root,
    project: path.join(root, 'project'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgData: path.join(root, 'xdg-data'),
    xdgState: path.join(root, 'xdg-state'),
  };
  for (const dir of [
    sandbox.project,
    sandbox.xdgConfig,
    sandbox.xdgData,
    sandbox.xdgState,
  ])
    fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(
    path.join(sandbox.project, 'opencode.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  return sandbox;
}

/**
 * Rough token counts for a reply whose usage could not be read. The record then shows that the call used tokens, so
 * a reported cost of $0 for it is not taken as its cost and the ledger charges the reservation.
 */
function estimateUsage(prompt, text) {
  return {
    input_tokens: Math.ceil(String(prompt).length / 3),
    output_tokens: Math.ceil(String(text || '').length / 3) + 2000,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

const hasTokenCounts = (usage) =>
  !!usage &&
  [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
  ].some((field) => Number.isFinite(usage[field]) && usage[field] > 0);

/**
 * Whether this OpenCode's `run` command has `--standalone` (older versions need it; newer ones have no such flag
 * and print their usage with exit 1 when given it). Read once per process from `opencode run --help`, per runner
 * and binary, in the call's sandbox and environment. The pending read is shared, so the first wave of a worker pool
 * runs one probe, not one per worker. A help text that cannot be read is asked once more; when the second read fails
 * too, the read rejects with a StandaloneProbeError and is not remembered, so a later call asks again. Guessing
 * would be worse: an older OpenCode run without the flag hangs until the call's timeout.
 */
class StandaloneProbeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StandaloneProbeError';
  }
}
const PROBE_ATTEMPTS = 2;
const standaloneByRunner = new WeakMap();
function standaloneSupported({ run, bin, sandbox, env }) {
  let byBin = standaloneByRunner.get(run);
  if (!byBin) {
    byBin = new Map();
    standaloneByRunner.set(run, byBin);
  }
  if (!byBin.has(bin)) {
    const pending = probeStandalone({ run, bin, sandbox, env });
    byBin.set(bin, pending);
    pending.catch(() => {
      if (byBin.get(bin) === pending) byBin.delete(bin);
    });
  }
  return byBin.get(bin);
}
async function probeStandalone({ run, bin, sandbox, env }) {
  let lastResult = null;
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const result = await run(bin, ['run', '--help'], {
      cwd: sandbox.project,
      env,
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    const helpText = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (!result.timedOut && /--format\b/.test(helpText))
      return /(^|\s)--standalone\b/m.test(helpText);
    lastResult = result;
  }
  const why = lastResult.timedOut
    ? 'timed out'
    : `exit ${lastResult.code}, no --format option in the text`;
  throw new StandaloneProbeError(
    `cannot read \`${bin} run --help\` (${why}, ${PROBE_ATTEMPTS} tries), so it is unknown whether this OpenCode needs --standalone`,
  );
}

/**
 * Usage from `opencode session export`, for models that emit no step_finish event (so the stream carries
 * no usage). The export always has info.tokens and info.cost. Returns null when it cannot be read.
 */
async function exportedUsage({
  run,
  bin,
  sessionId,
  sandbox,
  env,
  standalone,
}) {
  const result = await run(
    bin,
    ['session', 'export', ...(standalone ? ['--standalone'] : []), sessionId],
    {
      cwd: sandbox.project,
      env,
      timeoutMs: SESSION_EXPORT_TIMEOUT_MS,
    },
  );
  if (result.code !== 0 || result.timedOut) return null;
  try {
    const { info } = JSON.parse(result.stdout);
    const tokens = (info && info.tokens) || {};
    const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
    return {
      usage: {
        input_tokens: count(tokens.input),
        output_tokens: count(tokens.output) + count(tokens.reasoning),
        cache_read_tokens: count(tokens.cache?.read),
        cache_write_tokens: count(tokens.cache?.write),
      },
      reportedUsd:
        typeof info.cost === 'number' && Number.isFinite(info.cost)
          ? info.cost
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * One judge call. Returns
 *   { ok, text, usage, usageSource, reportedUsd, modelStarted, ms, toolCalls, timedOut, error, stderr, reasoningEffort }
 * and does not throw for a failed call: `ok` is false and `error` says why (redacted). It throws, before any
 * process starts and before money is reserved, for an unsafe model id or effort, a prompt too long to pass,
 * or a stale credential (`credentialGuard.assertFresh` throws). A spend stop from the ledger is thrown too.
 *
 * `ledger` is createLedger(...) for this run, `config` the loaded settings (aws_region and
 * estimate_usd_per_call, the fallback price, are read from it). `callKind` is `judge` (the default) or `writer`, for a
 * request-only checklist call: the call reserves the p90 of that kind and model from the cost profile
 * (`costProfile`, the committed one by default), and the ledger charges its mean when the CLI reports no usable
 * cost. `timeoutMs` defaults to config.judge_timeout_ms and may not exceed MAX_CALL_TIMEOUT_MS; use
 * judgeTimeoutMs(config, seat) for a seat. `usageSource` is stream, session-export, char-estimate or none.
 * `credentials` are the keys the job exported for its profile (see judgeEnv); without them the call uses the
 * parent's credential variables.
 * `run`, `bin`, `tmpRoot` and `baseEnv` exist for tests.
 */
async function judgeCall({
  ledger,
  config,
  modelId,
  prompt,
  label,
  timeoutMs,
  callKind = 'judge',
  reasoningEffort = null,
  credentialGuard = null,
  credentials = null,
  costProfile,
  run = proc.run,
  bin = 'opencode',
  tmpRoot = os.tmpdir(),
  baseEnv = process.env,
}) {
  const model = modelArg(modelId, reasoningEffort);
  if (!ledger || typeof ledger.reserve !== 'function')
    throw new TypeError('judgeCall: ledger is required (createLedger)');
  if (!config || !config.estimate_usd_per_call)
    throw new TypeError('judgeCall: config is required (loadConfig)');
  if (!CALL_KINDS.includes(callKind))
    throw new TypeError(
      `judgeCall: callKind must be one of ${CALL_KINDS.join(', ')}, got ${JSON.stringify(callKind)}`,
    );
  if (typeof prompt !== 'string' || !prompt.trim())
    throw new TypeError('judgeCall: prompt must be a non-empty string');
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES)
    throw new RangeError(
      `refusing to run: the judge prompt is ${Buffer.byteLength(prompt, 'utf8')} bytes, above the ${MAX_PROMPT_BYTES}-byte limit of one command-line argument`,
    );
  const callTimeoutMs = timeoutMs ?? config.judge_timeout_ms;
  if (
    !Number.isFinite(callTimeoutMs) ||
    callTimeoutMs <= 0 ||
    callTimeoutMs > MAX_CALL_TIMEOUT_MS
  )
    throw new TypeError(
      `judgeCall: timeoutMs must be a number above 0 and at most ${MAX_CALL_TIMEOUT_MS}`,
    );
  if (credentialGuard) credentialGuard.assertFresh(label);
  if (credentials) credentialVars(credentials);
  // The exported keys are known values, so they are removed exactly, on top of the secret patterns.
  const redactText = credentials
    ? createRedactor({ literals: exportedSecrets(credentials) })
    : redact;

  // The reservation must outlive the call and its usage export, or a slow call would read as unaccounted for.
  const price = reservationFor(config, callKind, modelId, costProfile);
  const reservation = await ledger.reserve(price.usd, label, {
    ...price.options,
    ttlMs: callTimeoutMs + SESSION_EXPORT_TIMEOUT_MS + 60000,
  });
  let sandbox;
  try {
    sandbox = makeSandbox({ modelId, region: config.aws_region, tmpRoot });
  } catch (error) {
    reservation.cancel();
    throw error;
  }
  let settled = false;
  try {
    const env = judgeEnv(sandbox, {
      region: config.aws_region,
      base: baseEnv,
      credentials,
    });
    // --standalone, where this OpenCode has it, on every opencode command: a private server for this call only.
    // Without it an older `opencode run` talks to a long-lived background service that keeps the environment
    // of whichever session started it, so fresh credentials are never seen and every call hangs until the
    // timeout. Newer versions have no background service and no such flag.
    let standalone;
    try {
      standalone = await standaloneSupported({ run, bin, sandbox, env });
    } catch (error) {
      if (!(error instanceof StandaloneProbeError)) throw error;
      // No judge process started, so no model was reached: the call is charged 0.
      settled = true;
      reservation.settle({ model: modelId, ok: false, modelStarted: false });
      return {
        ok: false,
        text: '',
        usage: null,
        usageSource: 'none',
        reportedUsd: null,
        modelStarted: false,
        ms: 0,
        toolCalls: 0,
        timedOut: false,
        error: redactText(error.message, { maxChars: ERROR_CHARS }),
        stderr: '',
        reasoningEffort: reasoningEffort ?? null,
      };
    }
    const result = await run(
      bin,
      [
        'run',
        ...(standalone ? ['--standalone'] : []),
        '--format',
        'json',
        '--auto',
        '-m',
        model,
        prompt,
      ],
      { cwd: sandbox.project, env, timeoutMs: callTimeoutMs },
    );
    const trace = readOpenCodeTrace(result.stdout);
    let usage = trace.usage;
    let reportedUsd = trace.cost_usd;
    let usageSource = hasTokenCounts(usage) ? 'stream' : 'none';
    if (usageSource === 'none') {
      const sessionId = (result.stdout.match(SESSION_ID) || [])[1];
      const exported = sessionId
        ? await exportedUsage({
            run,
            bin,
            sessionId,
            sandbox,
            env,
            standalone,
          })
        : null;
      if (exported && hasTokenCounts(exported.usage)) {
        usage = exported.usage;
        reportedUsd = exported.reportedUsd ?? reportedUsd;
        usageSource = 'session-export';
      }
    }
    const traceError = trace.errors.length
      ? redactText(trace.errors.map((entry) => entry.message).join(' | '), {
          maxChars: ERROR_CHARS,
        })
      : null;
    // A tool that ran means the lockdown did not hold, so the reply is not used.
    const toolsRan = trace.tool_calls.filter(
      (call) => call.status === 'completed',
    ).length;
    const ok =
      result.code === 0 &&
      !result.timedOut &&
      !result.overflow &&
      !traceError &&
      toolsRan === 0 &&
      trace.response_text.trim().length > 0;
    if (usageSource === 'none' && ok) {
      usage = estimateUsage(prompt, trace.response_text);
      usageSource = 'char-estimate';
    }
    const stderr = redactText(result.stderr, { maxChars: STDERR_CHARS });
    let error = null;
    if (!ok) {
      if (traceError) error = traceError;
      else if (result.timedOut) error = 'timeout';
      else if (result.overflow)
        error = 'output too large: the process was stopped';
      else if (toolsRan)
        error = `the judge ran ${toolsRan} tool(s) although every tool is denied; the reply is not used`;
      else if (result.code !== 0)
        error = `exit ${result.code}: ${redactText(result.stderr, { maxChars: ERROR_CHARS })}`;
      else error = 'empty reply';
    }
    // The ledger charges the cost OpenCode reported; with none it charges the call's mean, so a failed call is never
    // booked as $0. A call that ended on its own before any model step (a flag, a config or a model id the CLI
    // refused) reached no model and is charged 0. A timeout or a flood may have reached one, so it keeps the mean, and
    // so does a process killed by a signal (exit code null): the request may already have gone out.
    const settledUsage = usageSource === 'none' ? undefined : usage;
    const modelStarted =
      trace.step_started ||
      usageSource !== 'none' ||
      !!result.timedOut ||
      !!result.overflow ||
      result.code === null;
    // A settle that throws (a full disk) leaves the reservation open: `settled` is set first so the `finally`
    // below does not settle a second time, which would replace this error with "already settled".
    settled = true;
    reservation.settle({
      model: modelId,
      usage: settledUsage,
      reportedUsd: reportedUsd ?? undefined,
      ok,
      modelStarted,
    });
    return {
      ok,
      text: trace.response_text,
      usage: settledUsage ?? null,
      usageSource,
      reportedUsd: reportedUsd ?? null,
      modelStarted,
      ms: result.ms,
      toolCalls: trace.tool_calls.length,
      timedOut: !!result.timedOut,
      error,
      stderr,
      reasoningEffort: reasoningEffort ?? null,
    };
  } finally {
    // A throw between the reservation and the settle (a bug, a failed spawn helper) keeps the call counted
    // at its mean rather than dropping it: it may have reached the provider. When the settle itself failed,
    // the reservation stays open: it counts as in flight until its timeout, then as spent at its p90.
    try {
      if (!settled) reservation.settle({ model: modelId, ok: false });
    } finally {
      removeSandbox(sandbox.root);
    }
  }
}

/**
 * Turns a failed judgeCall result into an Error for lib/retry.js, which sorts it by its message: a credential
 * error, a provider refusal, a permanent error, or anything else (a timeout, a throttle) to retry. The message
 * holds the redacted error and stderr, so the classes that only stderr shows are still seen.
 */
function judgeCallError(result) {
  const message = [result.error, result.stderr].filter(Boolean).join(' | ');
  return new Error(message || 'judge call failed');
}

/**
 * The OpenCode version, for judgment provenance. Runs `opencode --version` in a throw-away sandbox with the
 * same environment as a judge call, so it reads no user config. Returns the trimmed first line, or throws.
 */
async function readOpenCodeVersion({
  region,
  run = proc.run,
  bin = 'opencode',
  tmpRoot = os.tmpdir(),
  baseEnv = process.env,
}) {
  const sandbox = makeSandbox({ region, tmpRoot });
  try {
    const result = await run(bin, ['--version'], {
      cwd: sandbox.project,
      env: judgeEnv(sandbox, { region, base: baseEnv }),
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    const version = String(result.stdout).trim().split('\n')[0].trim();
    if (result.code !== 0 || !/^[0-9A-Za-z.+_-]{1,64}$/.test(version))
      throw new Error(
        `cannot read the OpenCode version (exit ${result.code}): ${redact(result.stderr || result.stdout, { maxChars: ERROR_CHARS })}`,
      );
    return version;
  } finally {
    removeSandbox(sandbox.root);
  }
}

module.exports = {
  MODEL_ID,
  CALL_KINDS,
  DENIED_TOOLS,
  MAX_PROMPT_BYTES,
  MAX_CALL_TIMEOUT_MS,
  judgeConfig,
  opencodeModelId,
  modelArg,
  judgeTimeoutMs,
  judgeEnv,
  makeSandbox,
  estimateUsage,
  judgeCall,
  judgeCallError,
  readOpenCodeVersion,
};
