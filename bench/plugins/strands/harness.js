// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Strands harness: runs bench/physical/strands/launch.py, a Strands agent whose plant tools are forwarding stubs
// (kind B, design 15.1). Plant arms only (st-plant-*); the run setup (forwarder copy, run file) is lifecycle.js's.
// `ctx.strands` is `{python, prefix, basePrefix, version, agentFile}`: the interpreter with strands-agents, its
// sys.prefix and sys.base_prefix (kept visible in the sandbox), the SDK version, and the agent factory file or null.
// A `bedrock:<id>` model also needs `ctx.awsCreds` (exported keys, aws-creds.js) and `ctx.strandsSpend.left()`, the
// USD the command may still spend: each run's launcher gets that as its hard cap (`--max-usd`).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStream } = require('../../sdk').stream;
const { promptFor } = require('../../sdk').armOpts;
const skills = require('../../sdk').skills;
const { scrubTreeDetailed } = require('../../sdk').hygiene;
const { secretLiterals } = require('../../sdk').scrub;
const { launcherForCwd, pythonArgs } = require('../../sdk').plant.strandsAdapter;
const { aggregateEvents } = require('./parse.js');

const id = 'strands';
const meta = require('./meta.js');
const PINS = require('../../sdk').plant.bedrockModels;
const VERSION_PROBE = 'import sys, importlib.metadata as m; print(m.version("strands-agents")); print(sys.prefix); print(sys.base_prefix)';

/**
 * `ctx.strands` for interpreter `python` and agent factory `agentFile` (or null): asks the interpreter for its
 * strands-agents version and prefixes. Throws when the interpreter cannot import strands-agents.
 */
function resolveStrands({ python = 'python3', agentFile = null } = {}) {
  const probeEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.env.LD_LIBRARY_PATH) probeEnv.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
  const r = spawnSync(python, ['-I', '-c', VERSION_PROBE], { encoding: 'utf8', env: probeEnv });
  if (r.status !== 0) throw new Error(`${python} has no strands-agents (${(r.stderr || r.error?.message || '').trim().split('\n').at(-1)}); pass --strands-python <venv>/bin/python`);
  const [version, prefix, basePrefix] = r.stdout.trim().split('\n');
  if (agentFile && !fs.existsSync(agentFile)) throw new Error(`--strands-agent ${agentFile} does not exist`);
  return { python, prefix, basePrefix, version, agentFile: agentFile ? path.resolve(agentFile) : null };
}

/**
 * The pinned Bedrock model `model` names (`bedrock:<id>`): `{id, region, inputUsdPerMTok, outputUsdPerMTok, maxTokens,
 * pricesSource, pricesReadOn}`. Null for the fake model; throws for any other model, so an unpriced model never starts.
 */
function bedrockModelOf(model) {
  const m = /^(fake|bedrock):(.+)$/.exec(String(model));
  if (m?.[1] === 'fake') return null;
  const pin = m ? PINS.models[m[2]] : null;
  if (!pin) throw new Error(`Strands arms take --model fake:<script.json> or bedrock:<id> with a pinned id (${Object.keys(PINS.models).join(', ')}); got ${model}`);
  return { id: m[2], region: PINS.region, ...pin, pricesSource: PINS.pricesSource };
}

const PRICES_MAX_AGE_DAYS = 30;

/**
 * Throws when the prices of `model` (from bedrockModelOf) were last read from the price page more than 30 days before
 * `now` (ms), or on a missing or future date. The prices are copied by hand (D-11), so a paid run must not trust old ones.
 */
function assertPricesFresh(model, now = Date.now()) {
  const on = /^\d{4}-\d{2}-\d{2}$/.test(model.pricesReadOn ?? '') ? Date.parse(`${model.pricesReadOn}T00:00:00Z`) : NaN;
  if (Number.isNaN(on)) throw new Error(`bedrock_models.json has no valid pricesReadOn (YYYY-MM-DD) for ${model.id}; read the AWS price page and set it`);
  const days = Math.floor((now - on) / 86400000);
  if (days < 0) throw new Error(`pricesReadOn ${model.pricesReadOn} is in the future for ${model.id}`);
  if (days > PRICES_MAX_AGE_DAYS) throw new Error(`prices of ${model.id} were read on ${model.pricesReadOn}, ${days} days ago (limit ${PRICES_MAX_AGE_DAYS}): check the AWS price page, then update the prices and pricesReadOn in bedrock_models.json`);
}

const prepareArm = () => ({});
const trialInstall = () => [];
// The forwarder and its run file are written per run by lifecycle.js (openPlantRun), as the plant agent file is for kiro-cli.
const installInto = (home) => {
  fs.mkdirSync(home, { recursive: true });
  return {};
};

/** `python -I -B <plant dir>/launch.py --model <model> [--agent-file F] <prompt>`; the launcher was copied there by lifecycle.js. */
function buildCommand({ arm, task, config, ctx, cwd }) {
  const cap = bedrockModelOf(config.model) ? ['--max-usd', String(ctx.strandsSpend.left())] : [];
  const args = [...pythonArgs(launcherForCwd(cwd)), '--model', config.model, ...cap, ...(ctx.strands.agentFile ? ['--agent-file', ctx.strands.agentFile] : []), promptFor(arm, task)];
  return { file: ctx.strands.python, args, display: [ctx.strands.python, ...args.slice(0, -1), '<prompt>'].join(' ') };
}

/**
 * The launcher's whole environment: PATH, HOME, TMPDIR, the no-prompt variables of the descriptor (A-4), and AWS
 * config paths pointed at /dev/null with the instance metadata lookup off, so no credential on this host can reach
 * the agent. With `ctx.awsCreds` (a Bedrock model) the exported keys of that one profile and the pin's region are
 * added, and nothing else. Python's -I already ignores every PYTHON* variable.
 */
function env({ home, tmpdir, ctx = null }) {
  const bedrock = ctx?.awsCreds ? { ...ctx.awsCreds.current(), AWS_REGION: PINS.region, AWS_DEFAULT_REGION: PINS.region } : {};
  return {
    PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmpdir, ...meta.noPrompt.env,
    AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_EC2_METADATA_DISABLED: 'true', ...bedrock,
  };
}

const removeCredentials = () => {};
const keepPaths = (ctx) => [ctx.strands?.prefix, ctx.strands?.basePrefix].filter(Boolean);

/** The turn facts of a finished run from its trace text: session id, finish status, stop reason and final text. */
function turnSummary(streamText) {
  const a = aggregateEvents(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText, askedUser: null };
}

/** Fills `acc` from the trace in `outDir/stream.jsonl` (harness/CONTRACT.md, "What parseResult must put in acc"). */
function parseResult(outDir, { acc, arm, ctx }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events, badLines } = parseStream(streamText);
  const a = aggregateEvents(events);
  acc.skills = skills.captureSkills({ runtime: id, events, arm, ctx });
  acc.transcript = { bytes: Buffer.byteLength(streamText), chars: streamText.length, partial: false };
  if (badLines > 0) acc.meta.flags.push('streamTruncated');
  if (a.error) acc.meta.runError = a.error.slice(0, 300);
  const { usage, modelCalls, costUsd, error: _error, strands: _strands, adapter: _adapter, ...agg } = a;
  acc.agg = agg;
  acc.session = { model: a.configuredModel, totalRequestCount: modelCalls };
  acc.usage = { tokens: { input: usage.input, output: usage.output, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: usage.input + usage.output }, costUsd, modelCalls, sessions: 1, variants: [] };
}

const collectArtifacts = () => {};

// The trace could echo a credential found on the host, or the Bedrock keys the run was given. Same scrub as kiro-cli.
function finalize(outDir, ctx) {
  return scrubTreeDetailed(outDir, secretLiterals(process.env, ctx?.awsCreds ? ctx.awsCreds.values() : []), { shapes: true });
}

const rc = () => require('../../sdk').runconfig;

/**
 * The Bedrock model and keys of a run (run-cmd.js), or nulls: a Strands run on Bedrock spends money, so it needs an
 * --aws-profile whose keys alone reach the agent (its --budget-usd cap is checked by paid-run.js). Throws when missing.
 */
function runOptions({ opts, deps = {} }) {
  const stModel = bedrockModelOf(opts.model ?? '');
  let stCreds = null;
  if (stModel) {
    if (opts['aws-profile'] === undefined || opts['aws-profile'] === true) throw new Error('a Strands run on Bedrock needs --aws-profile NAME: the keys of that profile only are exported to the agent');
    assertPricesFresh(stModel, deps.now); // after the flag checks, so a test that stops at a missing flag never reads the clock
    const { profileCredentials } = require('../../sdk').awsCreds;
    stCreds = profileCredentials(String(opts['aws-profile']), deps.readAwsProfile ? { read: deps.readAwsProfile } : {});
    stCreds.current();
  } else if (opts['aws-profile'] !== undefined) {
    throw new Error('--aws-profile applies to a Strands run only with a bedrock: model; the fake model takes no credentials');
  }
  return { stModel, stCreds };
}

const flagValueOf = (opts, name) => (opts[name] && opts[name] !== true ? opts[name] : null);

/**
 * The Strands interpreter and agent file of a run, set on `ctx` (run-cmd.js), with the spend cap when it runs on Bedrock
 * (DEBT D-24). `state.charged` is read live, so the cap's `left()` falls as the command spends.
 */
function setUpRun(ctx, { opts, config, stModel, stCreds, budgetCredits, state, log }) {
  ctx.strands = resolveStrands({ python: flagValueOf(opts, 'strands-python') ?? 'python3', agentFile: flagValueOf(opts, 'strands-agent') });
  if (stCreds) Object.assign(ctx, { awsCreds: stCreds, strandsSpend: { capUsd: budgetCredits, left: () => budgetCredits - state.charged } });
  const credsNote = stCreds ? `${stModel.region}, keys of profile ${stCreds.profile}, hard spend cap $${budgetCredits} for the command` : 'no credentials passed';
  log(`strands-agents ${ctx.strands.version} (${ctx.strands.python}), agent ${ctx.strands.agentFile ?? 'plain Agent'}, model ${config.model}, ${credsNote}`);
}

/** The hook census of a plant suite (run-cmd.js setUpPlantSuite): a plain arm whose agent can change plant calls is refused. */
function plantPreflight({ ctx, suite, arms, scratchDir, wrap, log }) {
  const { preflightStrands } = require('../../sdk').plant.strandsCensus;
  suite.strandsCensus = preflightStrands({ strands: ctx.strands, suite, arms, env: env({ home: scratchDir, tmpdir: scratchDir }), scratch: scratchDir, wrap });
  log(`plant: Strands hook census: ${suite.strandsCensus.problems.length ? suite.strandsCensus.problems.join('; ') : 'no hook, middleware or tool swap that can change a plant call'}`);
}

/** The environment facts a run records (run-harness.js envInfoOf): the strands-agents version. */
const runEnvInfo = ({ ctx }) => ({ kiroCliVersion: null, harnessVersion: ctx.strands.version, modelListSnapshotPath: null });

/** The harness part of the run config (run-harness.js harnessRunConfig): interpreter, agent file, census and Bedrock pin. */
function harnessRunConfig({ ctx, plantSuite, stModel, stCreds, budgetCredits }) {
  return {
    harnessVersion: ctx.strands.version,
    strands: {
      python: ctx.strands.python, version: ctx.strands.version, agentFile: ctx.strands.agentFile, adapter: 'kind B: plant tools are forwarding stubs', census: plantSuite?.strandsCensus ?? null,
      bedrock: stModel ? { ...stModel, spendCapUsd: budgetCredits, awsProfile: stCreds.profile } : null,
    },
    env: rc().envPolicy(process.env, []),
  };
}

/** The agent env env.json describes: the launcher env is the whole env, so every key is set and nothing passed through. */
function envOfArm({ stCreds }) {
  const placeholder = stCreds ? { awsCreds: { current: () => Object.fromEntries(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'].map((k) => [k, '<set>'])) } } : null;
  const set = env({ home: '<run-home>', tmpdir: '<run>/tmp', ctx: placeholder });
  return { keys: Object.keys(set).sort(), set, unset: [] };
}

/** The run's model config from --model and --effort (run-cmd.js): the model as given; the launcher takes no effort. */
const modelConfig = ({ opts }) => ({ model: opts.model, effort: 'default' });

module.exports = { id, meta, streams: require('./streams.js'), modelConfig, runOptions, setUpRun, plantPreflight, runEnvInfo, harnessRunConfig, envOfArm, resolveStrands, bedrockModelOf, assertPricesFresh, prepareArm, trialInstall, installInto, buildCommand, env, credentialEnv: ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'], removeCredentials, keepPaths, turnSummary, parseResult, collectArtifacts, finalize };
