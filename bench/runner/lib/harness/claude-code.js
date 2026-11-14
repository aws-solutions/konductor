// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code harness: `claude -p` on Amazon Bedrock, run from the real binary (never a launcher script, which can
// override the model, region and credentials). Konductor arms install the ref's `claude` harness content into the run's
// scratch HOME. Cost is the list-price USD the stream reports.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStream } = require('../stream.js');
const sandbox = require('../sandbox.js');
const { ALLOW } = require('../env.js');
const { ensureEmptyClaudeRules } = require('../isolation-gates.js');
const { scrubTreeDetailed } = require('../hygiene.js');
const { secretLiterals } = require('../scrub.js');
const skills = require('../skills.js');
const { promptFor } = require('../arm-opts.js');
const { orchMetrics: computeOrchMetrics } = require('../orch-metrics.js');
const { copyPlainFile, assertPlainPath } = require('../safe-copy.js');
const parse = require('./claude-code-parse.js');

const id = 'claude-code';
const meta = require('./claude-code-meta.js');
const PROVIDER = 'bedrock';
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-5-5';
const REGION = 'us-east-1';
const PERMISSION_MODE = 'acceptEdits';
const ALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'Read'];
const DEFAULT_RUN_BUDGET_USD = 5;
// The Claude Code version the stream parser and the harness flags were checked against.
const VALIDATED_VERSION = '2.1.316.1544';
const EXPECTED_AGENTS = 11;
// Claude Code starts these even with an empty config directory, so a vanilla arm is not empty.
const BUILTIN_AGENTS = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup'];
const CREDENTIAL_VARS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
// With any of these set the AWS SDK ignores the exported keys and looks the profile up in the scratch HOME.
const PROFILE_VARS = ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE'];
const THROTTLE = /throttl|too many requests|rate.?limit|\b429\b/i;
// The real binary is a few hundred MB; a launcher script is a few KB.
const MIN_BINARY_BYTES = 50 * 1024 * 1024;

// ---- Binary ----

const versionKey = (v) => v.split('.').map((n) => Number(n) || 0);
function compareVersions(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Why `bin` is not the claude binary, or null when it looks like it: the resolved file is named `claude` and is large. */
function launcherProblem(bin, minBytes) {
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* judged by the given path */ }
  if (path.basename(real) !== 'claude') return `its file name is ${path.basename(real)}, not claude`;
  let size = 0;
  try { size = fs.statSync(real).size; } catch { /* reported as too small */ }
  if (size < minBytes) return `it is ${size} bytes, far smaller than the real binary`;
  return null;
}

const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };

/** Whether the file contains the bytes of `needle`. Reads in chunks; the Claude Code binary is a few hundred MB. */
function binaryContains(file, needle) {
  const want = Buffer.from(needle);
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  let tail = Buffer.alloc(0);
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) return false;
      const hay = Buffer.concat([tail, chunk.subarray(0, n)]);
      if (hay.includes(want)) return true;
      tail = hay.subarray(Math.max(0, hay.length - (want.length - 1)));
    }
  } finally { fs.closeSync(fd); }
}

/**
 * The claude binary a run uses: `binOverride` (or BENCH_CLAUDE_BIN), else the newest `<version>/claude` under `toolsDir`
 * (or BENCH_CLAUDE_TOOLS_DIR). There is no default location. A launcher script is refused.
 */
function resolveClaude({ binOverride = process.env.BENCH_CLAUDE_BIN || null, toolsDir = process.env.BENCH_CLAUDE_TOOLS_DIR || null, minBytes = MIN_BINARY_BYTES } = {}) {
  let bin = binOverride ? path.resolve(binOverride) : null;
  let version = null;
  if (!bin) {
    if (!toolsDir) throw new Error('no claude binary given; pass --claude-bin PATH or --claude-tools-dir DIR (BENCH_CLAUDE_BIN, BENCH_CLAUDE_TOOLS_DIR)');
    let versions = [];
    try {
      versions = fs.readdirSync(toolsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d+(\.\d+)+$/.test(e.name) && executable(path.join(toolsDir, e.name, 'claude')))
        .map((e) => e.name);
    } catch { /* reported below */ }
    if (!versions.length) throw new Error(`no claude binary found under ${toolsDir} (expected <version>/claude); pass --claude-bin PATH`);
    version = versions.sort(compareVersions).at(-1);
    bin = path.join(toolsDir, version, 'claude');
  }
  if (!executable(bin)) throw new Error(`claude binary is not executable: ${bin}`);
  const problem = launcherProblem(bin, minBytes);
  if (problem) throw new Error(`${bin}: this is a launcher, not the claude binary; it can override the model, region and credentials (${problem}). Pass the real binary with --claude-bin PATH or --claude-tools-dir DIR`);
  version = version ?? path.basename(path.dirname(bin)).match(/^\d+(\.\d+)+$/)?.[0] ?? 'unknown';
  return { bin, version, sha256: sandbox.sha256File(bin), supportsHookEvents: binaryContains(bin, '--include-hook-events') };
}

/** A warning line when `version` is not the one the harness was validated against, else null. */
const versionWarning = (version) => (version === VALIDATED_VERSION ? null : `claude ${version} differs from ${VALIDATED_VERSION}, the version this harness was validated against; stream fields or flags may differ`);

// ---- Model and credentials ----

/** The canonical id a run must report, from the model flag value. */
const canonicalModel = (model) => parse.canonicalModelOf(model);

/** Names (never values) of the credential variables present in `env`. */
const credentialNames = (env = process.env) => CREDENTIAL_VARS.filter((k) => env[k]);

/** Throws when the credentials a run needs are not in the caller's environment. Values never appear in the message. */
function checkCredentials(env = process.env) {
  const missing = CREDENTIAL_VARS.slice(0, 2).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Claude Code runs take AWS credentials from the environment; missing ${missing.join(', ')} (export them in the shell that starts the bench, for example from \`aws configure export-credentials --format env\`)`);
  if (/^ASIA/.test(env.AWS_ACCESS_KEY_ID) && !env.AWS_SESSION_TOKEN) throw new Error('AWS_ACCESS_KEY_ID is a temporary key (ASIA...) but AWS_SESSION_TOKEN is not set');
  const shadow = PROFILE_VARS.filter((k) => env[k]);
  return { shadow };
}

// ---- Environment ----

function envSetup({ arm, ctx, home, tmpdir, baseEnv = process.env }) {
  const env = {};
  for (const k of ALLOW) if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
  const region = ctx?.region ?? REGION;
  const runTmp = tmpdir || path.join(home, 'tmp');
  const set = {
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    TMPDIR: runTmp,
    CLAUDE_CODE_TMPDIR: runTmp,
    TERM: 'dumb',
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
    AWS_EC2_METADATA_DISABLED: 'true',
    DISABLE_TELEMETRY: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  if (!arm.vanilla) set.KONDUCTOR_TELEMETRY = 'off';
  // Credentials pass through from the caller's environment only; they are never written to a file.
  for (const k of CREDENTIAL_VARS) if (baseEnv[k]) set[k] = baseEnv[k];
  Object.assign(env, set);
  return { env, set, unset: PROFILE_VARS.filter((k) => baseEnv[k] !== undefined), keys: Object.keys(env).sort() };
}

const env = (o) => envSetup(o).env;

// ---- Command ----

function buildCommand({ arm, task, config, ctx, resume = null }) {
  if (resume) throw new Error('multi-turn (autonomy) tasks are not supported on the Claude Code harness yet; the resume flags have not been verified');
  const args = [
    '-p', promptFor(arm, task),
    '--output-format', 'stream-json', '--verbose',
    '--model', config.model,
    '--max-budget-usd', String(ctx.runBudgetUsd ?? DEFAULT_RUN_BUDGET_USD),
    '--permission-mode', PERMISSION_MODE,
  ];
  if (arm.agent) args.push('--agent', arm.agent);
  if (!arm.vanilla && ctx.claude?.supportsHookEvents) args.push('--include-hook-events');
  // Last: the tool list is variadic.
  args.push('--allowedTools', ...ALLOWED_TOOLS);
  return { file: ctx.claude.bin, args, display: `claude ${args.map((a) => JSON.stringify(a)).join(' ')}` };
}

// ---- Arm ----

function prepareArm(arm, ctx) {
  const dir = path.join(ctx.cacheDir, `${arm.id}-${arm.cacheKey ?? arm.commitSha.slice(0, 12)}`);
  const exportDir = path.join(dir, 'src');
  const bin = path.join(dir, 'konductor');
  const readyFile = path.join(dir, '.ready');
  try {
    const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    if (sandbox.readyMatches(ready, arm) && fs.existsSync(bin) && sandbox.sha256File(bin) === ready.cliSha256 && fs.existsSync(path.join(exportDir, 'dist', 'claude'))) {
      return { exportDir, bin, mcpSha256: null, cliSha256: ready.cliSha256, cached: true };
    }
  } catch { /* rebuild */ }
  fs.rmSync(dir, { recursive: true, force: true });
  (ctx.claudeBuild ?? defaultBuild)(arm, ctx, { dir, exportDir, bin });
  const cliSha256 = sandbox.sha256File(bin);
  fs.writeFileSync(readyFile, JSON.stringify({ commitSha: arm.commitSha, contentHash: arm.contentHash ?? null, cliSha256 }) + '\n');
  return { exportDir, bin, mcpSha256: null, cliSha256, cached: false };
}

function defaultBuild(arm, ctx, { exportDir, bin }) {
  sandbox.exportArm(arm, ctx, exportDir);
  sandbox.buildCli(exportDir, bin, ctx);
  sandbox.synthArm(bin, exportDir);
}

/** Model lines of the installed agent files: { file -> value }. */
function agentPins(agentsDir) {
  const pins = {};
  for (const f of fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort()) {
    const m = /^model:\s*["']?([^"'\s]+)["']?\s*$/m.exec(fs.readFileSync(path.join(agentsDir, f), 'utf8'));
    pins[f.replace(/\.md$/, '')] = m ? m[1] : null;
  }
  return pins;
}

/**
 * Refuses an install whose agents are not all pinned to the canonical model (a dotted pin is not a Bedrock id, and a
 * sub-agent on another model would make the arms differ), or that lacks the entry agent or the expected agent count.
 */
function checkInstalledAgents(home, { canonical, entryAgent = 'konductor', expectedAgents = EXPECTED_AGENTS }) {
  const dir = path.join(home, '.claude', 'agents');
  if (!fs.existsSync(dir)) throw new Error(`the install wrote no agents under ${dir}`);
  const pins = agentPins(dir);
  const names = Object.keys(pins);
  if (!names.includes(entryAgent)) throw new Error(`--arm-agent: agent "${entryAgent}" is not installed by this arm`);
  const bad = names.filter((n) => pins[n] !== canonical);
  if (bad.length) throw new Error(`installed agents not pinned to model ${canonical}: ${bad.map((n) => `${n}=${pins[n] ?? 'none'}`).join(', ')} (this ref predates the dashed model pin)`);
  if (expectedAgents != null && names.length !== expectedAgents) throw new Error(`expected ${expectedAgents} installed agents, found ${names.length}`);
  return { agents: names, count: names.length };
}

function installKonductor(home, prepared, ctx) {
  const run = ctx.claudeInstall ?? ((h, p) => sandbox.runKonductor(p.bin, ['install', '--harness', 'claude', '--from', p.exportDir, '--no-telemetry'], { home: h }).stdout);
  return run(home, prepared);
}

function installInto(home, { arm, prepared, ctx, config, outDir }) {
  const configDir = path.join(home, '.claude');
  fs.mkdirSync(configDir, { recursive: true });
  const meta = { modelNormalized: false, rewrittenAgents: [] };
  const log = [`claude ${ctx.claude?.version ?? 'unknown'}, model ${config.model}, canonical ${config.canonicalModel}, permission mode ${PERMISSION_MODE}`];
  if (!arm.vanilla) {
    log.push(String(installKonductor(home, prepared, ctx) ?? '').trim());
    const installed = checkInstalledAgents(home, { canonical: config.canonicalModel, entryAgent: arm.agentOverride ?? arm.agent ?? 'konductor', expectedAgents: ctx.expectedAgentCount === undefined ? EXPECTED_AGENTS : ctx.expectedAgentCount });
    meta.installedAgents = installed.count;
    log.push(`agents (${installed.count}): ${installed.agents.join(', ')}`, `pin: model ${config.canonicalModel} on every agent`);
  } else {
    log.push('vanilla: empty config directory, built-in agents and skills only');
  }
  ensureEmptyClaudeRules(configDir);
  if (outDir) fs.writeFileSync(path.join(outDir, 'install.log'), `${log.join('\n')}\n`);
  return meta;
}

function trialInstall(prepared, ctx) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    installInto(home, { arm: { vanilla: false, agent: 'konductor' }, prepared, ctx, config: ctx.config, outDir: null });
    prepared.skillInfo = skills.claudeSkillInfo(path.join(home, '.claude'), prepared.exportDir);
    return [];
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ---- Credentials, cleanup ----

// Credentials live only in the process environment. This removes an AWS directory a model could have made in its HOME.
function removeCredentials(home) {
  fs.rmSync(path.join(home, '.aws'), { recursive: true, force: true });
}

const slugOf = (cwd) => {
  let real = cwd;
  try { real = fs.realpathSync(cwd); } catch { /* the directory is already gone */ }
  return real.replace(/[^A-Za-z0-9]/g, '-');
};

// The run's own TMPDIR is agent-writable, so a link there must not steer the delete at a host folder. The shared temp
// dir may itself sit behind a link (macOS /var), so only the parts below it are checked.
function isPlainTaskDir(base, runTmpdir, rel) {
  try {
    if (base === runTmpdir && fs.lstatSync(base).isSymbolicLink()) return false;
    assertPlainPath(base, rel, { last: 'dir' });
    return true;
  } catch { return false; }
}

/**
 * Claude Code writes task output under <tmp>/claude-<uid>/<cwd slug>/..., outside HOME. The run's temp directory is given to
 * the process as TMPDIR and CLAUDE_CODE_TMPDIR, and this removes what it made there or in the default temp directory. The cwd slug is unique to the run, so
 * parallel runs never touch each other's files.
 */
function cleanupRun({ cwd, tmpdir, tmpBases = [os.tmpdir()], uid = process.getuid ? process.getuid() : null }) {
  if (uid === null) return [];
  const slug = slugOf(cwd);
  const removed = [];
  for (const base of new Set([tmpdir, ...tmpBases].filter(Boolean))) {
    const root = path.join(base, `claude-${uid}`);
    const dir = path.join(root, slug);
    if (!isPlainTaskDir(base, tmpdir, path.join(`claude-${uid}`, slug))) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
    try { if (!fs.readdirSync(root).length) fs.rmdirSync(root); } catch { /* another run uses it */ }
  }
  return removed;
}

/** Where cleanupRun found claude's task directory: in the run's own TMPDIR (claude honors it) or in the default temp dir. */
function describeCleanup(removed, tmpdir) {
  const inRun = removed.filter((d) => d.startsWith(`${tmpdir}${path.sep}`)).length;
  return { removed: removed.length, inRunTmpdir: inRun, inDefaultTmp: removed.length - inRun };
}

// ---- Results ----

function turnSummary(streamText) {
  const a = parse.aggregateEvents(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText ?? a.lastText, askedUser: a.askedUser };
}

function readIfPresent(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function parseResult(outDir, { home, tmpdir, acc, arm, ctx, config }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events, badLines } = parseStream(streamText);
  const canonical = config.canonicalModel ?? canonicalModel(config.model);
  const a = parse.aggregateEvents(events, { expectedModel: canonical });
  const stderr = readIfPresent(path.join(outDir, 'stderr.txt'));
  const flags = acc.meta.flags;
  acc.skills = skills.captureSkills({ runtime: 'claude-code', events, arm, ctx });
  acc.transcript = { bytes: Buffer.byteLength(streamText), chars: streamText.length, partial: false };

  if (a.errorKind === 'credentials') acc.meta.infraError = [acc.meta.infraError, 'Claude Code could not load AWS credentials (cloud_credential_error); this is not a model failure'].filter(Boolean).join(' | ');
  if (a.permissionDenials.length) flags.push('permissionDenied');
  if (THROTTLE.test([...a.errors, ...Object.keys(a.retries), stderr.slice(-4000)].join('\n'))) flags.push('throttled');
  if (a.modelIdentity.offending.length > 0) flags.push('modelMismatch');
  if (a.errorKind === 'api' || a.errorKind === 'other') acc.meta.runError = a.errors[0]?.slice(0, 300) ?? null;
  if (a.costBasis && a.costBasis !== 'list') flags.push('costBasisNotList');
  if (a.costMissing) flags.push('costMissing');
  if (badLines > 0) flags.push('streamTruncated');

  const finalText = a.finalText === null ? null : a.finalText.slice(0, 20000);
  acc.agg = {
    delegatedTo: a.delegatedTo,
    sessionId: a.sessionId, sessionIds: a.sessionIds, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason,
    credits: 0, meteringEntries: 0, nonCreditUnits: [], turnDurationMs: a.turnDurationMs, contextUsagePercentage: null,
    toolCalls: a.toolCalls, workToolCalls: a.workToolCalls, subagentCalls: a.subagentCalls, toolNames: a.toolNames, skillsMcpOk: null,
    finalText, finalTextTruncated: a.finalText === null ? null : a.finalText.length > 20000, askedUser: a.askedUser,
  };
  const models = a.modelIdentity.canonicalModels.length ? a.modelIdentity.canonicalModels : a.modelIdentity.messageModels;
  acc.session = { model: a.modelIdentity.offending[0] ?? models[0] ?? null, models: [...new Set([...models, ...a.modelIdentity.messageModels])], totalRequestCount: a.modelCalls };
  acc.usage = { tokens: a.tokens, costUsd: a.costUsd, modelCalls: a.modelCalls, sessions: 1 + a.spawn.spawned, variants: [] };
  acc.meta.claudeCode = {
    version: ctx.claude?.version ?? null, canonicalModel: canonical, modelsSeen: a.modelIdentity.canonicalModels, messageModels: a.modelIdentity.messageModels,
    modelUsageKeys: a.modelUsageKeys, costBasis: a.costBasis, terminalReason: a.terminalReason, errorKind: a.errorKind,
    permissionDenials: a.permissionDenials.length, hookEvents: a.hooks.length, spawned: a.spawn.spawned, spawnFailed: a.spawn.failed,
    maxSpawnDepth: a.spawn.maxDepth, resultLines: a.resultCount, numTurns: a.numTurns, apiDurationMs: a.apiDurationMs,
    badLines, initAgents: a.init?.agents?.length ?? null, initSkills: a.init?.skills?.length ?? null, initTools: a.init?.tools ?? null,
  };
  return acc;
}

function orchMetrics(outDir) {
  const file = path.join(outDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return null;
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  const tree = parse.spawnTree(events);
  const a = parse.aggregateEvents(events);
  if (a.resultCount > 0) {
    tree.spawns = a.spawn.spawned;
    tree.maxSpawnDepth = Math.max(tree.maxSpawnDepth, a.spawn.maxDepth);
  }
  return computeOrchMetrics({ events, workspaceDir: path.join(outDir, 'workspace'), tree });
}

function collectArtifacts(home, outDir) {
  for (const [rel, name] of [['.claude/settings.json', 'installed-settings.json']]) {
    copyPlainFile(home, rel, path.join(outDir, name));
  }
}

const secrets = () => CREDENTIAL_VARS.map((k) => process.env[k]).filter((v) => typeof v === 'string' && v.length >= 8);

// A model can print its environment, so exact credential values are scrubbed from every output file.
function finalize(outDir) {
  return scrubTreeDetailed(outDir, secretLiterals(process.env, secrets()), { shapes: true });
}

/** What run-config.json records about a Claude Code batch: names and settings, never credential values. */
function runConfigRecord({ ctx, config, region, runBudgetUsd, arms = [] }) {
  const konductor = envSetup({ arm: { vanilla: false }, ctx: { region }, home: '<run-home>', baseEnv: Object.fromEntries(CREDENTIAL_VARS.map((k) => [k, '<set>'])) });
  return {
    binaryName: path.basename(ctx.claude.bin), version: ctx.claude.version, binarySha256: ctx.claude.sha256, supportsHookEvents: ctx.claude.supportsHookEvents,
    provider: PROVIDER, modelId: config.model, canonicalModel: config.canonicalModel, region,
    permissionMode: PERMISSION_MODE, allowedTools: ALLOWED_TOOLS, maxBudgetUsdPerRun: runBudgetUsd ?? DEFAULT_RUN_BUDGET_USD,
    flags: ['-p', '--output-format stream-json', '--verbose', '--model', '--max-budget-usd', '--permission-mode', '--allowedTools', '--agent (konductor arms)', ...(ctx.claude.supportsHookEvents ? ['--include-hook-events (konductor arms)'] : [])],
    effort: { applied: false, note: 'claude --effort is not passed; the effort field of a result is "default"' },
    credentials: { mode: 'environment (exported keys; no profile variables)', variableNames: credentialNames(), notPassedWhenSet: PROFILE_VARS.filter((k) => process.env[k] !== undefined) },
    envVarNames: konductor.keys,
    configDir: '<run>/home/.claude with an empty rules/empty.md', hooks: 'the SessionStart hook of the konductor install fires under -p (empty output in auto orchestration mode)',
    builtins: { agents: BUILTIN_AGENTS, note: 'Claude Code starts built-in agents and skills even with an empty config directory, so the vanilla arm is not empty' },
    expectedInstalledAgents: EXPECTED_AGENTS,
    sourceCommits: Object.fromEntries(arms.filter((a) => !a.vanilla).map((a) => [a.id, a.commitSha ?? a.contentHash ?? null])),
    cleanup: 'TMPDIR and CLAUDE_CODE_TMPDIR are set to <run>/tmp; whether claude honors either for /tmp/claude-<uid> is unverified, so the run removes <tmp>/claude-<uid>/<cwd slug> in both places',
    costBasis: 'list-price USD from result.total_cost_usd and modelUsage; a run killed before its result line is censored',
  };
}

const keepPaths = (ctx) => [ctx.claude?.bin].filter(Boolean);

module.exports = {
  id, meta, PROVIDER, DEFAULT_MODEL, REGION, PERMISSION_MODE, ALLOWED_TOOLS, DEFAULT_RUN_BUDGET_USD, EXPECTED_AGENTS, BUILTIN_AGENTS, CREDENTIAL_VARS, PROFILE_VARS,
  prepareArm, requiredPaths: ['cli/konductor-rs/Cargo.toml'], trialInstall, installInto, buildCommand, env, envSetup, removeCredentials, keepPaths,
  parseResult, turnSummary, collectArtifacts, orchMetrics, finalize, secrets, cleanupRun, describeCleanup, runConfigRecord,
  resolveClaude, MIN_BINARY_BYTES, VALIDATED_VERSION, versionWarning, binaryContains, compareVersions, canonicalModel, checkCredentials, credentialNames, checkInstalledAgents, agentPins, slugOf,
};
