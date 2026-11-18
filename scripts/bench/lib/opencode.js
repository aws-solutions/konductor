// SPDX-License-Identifier: Apache-2.0
/**
 * OpenCode judge client: one judge call through the OpenCode CLI on Bedrock.
 *
 * Each call gets a fresh private sandbox (mode 0700) with its own project config, its own home and its own XDG
 * config, data and state dirs, so no user config, MCP server, plugin, session database or background service is shared
 * with anything else. OpenCode merges every opencode.json and loads every .opencode/plugin file it finds walking up
 * from its working directory, and loads ~/.opencode too (checked with 1.19.5), so the sandbox is cut off from both:
 * its root holds a minimal git directory, which ends the walk-up there (a project directory is bounded by its git
 * root), and HOME is the sandbox's own `home`. The config:
 *   - enables only the Bedrock provider and turns sharing off;
 *   - denies every tool, including any tool a newer OpenCode adds (`"*": "deny"`), and turns code execution
 *     off (`tools.execute: false`) so no fetch() runs. A judge gets everything it needs inside the prompt;
 *   - sets no AWS profile: credentials are the keys the job exported for its profile, else the parent's
 *     environment (lib/child-env.js).
 *
 * Model ids use the inference-profile form and must match MODEL_ID; anything else is refused before a
 * process starts or money is reserved. Every model gets an OpenCode model entry of its own whose output limit is
 * the setting judge_max_output_tokens (or the seat's entry in judge_max_output_tokens_by_seat), so no reply can run
 * past it. Every call reserves its ceiling in the spend
 * ledger first: the tokens of its prompt plus that output limit, at the model's token prices in the cost profile
 * (a model with no prices there is reserved at its p90 instead). It settles the cost OpenCode reports after (the
 * sum of its per-step `cost`), success or not. A call that reports no usable cost is charged its mean, so a paid
 * call is
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
const { callCeiling, judgeMaxOutputTokens } = require('./call-ceiling');

const MODEL_ID = /^[A-Za-z0-9._:/-]{3,120}$/;
// A reasoning-effort level is appended to the model as OpenCode's `#<variant>` suffix, so it gets its own
// strict pattern: MODEL_ID rejects `#` on purpose. OpenCode itself rejects a level the model's catalog entry
// does not have ("Variant unavailable for ..."), before any model call.
const REASONING_EFFORT = /^[a-z]{3,10}$/;
const SESSION_ID = /"sessionID":"(ses_[A-Za-z0-9_]{1,100})"/;
const PROVIDER = 'amazon-bedrock';
// A fixed session title. Without --title, OpenCode starts the session with a default title and then makes a second
// model call to write a real one, and that call sends the first user message (the whole judge prompt, answer included)
// to the provider's small model. Its tokens are not in the session's step_finish events, so the ledger never sees it. A
// title that is not the default makes OpenCode skip that call.
const SESSION_TITLE = 'bench-judge';
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

// Every judge model gets an OpenCode model entry of its own, with an output limit from judge_max_output_tokens
// and judge_max_output_tokens_by_seat:
// the catalog default for a model can be far above what a judge reply needs, and the limit is what stops a runaway
// reply. Newer OpenCode versions refuse a custom entry without `limit.context`, so the entry carries a context limit
// too. A one-shot call sends at most MAX_PROMPT_BYTES, well inside every context below. The names and context limits
// here are the pinned models'; any other model gets a name made from its id and DEFAULT_CONTEXT_TOKENS.
const TERRA_MODEL_ID = 'us.openai.gpt-6.1-terra';
const MODEL_CONFIGS = Object.freeze({
  [TERRA_MODEL_ID]: Object.freeze({
    configId: 'benchmark-gpt-6-1-terra',
    contextTokens: 272000,
  }),
});
const DEFAULT_CONTEXT_TOKENS = 200000;
/** The range both output limit settings may take (config.js checks the same one). */
const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 128000;

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

/** The name of a model's entry in the call's config: the pinned name, else `benchmark-` and the id in lowercase words. */
const configIdFor = (modelId) =>
  modelConfigFor(modelId)?.configId ||
  `benchmark-${modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

const isOutputLimit = (value) =>
  Number.isInteger(value) &&
  value >= MIN_OUTPUT_TOKENS &&
  value <= MAX_OUTPUT_TOKENS;

/**
 * The lockdown config written into a call's sandbox. `region` is the Bedrock region (config.aws_region). With a
 * `modelId` the config holds that model's entry, with `maxOutputTokens` as its output limit; a config for no model
 * (the version probe) has none.
 */
function judgeConfig({ modelId = null, region, maxOutputTokens }) {
  if (typeof region !== 'string' || !region)
    throw new TypeError('judgeConfig: region is required (config.aws_region)');
  const bedrock = { settings: { region } };
  if (modelId !== null) {
    if (!isOutputLimit(maxOutputTokens))
      throw new TypeError(
        `judgeConfig: maxOutputTokens must be a whole number from ${MIN_OUTPUT_TOKENS} to ${MAX_OUTPUT_TOKENS}`,
      );
    bedrock.models = {
      [configIdFor(modelId)]: {
        // Both spellings of the Bedrock model id: newer OpenCode versions read `id`, older ones `modelID`.
        id: modelId,
        modelID: modelId,
        limit: {
          context:
            modelConfigFor(modelId)?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
          output: maxOutputTokens,
        },
        settings: { maxTokens: maxOutputTokens },
      },
    };
  }
  const permission = { '*': 'deny' };
  for (const tool of DENIED_TOOLS) permission[tool] = 'deny';
  return {
    $schema: 'https://opencode.ai/config.json',
    enabled_providers: [PROVIDER],
    // Any call OpenCode makes to a small model (the session title, if --title were ever dropped) goes to the seat's own
    // model, never to another provider's model such as a Claude Haiku for an OpenAI or xAI seat.
    ...(modelId === null
      ? {}
      : { small_model: `${PROVIDER}/${configIdFor(modelId)}` }),
    share: 'disabled',
    // Both spellings: OpenCode versions differ in which key they read.
    provider: { [PROVIDER]: bedrock },
    providers: { [PROVIDER]: bedrock },
    permission,
    tools: { execute: false },
  };
}

/** The model name OpenCode is given: the name of the model's entry in the call's config. */
const opencodeModelId = (modelId) => configIdFor(modelId);

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
 * Environment for one judge call: the parent's environment through childEnv (no profile), with HOME and OpenCode's
 * config, data and state dirs pointed into the call's sandbox, so that the user's global OpenCode config and
 * ~/.opencode (which can declare MCP servers and plugins) are not loaded and no session database or server state is
 * shared. What finds its data through the real HOME or XDG_* is pinned to the current values first: tool shims
 * (mise), the AWS shared config and credentials files, and the OpenCode cache (a catalog download, not config).
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
  // HOME is the sandbox's, so what the AWS SDK and OpenCode read through it must point at the real files.
  for (const [name, file] of [
    ['AWS_CONFIG_FILE', 'config'],
    ['AWS_SHARED_CREDENTIALS_FILE', 'credentials'],
  ])
    if (base[name] === undefined) pinned[name] = path.join(home, '.aws', file);
  pinned.XDG_CACHE_HOME = xdg('XDG_CACHE_HOME', '.cache');
  return childEnv({
    region,
    base: credentials ? withoutCredentialVars(base) : base,
    extra: {
      ...pinned,
      ...(credentials ? credentialVars(credentials) : {}),
      HOME: sandbox.home,
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

/**
 * Creates a call's sandbox (mode 0700, config file 0600) under `tmpRoot` and writes the lockdown config, with the
 * model's entry when `modelId` is given (then `maxOutputTokens` is its output limit). `home` is the HOME of the call.
 * `.git` is the smallest directory git accepts as a repository (HEAD, objects, refs): it makes the sandbox root the
 * git root of the project directory, and OpenCode stops looking for opencode.json and .opencode there instead of
 * reading what sits in the temp dir or above it.
 */
function makeSandbox({
  modelId = null,
  region,
  maxOutputTokens,
  tmpRoot = os.tmpdir(),
}) {
  const config = judgeConfig({ modelId, region, maxOutputTokens });
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
    home: path.join(root, 'home'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgData: path.join(root, 'xdg-data'),
    xdgState: path.join(root, 'xdg-state'),
  };
  const gitDir = path.join(root, '.git');
  for (const dir of [
    sandbox.project,
    sandbox.home,
    sandbox.xdgConfig,
    sandbox.xdgData,
    sandbox.xdgState,
    gitDir,
    path.join(gitDir, 'objects'),
    path.join(gitDir, 'refs'),
  ])
    fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', {
    mode: 0o600,
    flag: 'wx',
  });
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
  /** `stderr` is the last probe's stderr as read (not yet redacted), for the call result. */
  constructor(message, stderr = '') {
    super(message);
    this.name = 'StandaloneProbeError';
    this.stderr = stderr;
  }
}
const firstLine = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';
const PROBE_DETAIL_CHARS = 200;
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
  // proc.run reports a command that cannot start as code -1 and a `spawn error: ...` line. That is a permanent error
  // (a missing binary, a bad PATH), not a help text that was hard to read, and the operator must be told which.
  const spawnLine = lastResult.code === -1 ? firstLine(lastResult.stderr) : '';
  if (spawnLine.startsWith('spawn error:'))
    throw new StandaloneProbeError(
      `cannot run \`${bin}\`: ${/\bENOENT\b/.test(spawnLine) ? `${bin} was not found on PATH` : `${bin} could not be started`} (${spawnLine.slice(0, PROBE_DETAIL_CHARS)})`,
      lastResult.stderr,
    );
  const why = lastResult.timedOut
    ? 'timed out'
    : `exit ${lastResult.code}, no --format option in the text`;
  const detail = firstLine(lastResult.stderr).slice(0, PROBE_DETAIL_CHARS);
  throw new StandaloneProbeError(
    `cannot read \`${bin} run --help\` (${why}, ${PROBE_ATTEMPTS} tries), so it is unknown whether this OpenCode needs --standalone${detail ? `; its first stderr line: ${detail}` : ''}`,
    lastResult.stderr,
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
 *   { ok, text, usage, usageSource, reportedUsd, modelStarted, ms, toolCalls, timedOut, cutOff, error, stderr,
 *     reasoningEffort, maxOutputTokens }
 * and does not throw for a failed call: `ok` is false and `error` says why (redacted). It throws, before any
 * process starts and before money is reserved, for an unsafe model id or effort, a prompt too long to pass,
 * or a stale credential (`credentialGuard.assertFresh` throws). A spend stop from the ledger is thrown too.
 *
 * `ledger` is createLedger(...) for this run, `config` the loaded settings (aws_region and
 * estimate_usd_per_call, the fallback price, are read from it). `callKind` is `judge` (the default) or `writer`, for a
 * request-only checklist call: the call reserves its ceiling (callCeiling), and the ledger charges the mean of that
 * kind and model from the cost profile (`costProfile`, the committed one by default) when the CLI reports no usable
 * cost. `timeoutMs` defaults to config.judge_timeout_ms and may not exceed MAX_CALL_TIMEOUT_MS; use
 * judgeTimeoutMs(config, seat) for a seat. `maxOutputTokens` is the output limit of the call (default:
 * judgeMaxOutputTokens(config, { seat, modelId }), from judge_max_output_tokens and
 * judge_max_output_tokens_by_seat) and sets the model entry's limit
 * and the reservation (callCeiling). A reply the model stopped for length is a failed call (`ok` false, error "reply
 * cut off ..."), and `cutOff` is also true when the reply used the whole limit, so the caller can count both.
 * `usageSource` is stream, session-export, char-estimate or none.
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
  seat,
  maxOutputTokens,
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
  const outputLimit =
    maxOutputTokens ?? judgeMaxOutputTokens(config, { seat, modelId });
  if (!isOutputLimit(outputLimit))
    throw new TypeError(
      `judgeCall: maxOutputTokens must be a whole number from ${MIN_OUTPUT_TOKENS} to ${MAX_OUTPUT_TOKENS}`,
    );
  if (credentialGuard) credentialGuard.assertFresh(label);
  if (credentials) credentialVars(credentials);
  // The exported keys are known values, so they are removed exactly, on top of the secret patterns.
  const redactText = credentials
    ? createRedactor({ literals: exportedSecrets(credentials) })
    : redact;

  // The reservation must outlive the call and its usage export, or a slow call would read as unaccounted for.
  const price = callCeiling({
    config,
    callKind,
    modelId,
    prompt,
    maxOutputTokens: outputLimit,
    costProfile,
  });
  const reservation = await ledger.reserve(
    price.usd,
    redactText(label, { maxChars: Infinity }),
    {
      ...price.options,
      ttlMs: callTimeoutMs + SESSION_EXPORT_TIMEOUT_MS + 60000,
    },
  );
  let sandbox;
  try {
    sandbox = makeSandbox({
      modelId,
      region: config.aws_region,
      maxOutputTokens: outputLimit,
      tmpRoot,
    });
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
        cutOff: false,
        error: redactText(error.message, { maxChars: ERROR_CHARS }),
        stderr: redactText(error.stderr, { maxChars: STDERR_CHARS }),
        reasoningEffort: reasoningEffort ?? null,
        maxOutputTokens: outputLimit,
      };
    }
    const result = await run(
      bin,
      [
        'run',
        ...(standalone ? ['--standalone'] : []),
        '--format',
        'json',
        '--title',
        SESSION_TITLE,
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
    // The model stopped because it reached the output limit: the reply is cut off and is not used. A reply that used
    // the whole limit but ended on its own is only flagged, since the reader of the reply (a strict parser) decides.
    // The tokens are summed over the steps of the call, so a call of several steps can be flagged at less than the
    // limit in one step.
    const stoppedForLength = trace.finish_reason === 'length';
    const cutOff =
      stoppedForLength || (usage ? usage.output_tokens >= outputLimit : false);
    const ok =
      result.code === 0 &&
      !result.timedOut &&
      !result.overflow &&
      !traceError &&
      !stoppedForLength &&
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
      else if (stoppedForLength)
        error = `reply cut off at the output limit of ${outputLimit} tokens (judge_max_output_tokens or judge_max_output_tokens_by_seat); the reply is not used`;
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
      cutOff,
      error,
      stderr,
      reasoningEffort: reasoningEffort ?? null,
      maxOutputTokens: outputLimit,
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
  MIN_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  judgeConfig,
  opencodeModelId,
  modelArg,
  judgeTimeoutMs,
  judgeMaxOutputTokens,
  callCeiling,
  judgeEnv,
  exportedSecrets,
  makeSandbox,
  estimateUsage,
  judgeCall,
  judgeCallError,
  readOpenCodeVersion,
};
