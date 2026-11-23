// SPDX-License-Identifier: Apache-2.0
'use strict';

// The template harness: the smallest plugin that passes the kit (node bench/kit/plugin/check.js <dir>). It runs
// agent.js, which prints one JSON event per line. Copy the folder to bench/plugins/<name>/ and replace the command,
// the env and the stream reader with your agent's. CONTRACT.md (runner/lib/harness/) says what each member gets.
const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const { promptFor } = require('../../runner/lib/arm-opts.js');
const skills = require('../../runner/lib/skills.js');
const meta = require('./meta.js');

const { id } = meta;
const AGENT = path.join(__dirname, 'agent.js');
const FINAL_TEXT_MAX = 20000;

const prepareArm = () => ({});
const trialInstall = () => [];
const installInto = (home) => {
  fs.mkdirSync(home, { recursive: true });
  return {};
};

/** `node agent.js --model <model> <prompt>`: the prompt is the last argument; `display` hides it. */
function buildCommand({ arm, task, config }) {
  return { file: process.execPath, args: [AGENT, '--model', String(config.model), promptFor(arm, task)], display: `node agent.js --model ${config.model} <prompt>` };
}

/** The agent's whole environment: an allowlist built here, never a copy of process.env. Core filters it again. */
function env({ home, tmpdir }) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: home, TMPDIR: tmpdir, ...meta.noPrompt.env,
  };
}

const removeCredentials = () => {};
const keepPaths = () => [process.execPath, __dirname];

/** The run facts of a parsed template stream: one session, its tool calls, the usage and the final answer. */
function parseEvents(events) {
  const start = events.find((e) => e?.type === 'start') ?? null;
  const end = events.find((e) => e?.type === 'end') ?? null;
  const uses = events.filter((e) => e?.type === 'tool_use');
  const usage = events.filter((e) => e?.type === 'usage').reduce((u, e) => ({ input: u.input + e.input, output: u.output + e.output, costUsd: u.costUsd + e.costUsd, calls: u.calls + 1 }), { input: 0, output: 0, costUsd: 0, calls: 0 });
  const toolNames = {};
  for (const u of uses) toolNames[u.name] = (toolNames[u.name] ?? 0) + 1;
  const text = end?.text ?? null;
  return {
    agg: {
      sessionId: start?.sessionId ?? null, sessionIds: start?.sessionId ? [start.sessionId] : [],
      runFinishedStatus: end?.status ?? null, stopReason: end?.stopReason ?? null,
      credits: 0, meteringEntries: 0, nonCreditUnits: [], turnDurationMs: null, contextUsagePercentage: null,
      toolCalls: uses.length, workToolCalls: uses.length, subagentCalls: 0, toolNames, skillsMcpOk: null, delegatedTo: {},
      finalText: text === null ? null : text.slice(0, FINAL_TEXT_MAX), finalTextTruncated: text === null ? null : text.length > FINAL_TEXT_MAX,
      askedUser: null, configuredModel: start?.model,
    },
    usage,
  };
}

// The readers of this harness's own stream (CONTRACT.md, `streams`). Add `timeline` when meta.supports.trace and
// `stopEvent` when meta.supports.stopOn.
const streams = Object.freeze({ finalText: (events) => parseEvents(events).agg.finalText });

function turnSummary(streamText) {
  const { agg } = parseEvents(parseStream(streamText).events);
  return { sessionId: agg.sessionId, runFinishedStatus: agg.runFinishedStatus, stopReason: agg.stopReason, finalText: agg.finalText, askedUser: null };
}

/** Fills `acc` from `outDir/stream.jsonl` (CONTRACT.md, "What parseResult must put in acc"). */
function parseResult(outDir, { acc, arm, ctx }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events, badLines } = parseStream(streamText);
  const { agg, usage } = parseEvents(events);
  if (badLines > 0) acc.meta.flags.push('streamTruncated');
  acc.agg = agg;
  acc.skills = skills.captureSkills({ runtime: id, events, arm, ctx });
  acc.transcript = { bytes: Buffer.byteLength(streamText), chars: streamText.length, partial: false };
  acc.session = { model: agg.configuredModel ?? null, totalRequestCount: usage.calls };
  acc.usage = { tokens: { input: usage.input, output: usage.output, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: usage.input + usage.output }, costUsd: usage.costUsd, modelCalls: usage.calls, sessions: 1, variants: [] };
}

const collectArtifacts = () => {};

module.exports = { id, meta, streams, prepareArm, trialInstall, installInto, buildCommand, env, removeCredentials, keepPaths, turnSummary, parseResult, collectArtifacts };
