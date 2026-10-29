// SPDX-License-Identifier: Apache-2.0
'use strict';

// The kiro-cli harness: the code that used to sit inline in run-one.js, orchestrate.js and sandbox.js,
// behind the same interface the opencode harness implements.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStream, aggregateStream, summarizeSessionJson } = require('../stream.js');
const { crossCheckCredits } = require('../result.js');
const { buildChildEnv } = require('../env.js');
const sandbox = require('../sandbox.js');
const skills = require('../skills.js');

const id = 'kiro-cli';

function kiroArgs({ arm, task, config }) {
  const args = [
    'chat', '--no-interactive', '--trust-all-tools',
    '--model', config.model,
    '--effort', config.effort,
    '--agent-engine', config.agentEngine,
    '--output-format', 'stream-json',
  ];
  if (arm.agent) args.push('--agent', arm.agent);
  // Exit 3 instead of running without the skills server.
  if (!arm.vanilla) args.push('--require-mcp-startup');
  args.push(task.prompt);
  return args;
}

function copySessions(home, destDir) {
  const src = path.join(home, '.kiro/sessions/cli');
  if (!fs.existsSync(src)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(src);
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(destDir, f));
  return files;
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Transcript size over the parent and every subagent session; partial when any file is missing.
function readTranscripts(sessionDir, sessionIds, streamText) {
  let bytes = 0;
  let chars = 0;
  let missing = false;
  const sessions = [];
  for (const sid of sessionIds) {
    const jsonl = path.join(sessionDir, `${sid}.jsonl`);
    if (fs.existsSync(jsonl)) {
      const t = fs.readFileSync(jsonl, 'utf8');
      bytes += Buffer.byteLength(t);
      chars += t.length;
    } else {
      missing = true;
    }
    const json = readJsonOrNull(path.join(sessionDir, `${sid}.json`));
    sessions.push(json ? summarizeSessionJson(json) : null);
  }
  if (!sessionIds.length || bytes === 0) {
    return { transcript: { bytes: Buffer.byteLength(streamText), chars: streamText.length, partial: true }, sessions };
  }
  return { transcript: { bytes, chars, partial: missing }, sessions };
}

// Installs the arm into a throwaway HOME to prove it works and to learn which agents get their model rewritten.
function trialInstall(prepared, ctx) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    sandbox.installInto(home, prepared);
    const rewritten = sandbox.normalizeAgentModels(home, ctx.config.model);
    prepared.skillInfo = skills.kiroSkillInfo(home, prepared.exportDir);
    return rewritten;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Fills the scratch HOME: an empty ~/.kiro for vanilla, the installed arm otherwise, then the auth copy.
function installInto(home, { arm, prepared, ctx, config, outDir }) {
  const meta = {};
  if (arm.vanilla) {
    sandbox.emptyKiroHome(home);
  } else {
    fs.writeFileSync(path.join(outDir, 'install.log'), sandbox.installInto(home, prepared) + '\n');
    meta.rewrittenAgents = sandbox.normalizeAgentModels(home, config.model);
    meta.modelNormalized = true;
  }
  sandbox.copyAuthDb(ctx.authDb, home);
  return meta;
}

function buildCommand({ arm, task, config, ctx }) {
  const args = kiroArgs({ arm, task, config });
  return {
    file: ctx.kiroBin || 'kiro-cli',
    args,
    display: `kiro-cli ${args.map((a) => JSON.stringify(a)).join(' ')}`,
  };
}

function env({ arm, config, ctx, home, tmpdir }) {
  return buildChildEnv(process.env, { home, tmpdir, agentEngine: config.agentEngine, keep: ctx.envKeep, konductor: !arm.vanilla }).env;
}

function removeCredentials(home) {
  sandbox.removeAuthCopy(home);
}

const keepPaths = (ctx) => [ctx.kiroBin].filter(Boolean);

// Parses stream.jsonl and the copied sessions. Fills `acc` as it goes so a throw part-way keeps the spend already read.
function parseResult(outDir, { home, acc, arm, ctx }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events } = parseStream(streamText);
  acc.agg = aggregateStream(events);
  acc.skills = skills.captureSkills({ runtime: 'kiro-cli', events, arm, ctx });
  copySessions(home, path.join(outDir, 'session'));
  const { transcript, sessions } = readTranscripts(path.join(outDir, 'session'), acc.agg.sessionIds, streamText);
  acc.transcript = transcript;
  acc.session = sessions[0] ?? null;
  const cross = crossCheckCredits(acc.agg.credits, sessions);
  acc.meta.creditsSessionTotal = cross.total;
  if (cross.mismatch) acc.meta.flags.push('creditsMismatch');
  if (!arm.vanilla && acc.agg.skillsMcpOk === false) acc.meta.flags.push('skillsMcpFailed');
  return acc;
}

function collectArtifacts(home, outDir) {
  const agentJson = path.join(home, '.kiro/agents/konductor.json');
  if (fs.existsSync(agentJson)) fs.copyFileSync(agentJson, path.join(outDir, 'installed-agent.json'));
}

module.exports = {
  id, prepareArm: sandbox.prepareArm, trialInstall, installInto, buildCommand, env, removeCredentials, keepPaths,
  parseResult, collectArtifacts, kiroArgs, readTranscripts, copySessions,
};
