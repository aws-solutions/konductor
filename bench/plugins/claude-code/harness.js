// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code harness: `claude -p` on Amazon Bedrock, run from the real binary (never a launcher script, which can
// override the model, region and credentials). Konductor arms install the ref's `claude` harness content into the run's
// scratch HOME. Cost is the list-price USD the stream reports.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const { installedSkills } = require('../../runner/lib/startup.js');
const sandbox = require('../../runner/lib/sandbox.js');
const { ALLOW } = require('../../runner/lib/env.js');
const { ensureEmptyClaudeRules } = require('../../runner/lib/isolation-gates.js');
const { realHomes } = require('../../runner/lib/isolate.js');
const { scrubTreeDetailed } = require('../../runner/lib/hygiene.js');
const { secretLiterals } = require('../../runner/lib/scrub.js');
const skills = require('../../runner/lib/skills.js');
const { promptFor } = require('../../runner/lib/arm-opts.js');
const { writeArmConfig } = require('../../runner/lib/arm-config.js');
const { orchMetrics: computeOrchMetrics } = require('../../runner/lib/orch-metrics.js');
const { copyPlainFile } = require('../../runner/lib/safe-copy.js');
const parse = require('./parse.js');
const { turnStreamTexts } = require('../../runner/lib/autonomy.js');
const listing = require('./listing.js');
const { TEAM_ENV, GUIDE_ALLOW, applyTeamMode } = require('./team-mode.js');
const { plantPrompt, MCP_CONFIG_REL, SERVER_NAME: PLANT_SERVER } = require('../../runner/lib/plant/agent-file.js');

const id = 'claude-code';
const meta = require('./meta.js');
const PROVIDER = 'bedrock';
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-5-5';
const REGION = 'us-east-1';
const PERMISSION_MODE = 'acceptEdits';
const ALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'Read'];
// The built-ins of a plant arm: the Claude Code names of the Kiro plant agent's fs_read, fs_write (create and edit),
// execute_bash, glob and grep (agent-file.js BUILTIN_TOOLS). `mcp__plant` allows every tool of the plant server.
const PLANT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
const PLANT_ALLOWED_TOOLS = [`mcp__${PLANT_SERVER}`, ...PLANT_TOOLS];
// The run's own debug log, in its scratch HOME (removed with the run).
const RUN_DEBUG_FILE = 'claude-run-debug.log';
// The levels `claude --effort` takes (`claude --help` of 2.1.326: low, medium, high, xhigh, max). bench passes the level
// as given, so a Claude Code arm and a Kiro CLI arm at --effort high run at the same named level.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** `effort` when `claude --effort` takes it; throws naming the levels otherwise. */
function effortOf(effort) {
  if (!EFFORT_LEVELS.includes(effort)) throw new Error(`--effort ${effort} is not a claude --effort level (use ${EFFORT_LEVELS.join(', ')})`);
  return effort;
}
const DEFAULT_RUN_BUDGET_USD = 5;
const EXPECTED_AGENTS = 11;
// Claude Code starts these even with an empty config directory, so a vanilla arm is not empty.
const BUILTIN_AGENTS = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup'];
const THROTTLE = /throttl|too many requests|rate.?limit|\b429\b/i;
// ---- Binary: resolveClaude and the study's one-binary check live in bin.js (D-192) ----
const { resolveClaude, isPlantControl, claudeChanges, describeClaudeChanges, MIN_BINARY_BYTES, VALIDATED_VERSION, versionWarning, binaryContains, compareVersions } = require('./bin.js');

// ---- Model and credentials ----

/** The canonical id a run must report, from the model flag value. */
const canonicalModel = (model) => parse.canonicalModelOf(model);

// The credential variables and checks live in creds.js (D-192).
const { CREDENTIAL_VARS, PROFILE_VARS, credentialNames, checkCredentials } = require('./creds.js');

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

// With --aws-profile (ctx.awsCreds) each run reads the profile's keys when the cached ones are close to expiry; they
// go into this run's environment only, on top of the caller's (whose own AWS_* keys they replace).
const env = (o) => envSetup({ ...o, baseEnv: o.ctx?.awsCreds ? { ...(o.baseEnv ?? process.env), ...o.ctx.awsCreds.current() } : o.baseEnv }).env;

// ---- Command ----

// The prompt goes on stdin (`claude -p` reads it there when no prompt argument is given), not in argv: an agent that
// runs `pkill -f <text from its task>` would otherwise match, and kill, its own claude process.
// A later turn of a conversation (autonomy and scripted-user tasks) resumes the session with `--resume <session id>`
// (`claude --help`: "Resume a conversation by session ID") and sends the scripted reply on stdin. Every other flag is
// the same, so the arm, model, effort and tools do not change between turns. The per-turn budget applies to each turn.
// A plant arm (cc-plant-*) instead mounts the plant shim as its only MCP server (`--mcp-config`, the file openPlantRun
// writes into the run `home`), gets the one-line operator prompt the Kiro plant agent carries, and has the built-ins the
// Kiro plant agent lists (PLANT_TOOLS, by `--tools`, so no Task or other spawn tool exists) plus every plant tool allowed.
function buildCommand({ arm, task, config, ctx, resume = null, home = null }) {
  if (resume && !resume.sessionId) throw new Error('cannot resume a Claude Code conversation: the first turn recorded no session id');
  if (arm.plant && !home) throw new Error('a Claude Code plant command needs the run home, where the plant MCP config is');
  const args = [
    '-p',
    ...(resume ? ['--resume', resume.sessionId] : []),
    '--output-format', 'stream-json', '--verbose',
    '--model', config.model,
    '--max-budget-usd', String(ctx.runBudgetUsd ?? DEFAULT_RUN_BUDGET_USD),
    '--permission-mode', PERMISSION_MODE,
    '--effort', config.effort,
  ];
  if (arm.agent) args.push('--agent', arm.agent);
  if (!arm.vanilla && ctx.claude?.supportsHookEvents) args.push('--include-hook-events');
  if (arm.plant) args.push('--mcp-config', path.join(home, MCP_CONFIG_REL), '--append-system-prompt', plantPrompt(task.environment?.kind), '--tools', ...PLANT_TOOLS);
  // --strict-mcp-config ignores every MCP configuration but --mcp-config (user, project, enterprise): a plant arm gets the
  // shim only, every other arm no server. konductor's Claude install declares none, so its arm loses nothing.
  args.push('--strict-mcp-config');
  // The run's own skill listing lines ("Sending N skills"), read by parseResult and compared with the arm's probe (D-33).
  // Plant arms skip it: their controls read --debug-file as a listing probe.
  if (!arm.plant && home) args.push('--debug-file', path.join(home, RUN_DEBUG_FILE));
  // Last: the tool list is variadic.
  args.push('--allowedTools', ...(arm.plant ? PLANT_ALLOWED_TOOLS : ALLOWED_TOOLS));
  return { file: ctx.claude.bin, args, stdin: resume ? resume.prompt : promptFor(arm, task), display: `claude ${args.map((a) => JSON.stringify(a)).join(' ')} < prompt.txt` };
}

// ---- Arm ----

function prepareArm(arm, ctx) {
  const dir = sandbox.buildDirOf(ctx, 'claude', arm);
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
    // The install's SessionStart hook reads orchestration.mode from $HOME/.konductor/config.yml when the session starts.
    if (arm.armConfig) log.push(`arm config: ${writeArmConfig(home, arm.armConfig)}`);
  } else {
    log.push('vanilla: empty config directory, built-in agents and skills only');
  }
  ensureEmptyClaudeRules(configDir);
  // After the rules gate, which refuses the real config directory. --allowedTools stays on the command for both arms.
  if (!arm.vanilla) log.push(applyTeamMode(configDir));
  if (outDir) fs.writeFileSync(path.join(outDir, 'install.log'), `${log.join('\n')}\n`);
  return meta;
}

/**
 * Throws unless `dir`, a scratch root Claude Code runs and probes are made under, is safe from host skills. Claude Code
 * walks up from the run cwd and loads every `.claude/skills` it finds as project skills, so a scratch root under the real
 * HOME, or below any directory holding a `.claude` entry, would hand vanilla runs the owner's skills and konductor runs
 * more than konductor's. Returns the real path. `homes` defaults to the real homes.
 */
function checkScratchRoot(dir, { homes = realHomes() } = {}) {
  const real = fs.realpathSync(dir);
  const fix = 'Set TMPDIR to a directory outside HOME with no .claude above it, for example /var/tmp/<name>';
  const home = homes.find((h) => real === h || real.startsWith(h + path.sep));
  if (home) throw new Error(`Claude Code scratch dir ${real} is under the real HOME ${home}; Claude Code would load ${path.join(home, '.claude', 'skills')} as project skills. ${fix}`);
  for (let d = real; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.claude'))) throw new Error(`Claude Code scratch dir ${real} is below ${d}, which holds a .claude entry; Claude Code would load its skills as project skills. ${fix}`);
    if (d === path.dirname(d)) return real;
  }
}

function trialInstall(prepared, ctx) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    installInto(home, { arm: { vanilla: false, agent: 'konductor' }, prepared, ctx, config: ctx.config, outDir: null });
    prepared.skillInfo = skills.claudeSkillInfo(path.join(home, '.claude'), prepared.exportDir);
    prepared.skillsInstalled = installedSkills(home, 'claude-code');
    Object.assign(prepared, listingOf(home, { vanilla: false }, ctx));
    return [];
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/**
 * The skill listing a run of `arm` gets from the install in `home`, measured with no credentials in the environment
 * (listing.js): `{ skillListing, skillListingError }`.
 */
function listingOf(home, arm, ctx) {
  if (!ctx.claude?.bin) return { skillListing: null, skillListingError: 'no claude binary was resolved for this command' };
  const noCreds = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('AWS_')));
  const envFor = (extra) => ({ ...envSetup({ arm, ctx, home, tmpdir: path.join(home, 'tmp'), baseEnv: noCreds }).env, ...extra });
  fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });
  const r = listing.skillListing({ claude: ctx.claude, model: ctx.config.model, home, envFor, cacheDir: ctx.cacheDir ?? null, scratch: path.join(home, 'tmp') });
  return { skillListing: r.listing, skillListingError: r.error };
}

/** The listing of a vanilla arm: built-in skills only, from an empty config directory. */
function vanillaSkillListing(ctx) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    ensureEmptyClaudeRules(path.join(home, '.claude'));
    return listingOf(home, { vanilla: true }, ctx);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ---- Credentials, cleanup ----

// Credentials live only in the process environment. This removes an AWS directory a model could have made in its HOME.
function removeCredentials(home) {
  fs.rmSync(path.join(home, '.aws'), { recursive: true, force: true });
}

// Run cleanup (claude's task dirs under the temp dirs) lives in cleanup.js (D-192).
const { slugOf, cleanupRun, describeCleanup } = require('./cleanup.js');

// ---- Results ----

function turnSummary(streamText) {
  const a = parse.aggregateEvents(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText ?? a.lastText, askedUser: a.askedUser };
}

function readIfPresent(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// The result line's cost and token totals are cumulative within one conversation. Separate conversations (the
// sessions of a fresh-session task, one stream-N.jsonl each) are summed.
function sumSessions(a, outDir, canonical) {
  const per = turnStreamTexts(outDir).map((t) => parse.aggregateEvents(parseStream(t).events, { expectedModel: canonical }));
  const costs = per.map((p) => p.costUsd).filter((c) => c !== null);
  a.costUsd = costs.length ? costs.reduce((x, y) => x + y, 0) : null;
  a.costMissing = per.some((p) => p.costMissing);
  a.tokens = Object.fromEntries(Object.keys(a.tokens).map((k) => [k, per.reduce((x, p) => x + (p.tokens[k] ?? 0), 0)]));
}

/** The listing lines of a run's own debug log in `home` (`{ sent, overBudget }`), or null when the run wrote none. */
function runListingOf(home) {
  const text = readIfPresent(path.join(home, RUN_DEBUG_FILE));
  return text ? listing.parseDebug(text) : null;
}

function parseResult(outDir, { home, tmpdir, acc, arm, ctx, config, freshSessions = false }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events, badLines } = parseStream(streamText);
  const canonical = config.canonicalModel ?? canonicalModel(config.model);
  const a = parse.aggregateEvents(events, { expectedModel: canonical });
  if (freshSessions) sumSessions(a, outDir, canonical);
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
    runListing: home ? runListingOf(home) : null,
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
  for (const [rel, name] of [['.claude/settings.json', 'installed-settings.json'], [MCP_CONFIG_REL, 'installed-mcp.json']]) {
    copyPlainFile(home, rel, path.join(outDir, name));
  }
}

// Every key handed to a run, from the environment or read from --aws-profile, is a secret.
const secrets = (ctx) => [...CREDENTIAL_VARS.map((k) => process.env[k]), ...(ctx?.awsCreds ? ctx.awsCreds.values() : [])].filter((v) => typeof v === 'string' && v.length >= 8);

// A model can print its environment, so exact credential values are scrubbed from every output file.
function finalize(outDir, ctx) {
  return scrubTreeDetailed(outDir, secretLiterals(process.env, secrets(ctx)), { shapes: true });
}

/** What run-config.json records about a Claude Code batch: names and settings, never credential values. */
function runConfigRecord({ ctx, config, region, runBudgetUsd, arms = [] }) {
  const konductor = envSetup({ arm: { vanilla: false }, ctx: { region }, home: '<run-home>', baseEnv: Object.fromEntries(CREDENTIAL_VARS.map((k) => [k, '<set>'])) });
  return {
    binaryName: path.basename(ctx.claude.bin), version: ctx.claude.version, binarySha256: ctx.claude.sha256, supportsHookEvents: ctx.claude.supportsHookEvents,
    provider: PROVIDER, modelId: config.model, canonicalModel: config.canonicalModel, region,
    permissionMode: PERMISSION_MODE, allowedTools: ALLOWED_TOOLS,
    teamMode: { arms: 'konductor arms only', settingsEnv: { [TEAM_ENV]: '1' }, permissionsAllow: GUIDE_ALLOW, note: 'claude -p spawns no teammates (Claude Code agent-teams docs); named sub-agents run as ordinary sub-agents' },
    maxBudgetUsdPerRun: runBudgetUsd ?? DEFAULT_RUN_BUDGET_USD,
    flags: ['-p', '--output-format stream-json', '--verbose', '--model', '--max-budget-usd', '--permission-mode', '--effort', '--strict-mcp-config', '--allowedTools', '--agent (konductor arms)', ...(ctx.claude.supportsHookEvents ? ['--include-hook-events (konductor arms)'] : [])],
    effort: { applied: true, flag: '--effort', level: config.effort },
    credentials: ctx.awsCreds
      ? { mode: 'profile (keys read with aws configure export-credentials and exported to each run; no profile variables)', profile: ctx.awsCreds.profile, refresh: 'read again before a run when the cached keys carry no expiry or expire within 15 minutes', variableNames: CREDENTIAL_VARS, notPassedWhenSet: PROFILE_VARS.filter((k) => process.env[k] !== undefined) }
      : { mode: 'environment (exported keys; no profile variables)', variableNames: credentialNames(), notPassedWhenSet: PROFILE_VARS.filter((k) => process.env[k] !== undefined) },
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

// run-one records the startup MCP list as empty for this harness, because every command passes --strict-mcp-config.
const strictMcp = true;

const rc = () => require('../../runner/lib/runconfig.js');

// Where an install serves skills, relative to HOME (startup.js installedSkills): ~/.claude/skills holds both.
const skillDirs = Object.freeze({ served: '.claude/skills', wrapped: '.claude/skills' });

/**
 * The run's startup config (startup.js startupRecord): the agent and where it came from, the MCP servers (listed as
 * ignored under --strict-mcp-config), the rules and CLAUDE.md files, and the skills.
 */
function startupConfig({ arm, home, cwd, strictMcp, read }) {
  const configDir = path.join(home, '.claude');
  const settings = read.readJson(path.join(configDir, 'settings.json')) ?? {};
  const declared = [...read.serversOf(path.join(configDir, '.claude.json')), ...read.serversOf(path.join(home, '.claude.json')), ...read.serversOf(path.join(cwd, '.mcp.json'))];
  return {
    agent: arm.agentOverride ?? arm.agent ?? settings.agent ?? 'default',
    agentSource: arm.agentOverride || arm.agent ? '--agent' : settings.agent ? 'settings agent' : 'built-in default',
    ...(strictMcp ? { mcpIgnored: declared } : { mcpServers: declared }),
    steering: [
      ...read.filesUnder(path.join(configDir, 'rules')),
      ...[path.join(configDir, 'CLAUDE.md'), path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude/CLAUDE.md')].filter((f) => fs.existsSync(f)),
    ],
    skills: read.skillCount(path.join(configDir, 'skills')) + read.skillCount(path.join(cwd, '.claude/skills')),
  };
}

/**
 * The keys of a run (run-cmd.js), checked before anything starts: from the environment `env`, or with --aws-profile read
 * from that profile before each run that needs fresh ones (`creds`, else null). A bench plant control as --claude-bin
 * calls no model, so it needs no keys (D-113). Throws when the keys are missing.
 */
function runCredentials({ opts, deps = {}, env: baseEnv = process.env }) {
  const { profileCredentials } = require('../../runner/lib/aws-creds.js');
  const creds = opts['aws-profile'] !== undefined ? profileCredentials(opts['aws-profile'] === true ? '' : String(opts['aws-profile']), deps.readAwsProfile ? { read: deps.readAwsProfile } : {}) : null;
  const control = typeof opts['claude-bin'] === 'string' && isPlantControl(path.resolve(opts['claude-bin']));
  if (!control) checkCredentials(creds ? { ...baseEnv, ...creds.current() } : baseEnv);
  return { creds };
}

/** The run flags (run-cmd.js): --run-budget-usd (positive), --aws-region, and a Bedrock model id. */
function runOptions({ opts }) {
  let runBudgetUsd = null;
  if (opts['run-budget-usd'] !== undefined) {
    runBudgetUsd = Number(opts['run-budget-usd']);
    if (opts['run-budget-usd'] === true || !(runBudgetUsd > 0)) throw new Error('--run-budget-usd must be a positive number');
  }
  if (!canonicalModel(opts.model || DEFAULT_MODEL)) throw new Error('--model needs a Bedrock model id, for example us.anthropic.claude-sonnet-5-5');
  return { runBudgetUsd, region: opts['aws-region'] && opts['aws-region'] !== true ? opts['aws-region'] : REGION };
}

const flagValueOf = (opts, name) => (opts[name] && opts[name] !== true ? opts[name] : null);

/**
 * The claude binary, region, per-run budget and credentials of a run, set on `ctx` (run-cmd.js, DEBT D-24). Throws when
 * the binary has no --effort, or when `outDir` holds runs of another claude binary and --allow-claude-change is not given.
 */
function setUpRun(ctx, { opts, config, outDir, ccRegion, runBudgetUsd, ccCreds, log }) {
  const { readRunConfigs } = require('../../runner/lib/run-configs.js');
  const toolsDir = flagValueOf(opts, 'claude-tools-dir');
  ctx.claude = resolveClaude({ binOverride: flagValueOf(opts, 'claude-bin') ?? undefined, toolsDir: toolsDir ?? undefined });
  if (!ctx.claude.supportsEffort) throw new Error(`${ctx.claude.bin} (claude ${ctx.claude.version}) has no --effort flag, so the run could not apply --effort ${config.effort}; use a claude that lists --effort in claude --help`);
  const claudeChanged = claudeChanges(readRunConfigs(outDir), ctx.claude);
  if (claudeChanged.length && !opts['allow-claude-change']) throw new Error(describeClaudeChanges(claudeChanged, ctx.claude, outDir, toolsDir));
  if (claudeChanged.length) log(`warning: --allow-claude-change: ${describeClaudeChanges(claudeChanged, ctx.claude, outDir, toolsDir).split('. One study')[0]}`);
  Object.assign(ctx, { region: ccRegion, runBudgetUsd, ...(ccCreds ? { awsCreds: ccCreds } : {}) });
  const credsNote = ccCreds ? `credentials from profile ${ccCreds.profile}, read again before a run when they expire within 15 minutes` : `credentials from the environment (${credentialNames().join(', ')})`;
  log(`claude ${ctx.claude.version} (${ctx.claude.bin}), sha256 ${ctx.claude.sha256.slice(0, 12)}, model ${config.model} (canonical ${config.canonicalModel}), effort ${config.effort}, region ${ccRegion}, permission mode ${PERMISSION_MODE}, per-run budget $${runBudgetUsd ?? DEFAULT_RUN_BUDGET_USD}, ${credsNote}`);
  const versionNote = versionWarning(ctx.claude.version);
  if (versionNote) log(`warning: ${versionNote}`);
  const shadow = PROFILE_VARS.filter((k) => process.env[k]);
  if (shadow.length) log(`note: ${shadow.join(', ')} ${shadow.length === 1 ? 'is' : 'are'} set here and is not passed to claude (the SDK would skip the exported keys)`);
}

/** The environment facts a run records (run-harness.js envInfoOf): the claude version and region. */
const runEnvInfo = ({ ctx, ccRegion }) => ({ kiroCliVersion: null, harnessVersion: ctx.claude.version, modelListSnapshotPath: null, region: ccRegion });

/** The harness part of the run config (run-harness.js harnessRunConfig). */
function harnessRunConfig({ ctx, config, ccRegion, runBudgetUsd, arms }) {
  return { harnessVersion: ctx.claude.version, claudeCode: runConfigRecord({ ctx, config, region: ccRegion, runBudgetUsd, arms }), env: rc().envPolicy(process.env, []) };
}

/** The agent env env.json describes for a konductor or vanilla arm, with the credential names shown as set. */
const envOfArm = ({ konductor, ctx }) => envSetup({ arm: { vanilla: !konductor }, ctx, home: '<run-home>', tmpdir: '<run>/tmp', baseEnv: { ...process.env, ...Object.fromEntries(CREDENTIAL_VARS.map((k) => [k, '<set>'])) } });

/** The run's model config from --model and --effort (run-cmd.js): the Bedrock id, its canonical name, the effort word. */
function modelConfig({ opts, defaultEffort }) {
  const model = opts.model || DEFAULT_MODEL;
  return { model, canonicalModel: canonicalModel(model), effort: effortOf(opts.effort || defaultEffort) };
}

module.exports = {
  id, meta, modelConfig, runCredentials, runOptions, setUpRun, skillDirs, startupConfig, runEnvInfo, harnessRunConfig, envOfArm, strictMcp, PROVIDER, DEFAULT_MODEL, REGION, PERMISSION_MODE, ALLOWED_TOOLS, PLANT_TOOLS, PLANT_ALLOWED_TOOLS, EFFORT_LEVELS, effortOf, DEFAULT_RUN_BUDGET_USD, EXPECTED_AGENTS, BUILTIN_AGENTS, CREDENTIAL_VARS, PROFILE_VARS,
  prepareArm, requiredPaths: ['cli/konductor-rs/Cargo.toml'], trialInstall, vanillaSkillListing, checkScratchRoot, installInto, buildCommand, env, streams: require('./streams.js'), credentialEnv: CREDENTIAL_VARS, envSetup, removeCredentials, keepPaths,
  parseResult, turnSummary, collectArtifacts, orchMetrics, finalize, secrets, cleanupRun, describeCleanup, runConfigRecord,
  listingMismatch: listing.listingMismatch, resolveClaude, isPlantControl, claudeChanges, describeClaudeChanges, MIN_BINARY_BYTES, VALIDATED_VERSION, versionWarning, binaryContains, compareVersions, canonicalModel, checkCredentials, credentialNames, checkInstalledAgents, agentPins, slugOf,
};
