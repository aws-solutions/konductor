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
const { parseStream } = require('../stream.js');
const { promptFor } = require('../arm-opts.js');
const skills = require('../skills.js');
const { scrubTreeDetailed } = require('../hygiene.js');
const { secretLiterals } = require('../scrub.js');
const { launcherForCwd, pythonArgs } = require('../plant/strands-adapter.js');
const { aggregateEvents } = require('./strands-parse.js');

const id = 'strands';
const meta = require('./strands-meta.js');
const PINS = require('../../../physical/strands/plant_strands/bedrock_models.json');
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
 * pricesSource}`. Null for the fake model; throws for any other model, so an unpriced model never starts.
 */
function bedrockModelOf(model) {
  const m = /^(fake|bedrock):(.+)$/.exec(String(model));
  if (m?.[1] === 'fake') return null;
  const pin = m ? PINS.models[m[2]] : null;
  if (!pin) throw new Error(`Strands arms take --model fake:<script.json> or bedrock:<id> with a pinned id (${Object.keys(PINS.models).join(', ')}); got ${model}`);
  return { id: m[2], region: PINS.region, ...pin, pricesSource: PINS.pricesSource };
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

module.exports = { id, meta, resolveStrands, bedrockModelOf, prepareArm, trialInstall, installInto, buildCommand, env, credentialEnv: ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'], removeCredentials, keepPaths, turnSummary, parseResult, collectArtifacts, finalize };
