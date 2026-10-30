// SPDX-License-Identifier: Apache-2.0
'use strict';

// The kiro-cli harness: the code that used to sit inline in run-one.js, orchestrate.js and sandbox.js,
// behind the same interface the opencode harness implements.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStream, aggregateStream, mergeAggregates, summarizeSessionJson, sessionModels } = require('../stream.js');
const { turnStreamTexts } = require('../autonomy.js');
const { crossCheckCredits } = require('../result.js');
const { buildChildEnv } = require('../env.js');
const sandbox = require('../sandbox.js');
const skills = require('../skills.js');

const id = 'kiro-cli';

// resume: {sessionId, prompt} continues an earlier turn of the same conversation (autonomy tasks). The session store
// lives in the run's scratch HOME and is keyed by directory, so the same HOME and cwd find it.
function kiroArgs({ arm, task, config, resume = null }) {
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
  if (resume) args.push(...(resume.sessionId ? ['--resume-id', resume.sessionId] : ['--resume']));
  args.push(resume ? resume.prompt : task.prompt);
  return args;
}

// Copies regular files and directories. A symlink could lead outside the session directory and a socket or FIFO
// can block or throw, so those are skipped and listed rather than followed.
function copyTree(srcDir, destDir, rel, out) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const relPath = path.join(rel, name);
    try {
      const st = fs.lstatSync(src);
      if (st.isSymbolicLink()) out.skipped.push({ path: relPath, reason: 'symlink' });
      else if (st.isDirectory()) copyTree(src, path.join(destDir, name), relPath, out);
      else if (st.isFile()) { fs.copyFileSync(src, path.join(destDir, name)); out.copied.push(relPath); }
      else out.skipped.push({ path: relPath, reason: 'special file' });
    } catch (e) {
      out.skipped.push({ path: relPath, reason: `copy failed: ${e.code || e.message}` });
    }
  }
}

function copySessions(home, destDir) {
  const src = path.join(home, '.kiro/sessions/cli');
  const out = { copied: [], skipped: [] };
  if (!fs.existsSync(src)) return out;
  copyTree(src, destDir, '', out);
  return out;
}

// The sessions only feed the transcript size and the credit cross-check, so a failed copy must not
// cost the run its credits or checks. The skipped entries go to a notes file next to the copy.
function copySessionsTolerant(home, outDir, flags) {
  let skipped;
  try {
    skipped = copySessions(home, path.join(outDir, 'session')).skipped;
  } catch (e) {
    skipped = [{ path: '.', reason: `copy failed: ${e.code || e.message}` }];
  }
  if (!skipped.length) return;
  flags.push('sessionCopyPartial');
  try {
    fs.writeFileSync(path.join(outDir, 'session-copy-notes.txt'), skipped.map((s) => `${s.path}\t${s.reason}`).join('\n') + '\n');
  } catch { /* the flag already says it */ }
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readRegularFile(file) {
  try { return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null; } catch { return null; }
}

// Transcript size over the parent and every subagent session; partial when any file is missing.
function readTranscripts(sessionDir, sessionIds, streamText) {
  let bytes = 0;
  let chars = 0;
  let missing = false;
  const sessions = [];
  for (const sid of sessionIds) {
    const t = readRegularFile(path.join(sessionDir, `${sid}.jsonl`));
    if (t !== null) {
      bytes += Buffer.byteLength(t);
      chars += t.length;
    } else {
      missing = true;
    }
    const json = readJsonOrNull(path.join(sessionDir, `${sid}.json`));
    sessions.push(json ? { ...summarizeSessionJson(json), models: sessionModels(json) } : null);
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
    sandbox.installInto(home, prepared, ctx.config.agentEngine);
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
    fs.writeFileSync(path.join(outDir, 'install.log'), sandbox.installInto(home, prepared, config.agentEngine) + '\n');
    meta.rewrittenAgents = sandbox.normalizeAgentModels(home, config.model);
    meta.modelNormalized = true;
  }
  sandbox.copyAuthDb(ctx.authDb, home);
  return meta;
}

function buildCommand({ arm, task, config, ctx, resume = null }) {
  const args = kiroArgs({ arm, task, config, resume });
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

// What the runner needs to know after one turn: how it ended and what the agent said last.
function turnSummary(streamText) {
  const a = aggregateStream(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText, askedUser: a.askedUser };
}

// Parses stream.jsonl and the copied sessions. Fills `acc` as it goes so a throw part-way keeps the spend already read.
function parseResult(outDir, { home, acc, arm, ctx }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events } = parseStream(streamText);
  // One aggregate per turn, then summed: a tool call id may repeat in a later turn.
  acc.agg = mergeAggregates(turnStreamTexts(outDir).map((t) => aggregateStream(parseStream(t).events)));
  acc.skills = skills.captureSkills({ runtime: 'kiro-cli', events, arm, ctx });
  copySessionsTolerant(home, outDir, acc.meta.flags);
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
  id, prepareArm: sandbox.prepareArm, requiredPaths: sandbox.KIRO_REQUIRED, trialInstall, installInto, buildCommand, env, removeCredentials, keepPaths,
  parseResult, turnSummary, collectArtifacts, kiroArgs, readTranscripts, copySessions,
};
