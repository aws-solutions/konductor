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
const { promptFor } = require('../arm-opts.js');
const { writeArmConfig } = require('../arm-config.js');
const { orchMetricsOfRunDir } = require('../orch-metrics.js');
const { copyPlainFile } = require('../safe-copy.js');
const { scrubTreeDetailed, redactHostPaths } = require('../hygiene.js');
const { secretLiterals } = require('../scrub.js');

const id = 'kiro-cli';
const meta = require('./kiro-meta.js');

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
  args.push(resume ? resume.prompt : promptFor(arm, task));
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

// Engine v2 keeps <sid>.json and <sid>.jsonl in ~/.kiro/sessions/cli. Engine v3 (kiro-cli 3.x) keeps one directory per
// session, ~/.kiro/sessions/<workspace hash>/sess_<id>/, with session.json, messages.jsonl and sub-executions/<id>.jsonl for
// each sub-agent. Both are copied under destDir; a v3 session lands at destDir/sess_<id>/.
const V3_SESSION_DIR = /^sess_[0-9A-Za-z-]+$/;

function copySessions(home, destDir) {
  const root = path.join(home, '.kiro/sessions');
  const out = { copied: [], skipped: [] };
  if (!fs.existsSync(root)) return out;
  const cli = path.join(root, 'cli');
  if (fs.existsSync(cli)) copyTree(cli, destDir, '', out);
  for (const workspace of safeReaddir(root)) {
    if (workspace === 'cli') continue;
    const wsDir = path.join(root, workspace);
    if (!isRealDir(wsDir, out, workspace)) continue;
    for (const name of safeReaddir(wsDir)) {
      if (!V3_SESSION_DIR.test(name)) continue;
      const src = path.join(wsDir, name);
      if (isRealDir(src, out, path.join(workspace, name))) copyTree(src, path.join(destDir, name), name, out);
    }
  }
  return out;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

// A symlink or special file is listed as skipped and never followed.
function isRealDir(p, out, rel) {
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) return true;
    if (st.isSymbolicLink()) out.skipped.push({ path: rel, reason: 'symlink' });
  } catch (e) {
    out.skipped.push({ path: rel, reason: `copy failed: ${e.code || e.message}` });
  }
  return false;
}

// The sessions only feed the transcript size and the credit cross-check, so a failed copy must not
// cost the run its credits or checks. The skipped entries go to a notes file next to the copy.
function copySessionsTolerant(home, outDir, flags) {
  let skipped;
  try {
    skipped = copySessions(home, path.join(outDir, 'session')).skipped;
    redactHostPaths(path.join(outDir, 'session'));
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

// The transcript text of one session: engine v2 keeps <sid>.jsonl; engine v3 keeps <sid>/messages.jsonl and one file per
// sub-agent run in <sid>/sub-executions. Null when the session's own transcript was not saved.
function sessionTranscript(sessionDir, sid) {
  const v2 = readRegularFile(path.join(sessionDir, `${sid}.jsonl`));
  if (v2 !== null) return v2;
  const main = readRegularFile(path.join(sessionDir, sid, 'messages.jsonl'));
  if (main === null) return null;
  const subDir = path.join(sessionDir, sid, 'sub-executions');
  const subs = safeReaddir(subDir).filter((n) => n.endsWith('.jsonl')).sort().map((n) => readRegularFile(path.join(subDir, n)) ?? '');
  return [main, ...subs].join('');
}

// Transcript size over the parent and every subagent session; partial when any file is missing.
function readTranscripts(sessionDir, sessionIds, streamText) {
  let bytes = 0;
  let chars = 0;
  let missing = false;
  const sessions = [];
  for (const sid of sessionIds) {
    const t = sessionTranscript(sessionDir, sid);
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
    if (prepared.entryAgent && !fs.existsSync(path.join(home, '.kiro/agents', `${prepared.entryAgent}.json`))) {
      throw new Error(`--arm-agent: agent "${prepared.entryAgent}" is not installed by this arm`);
    }
    prepared.skillInfo = skills.kiroSkillInfo(home, prepared.exportDir, prepared.entryAgent ?? 'konductor');
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
    if (arm.armConfig) writeArmConfig(home, arm.armConfig);
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

// A model can print a credential it found in its environment or in a file. Same scrub as the opencode harness.
// Returns {scrubbed, unscrubbed}; a file that could not be scrubbed is listed, never skipped silently.
function finalize(outDir) {
  return scrubTreeDetailed(outDir, secretLiterals(process.env), { shapes: true });
}

// What the runner needs to know after one turn: how it ended and what the agent said last.
function turnSummary(streamText) {
  const a = aggregateStream(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText, askedUser: a.askedUser };
}

// One aggregate per turn, then summed: a tool call id may repeat in a later turn.
function aggregateRunDir(outDir) {
  return mergeAggregates(turnStreamTexts(outDir).map((t) => aggregateStream(parseStream(t).events)));
}

// Parses stream.jsonl and the copied sessions. Fills `acc` as it goes so a throw part-way keeps the spend already read.
function parseResult(outDir, { home, acc, arm, ctx }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events } = parseStream(streamText);
  acc.agg = aggregateRunDir(outDir);
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

// Spawns, depth, review flow and phase documents from the stream and the workspace snapshot taken after the run.
function orchMetrics(outDir) {
  return orchMetricsOfRunDir(outDir);
}

// The file saved is the entry agent's own: its skill filter is what the skill load-rate math counts as offered to the run.
function collectArtifacts(home, outDir, { arm } = {}) {
  copyPlainFile(home, path.join('.kiro', 'agents', `${arm?.agent ?? 'konductor'}.json`), path.join(outDir, 'installed-agent.json'));
}

module.exports = {
  id, meta, prepareArm: sandbox.prepareArm, requiredPaths: sandbox.KIRO_REQUIRED, trialInstall, installInto, buildCommand, env, removeCredentials, keepPaths,
  parseResult, aggregateRunDir, turnSummary, collectArtifacts, orchMetrics, kiroArgs, readTranscripts, copySessions, finalize,
};
