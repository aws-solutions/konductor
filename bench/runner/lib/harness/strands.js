// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Strands harness: runs bench/physical/strands/launch.py, a Strands agent whose plant tools are forwarding stubs
// (kind B, design 15.1). Plant arms only (st-plant-*); the run setup (forwarder copy, run file) is lifecycle.js's.
// `ctx.strands` is `{python, prefix, basePrefix, version, agentFile}`: the interpreter with strands-agents, its
// sys.prefix and sys.base_prefix (kept visible in the sandbox), the SDK version, and the agent factory file or null.

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
const VERSION_PROBE = 'import sys, importlib.metadata as m; print(m.version("strands-agents")); print(sys.prefix); print(sys.base_prefix)';

/**
 * `ctx.strands` for interpreter `python` and agent factory `agentFile` (or null): asks the interpreter for its
 * strands-agents version and prefixes. Throws when the interpreter cannot import strands-agents.
 */
function resolveStrands({ python = 'python3', agentFile = null } = {}) {
  const r = spawnSync(python, ['-I', '-c', VERSION_PROBE], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  if (r.status !== 0) throw new Error(`${python} has no strands-agents (${(r.stderr || r.error?.message || '').trim().split('\n').at(-1)}); pass --strands-python <venv>/bin/python`);
  const [version, prefix, basePrefix] = r.stdout.trim().split('\n');
  if (agentFile && !fs.existsSync(agentFile)) throw new Error(`--strands-agent ${agentFile} does not exist`);
  return { python, prefix, basePrefix, version, agentFile: agentFile ? path.resolve(agentFile) : null };
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
  const args = [...pythonArgs(launcherForCwd(cwd)), '--model', config.model, ...(ctx.strands.agentFile ? ['--agent-file', ctx.strands.agentFile] : []), promptFor(arm, task)];
  return { file: ctx.strands.python, args, display: [ctx.strands.python, ...args.slice(0, -1), '<prompt>'].join(' ') };
}

/**
 * The launcher's whole environment: PATH, HOME, TMPDIR, the no-prompt variables of the descriptor (A-4), and AWS
 * config paths pointed at /dev/null with the instance metadata lookup off, so no credential on this host can reach
 * the agent. Python's -I already ignores every PYTHON* variable.
 */
function env({ home, tmpdir }) {
  return {
    PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmpdir, ...meta.noPrompt.env,
    AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_EC2_METADATA_DISABLED: 'true',
  };
}

const removeCredentials = () => {};
const keepPaths = (ctx) => [ctx.strands?.prefix, ctx.strands?.basePrefix].filter(Boolean);

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
  const { usage, modelCalls, error: _error, strands: _strands, adapter: _adapter, ...agg } = a;
  acc.agg = agg;
  acc.session = { model: a.configuredModel, totalRequestCount: modelCalls };
  // shortcut: costUsd is 0 because only the fake model runs; price the tokens before a real provider is enabled.
  acc.usage = { tokens: { input: usage.input, output: usage.output, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: usage.input + usage.output }, costUsd: 0, modelCalls, sessions: 1, variants: [] };
}

const collectArtifacts = () => {};

// The agent gets no credential, but its trace could still echo one found on the host. Same scrub as kiro-cli.
function finalize(outDir) {
  return scrubTreeDetailed(outDir, secretLiterals(process.env), { shapes: true });
}

module.exports = { id, meta, resolveStrands, prepareArm, trialInstall, installInto, buildCommand, env, removeCredentials, keepPaths, turnSummary, parseResult, collectArtifacts, finalize };
