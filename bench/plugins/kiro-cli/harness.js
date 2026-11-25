// SPDX-License-Identifier: Apache-2.0
'use strict';

// The kiro-cli harness: the code that used to sit inline in run-one.js, orchestrate.js and sandbox.js,
// behind the same interface the opencode harness implements.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStream, aggregateStream, mergeAggregates, summarizeSessionJson, sessionModels, runErrorOf } = require('../../sdk').stream;

const THROTTLE = /throttl|too many requests|rate.?limit|\b429\b/i;
const { turnStreamTexts } = require('../../sdk').autonomy;
const { crossCheckCredits } = require('../../sdk').result;
const { buildChildEnv } = require('../../sdk').env;
const sandbox = require('../../sdk').sandbox;
const skills = require('../../sdk').skills;
const { installedSkills } = require('../../sdk').startup;
const { promptFor } = require('../../sdk').armOpts;
const { writeArmConfig } = require('../../sdk').armConfig;
const { orchMetricsOfRunDir } = require('../../sdk').orchMetrics;
const { copyPlainFile, assertPlainPath } = require('../../sdk').safeCopy;
const { scrubTreeDetailed, redactHostPaths } = require('../../sdk').hygiene;
const { secretLiterals } = require('../../sdk').scrub;

const id = 'kiro-cli';
const meta = require('./meta.js');
const { observedListingOf } = require('./listing.js');

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
  // Exit 3 instead of running without the skills server, or without the plant shim.
  if (!arm.vanilla || arm.plant) args.push('--require-mcp-startup');
  if (resume) args.push(...(resume.sessionId ? ['--resume-id', resume.sessionId] : ['--resume']));
  args.push(resume ? resume.prompt : promptFor(arm, task));
  return args;
}

// Copies regular files and directories below `srcRel` (relative to `home`) into destDir. A symlink could lead outside
// the session directory and a socket or FIFO can block or throw, so those are skipped and listed rather than followed.
// Leaves go through copyPlainFile, which re-checks every path part. `rel` is the name shown in the skipped list.
function copyTree(home, srcRel, destDir, rel, out) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(home, srcRel))) {
    const srcPath = path.join(srcRel, name);
    const relPath = path.join(rel, name);
    try {
      const st = fs.lstatSync(path.join(home, srcPath));
      if (st.isSymbolicLink()) out.skipped.push({ path: relPath, reason: 'symlink' });
      else if (st.isDirectory()) copyTree(home, srcPath, path.join(destDir, name), relPath, out);
      else if (st.isFile()) {
        if (copyPlainFile(home, srcPath, path.join(destDir, name)) === false) out.skipped.push({ path: relPath, reason: 'vanished' });
        else out.copied.push(relPath);
      } else out.skipped.push({ path: relPath, reason: 'special file' });
    } catch (e) {
      out.skipped.push({ path: relPath, reason: `copy failed: ${e.code || e.message}` });
    }
  }
}

// True when `rel` below `home` is a directory and no part of the path is a link. The agent controls these names, so a
// link here could point at the real user's sessions. Absent is silent; a link or a non-directory is listed as skipped.
function isPlainDir(home, rel, out) {
  try {
    assertPlainPath(home, rel, { last: 'dir' });
    return true;
  } catch (e) {
    if (e.code !== 'ENOENT') out.skipped.push({ path: rel, reason: /symlink/.test(e.message) ? 'symlink' : e.code ? `copy failed: ${e.code}` : 'not a directory' });
    return false;
  }
}

// Engine v2 keeps <sid>.json and <sid>.jsonl in ~/.kiro/sessions/cli. Engine v3 (kiro-cli 3.x) keeps one directory per
// session, ~/.kiro/sessions/<workspace hash>/sess_<id>/, with session.json, messages.jsonl and sub-executions/<id>.jsonl for
// each sub-agent. Both are copied under destDir; a v3 session lands at destDir/sess_<id>/.
const V3_SESSION_DIR = /^sess_[0-9A-Za-z-]+$/;

function copySessions(home, destDir) {
  const rootRel = path.join('.kiro', 'sessions');
  const out = { copied: [], skipped: [] };
  if (!isPlainDir(home, rootRel, out)) return out;
  const cliRel = path.join(rootRel, 'cli');
  if (isPlainDir(home, cliRel, out)) copyTree(home, cliRel, destDir, '', out);
  for (const workspace of safeReaddir(path.join(home, rootRel))) {
    if (workspace === 'cli') continue;
    const wsRel = path.join(rootRel, workspace);
    if (!isRealDir(path.join(home, wsRel), out, workspace)) continue;
    for (const name of safeReaddir(path.join(home, wsRel))) {
      if (!V3_SESSION_DIR.test(name)) continue;
      if (isRealDir(path.join(home, wsRel, name), out, path.join(workspace, name))) copyTree(home, path.join(wsRel, name), path.join(destDir, name), name, out);
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
    prepared.skillListing = skillListingOf(home, prepared.skillInfo);
    prepared.skillsInstalled = installedSkills(home, 'kiro-cli');
    prepared.skillListingError = null;
    return rewritten;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/**
 * The Kiro side of the skill listing record, in the Claude Code record's fields so a report can show both. Kiro CLI has
 * no known listing budget (a search of its binary found none), so every skill counts as described and nothing is
 * name-only. Skills are the SKILL.md dirs the trial install put under ~/.kiro/skills; an install that serves them from
 * the skills MCP server instead puts none there, and then the arm's source catalog is counted.
 */
function skillListingOf(home, info) {
  const dir = home ? path.join(home, '.kiro', 'skills') : null;
  let installed = [];
  try { if (dir) installed = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))).sort(); } catch { /* none installed */ }
  const names = installed.length ? installed : [...(info?.catalog?.skills ?? [])].sort();
  const sops = names.filter((n) => n.startsWith('sop-')).length || (info?.catalog?.sops?.length ?? 0);
  return {
    harness: 'kiro-cli',
    source: installed.length ? 'SKILL.md dirs the trial install wrote under ~/.kiro/skills' : "the arm's source catalog (skills served by the skills MCP server)",
    budgetChars: null, budgetSource: 'none known: no listing cap was found in the Kiro CLI binary',
    listingChars: null, skillsSent: names.length, overBudget: false,
    konductorDescribed: names, konductorNameOnly: [], nameOnly: 0,
    sops, sopsModelInvocable: sops ? true : null,
  };
}

/**
 * What the run loaded at session start, from its own stream (listing.js), or null when the stream has no breakdown
 * or is missing. run-one adds it to the arm's listing record as `skillListing.observed`.
 */
function observedListing(outDir) {
  try { return observedListingOf(fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8')); } catch { return null; } // no stream: nothing observed
}

/** The listing of a vanilla Kiro arm: no konductor skills. */
const vanillaSkillListing = () => ({ skillListing: skillListingOf(null, null), skillListingError: null });

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
function parseResult(outDir, { home, acc, arm, ctx, freshSessions = false }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events } = parseStream(streamText);
  acc.agg = aggregateRunDir(outDir);
  acc.skills = skills.captureSkills({ runtime: 'kiro-cli', events, arm, ctx });
  copySessionsTolerant(home, outDir, acc.meta.flags);
  const { transcript, sessions } = readTranscripts(path.join(outDir, 'session'), acc.agg.sessionIds, streamText);
  acc.transcript = transcript;
  acc.session = sessions[0] ?? null;
  // Each later conversation of a fresh-session task has its own session file; its models join the model check.
  // Only the top-level session of each stream counts, not a sub-agent's.
  if (freshSessions && acc.session) {
    const top = new Set(turnStreamTexts(outDir).map((t) => turnSummary(t).sessionId).filter(Boolean));
    const later = acc.agg.sessionIds.flatMap((sid, i) => (top.has(sid) ? sessions[i]?.models ?? [] : []));
    acc.session = { ...acc.session, models: [...new Set([...(acc.session.models ?? []), ...later])] };
  }
  const cross = crossCheckCredits(acc.agg.credits, sessions);
  acc.meta.creditsSessionTotal = cross.total;
  if (cross.mismatch) acc.meta.flags.push('creditsMismatch');
  if (!arm.vanilla && acc.agg.skillsMcpOk === false) acc.meta.flags.push('skillsMcpFailed');
  // A turn the service refused (pilot wave 3: two runs ended after 11 s on ClientThrottleError) is not the task's fault.
  const runError = turnStreamTexts(outDir).map((t) => runErrorOf(parseStream(t).events)).find(Boolean);
  if (runError) {
    acc.meta.runError = runError.slice(0, 300);
    if (THROTTLE.test(runError)) acc.meta.flags.push('throttled');
  }
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

/**
 * Throws when a directory at or above `dir` (the scratch root Kiro runs are made under) holds a `.kiro/skills/ws-*`
 * skill: the konductor agents load the skill glob .kiro/skills/ws-STAR/SKILL.md, so such a dir could hand a run workspace
 * skills it was not given (DEBT D-36). Returns the real path.
 * shortcut: whether Kiro CLI resolves that glob only in the run cwd or also above it is not checked (it needs a real
 * run); the guard refuses both, which costs nothing on a host whose scratch root sits under /tmp or /var/tmp.
 */
function checkScratchRoot(dir) {
  const real = fs.realpathSync(dir);
  for (let d = real; ; d = path.dirname(d)) {
    const skillsDir = path.join(d, '.kiro', 'skills');
    let ws = [];
    try { ws = fs.readdirSync(skillsDir).filter((n) => n.startsWith('ws-')); } catch { /* none here */ }
    if (ws.length) throw new Error(`Kiro scratch dir ${real} is at or below ${d}, whose .kiro/skills holds ${ws.join(', ')}; the konductor agents load .kiro/skills/ws-* skills, so a run could see them. Set TMPDIR to a directory with no .kiro/skills/ws-* above it, for example /var/tmp/<name>`);
    if (d === path.dirname(d)) return real;
  }
}

const rc = () => require('../../sdk').runconfig;

/** The kiro-cli model list (`chat --list-models`) under a scratch HOME with the auth db copied in. */
function listModels(kiroBin, authDb, scratchDir, envKeep, agentEngine) {
  const dir = fs.mkdtempSync(path.join(scratchDir, 'm-'));
  try {
    sandbox.copyAuthDb(authDb, dir);
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    const { env: childEnv } = buildChildEnv(process.env, { home: dir, agentEngine, keep: envKeep });
    return require('node:child_process').execFileSync(kiroBin, ['chat', '--list-models', '-f', 'json'], { env: childEnv, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The environment facts a run records (run-harness.js envInfoOf): the CLI version and its model list, in `<outDir>/model-list.json`. */
function runEnvInfo({ ctx, outDir, authDb, scratchDir, envKeep, config }) {
  const modelListPath = path.join(outDir, 'model-list.json');
  fs.writeFileSync(modelListPath, listModels(ctx.kiroBin, authDb, scratchDir, envKeep, config.agentEngine));
  return { kiroCliVersion: sandbox.kiroCliVersion(ctx.kiroBin), modelListSnapshotPath: modelListPath };
}

/** The harness part of the run config (run-harness.js harnessRunConfig): the env policy and which kiro binary ran. */
function harnessRunConfig({ envKeep, kiro }) {
  return {
    requireMcpStartup: true,
    env: rc().envPolicy(process.env, envKeep),
    kiroBinary: { path: kiro.bin, bypassedShim: kiro.shim },
    kiroEnabledFeatures: process.env.KIRO_ENABLED_FEATURES ?? null,
    agentEnginesAvailable: rc().availableEngines(kiro.bin),
  };
}

/** The agent env env.json describes: the runner's child env for a konductor or vanilla arm. */
const envOfArm = ({ konductor, config, envKeep }) => buildChildEnv(process.env, { home: '<run-home>', agentEngine: config.agentEngine, keep: envKeep, konductor });

// Where an install serves skills, relative to HOME (startup.js installedSkills): the skills MCP server's root, and the
// SOPs the install wraps as `sop-<name>` skills.
const skillDirs = Object.freeze({ served: '.konductor/skills', wrapped: '.kiro/skills' });

/** The run's startup config (startup.js startupRecord): the agent and where it came from, MCP servers, steering, skills. */
function startupConfig({ arm, home, cwd, read }) {
  const settings = read.readJson(path.join(home, '.kiro/settings/cli.json')) ?? {};
  const configured = settings['chat.defaultAgent'] ?? null;
  const agent = arm.agentOverride ?? arm.agent ?? configured ?? 'kiro_default';
  const agentSource = arm.agentOverride || arm.agent ? '--agent' : configured ? 'settings chat.defaultAgent' : 'built-in default';
  const agentFile = [path.join(cwd, '.kiro/agents', `${agent}.json`), path.join(home, '.kiro/agents', `${agent}.json`)].find((f) => fs.existsSync(f));
  return {
    agent, agentSource,
    mcpServers: [...(agentFile ? read.serversOf(agentFile) : []), ...read.serversOf(path.join(home, '.kiro/settings/mcp.json')), ...read.serversOf(path.join(cwd, '.kiro/settings/mcp.json'))],
    steering: [...read.filesUnder(path.join(home, '.kiro/steering')), ...read.filesUnder(path.join(cwd, '.kiro/steering'))],
    skills: read.skillCount(path.join(home, '.kiro/skills')) + read.skillCount(path.join(cwd, '.kiro/skills')),
  };
}

// The model a run uses when --model is not given.
const DEFAULT_MODEL = 'claude-sonnet-5.5';
/** The run's model config from --model and --effort (run-cmd.js), with the --agent-engine value. */
const modelConfig = ({ opts, agentEngine, defaultEffort }) => ({ model: opts.model || DEFAULT_MODEL, effort: opts.effort || defaultEffort, agentEngine });

module.exports = {
  id, meta, streams: require('./streams.js'), modelConfig, skillDirs, startupConfig, runEnvInfo, harnessRunConfig, envOfArm, listModels, DEFAULT_MODEL, checkScratchRoot, prepareArm: sandbox.prepareArm, requiredPaths: sandbox.KIRO_REQUIRED, trialInstall, vanillaSkillListing, skillListingOf, observedListing, installInto, buildCommand, env, removeCredentials, keepPaths,
  parseResult, aggregateRunDir, turnSummary, collectArtifacts, orchMetrics, kiroArgs, readTranscripts, copySessions, finalize,
};
