// SPDX-License-Identifier: Apache-2.0
'use strict';

// The opencode harness: `opencode run` on Amazon Bedrock, pinned to one release. Konductor arms install the
// ref's `claude` harness content, translated to opencode agent files. Usage comes from the session database.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseStream } = require('../stream.js');
const sandbox = require('../sandbox.js');
const { ALLOW } = require('../env.js');
const { translateAll } = require('./opencode-translate.js');
const { aggregateEvents, queryRollup, totalTokens, zeroTokens } = require('./opencode-parse.js');
const { installCredentials, removeCredentials, readProfile } = require('./opencode-creds.js');
const { scrubTree } = require('../hygiene.js');
const skills = require('../skills.js');

const id = 'opencode';
const VERSION = '1.19.5';
const PROVIDER = 'amazon-bedrock';
const DEFAULT_MODEL = 'global.anthropic.claude-sonnet-5-5';
const REGION = 'us-east-1';
const VARIANTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Without --title opencode makes a hidden call to a small model whose usage is recorded nowhere.
const TITLE = 'bench';
const BUILTIN_AGENTS = ['build', 'plan', 'general', 'explore'];
const THROTTLE = /throttl|too many requests|rate.?limit|\b429\b/i;

function variantOf(effort) {
  if (!VARIANTS.includes(effort)) throw new Error(`--effort ${effort} has no opencode variant (use ${VARIANTS.join(', ')})`);
  return effort;
}

const platformPackages = () => {
  const base = `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  return [base, `${base}-baseline`];
};

function versionOfBin(bin) {
  return sandbox.versionOf(bin);
}

/**
 * The opencode binary this run uses. Without an override it is `opencode-ai@VERSION` installed into
 * `<cacheDir>/opencode-VERSION` (npm cache and HOME kept inside cacheDir, install scripts off, nothing global).
 */
function resolveOpencode({ cacheDir, binOverride = null }) {
  let bin = binOverride ? path.resolve(binOverride) : null;
  if (!bin) {
    const prefix = path.join(cacheDir, `opencode-${VERSION}`);
    const find = () => platformPackages().map((p) => path.join(prefix, 'node_modules', p, 'bin', 'opencode')).find((f) => fs.existsSync(f) && versionOfBin(f) === VERSION);
    bin = find();
    if (!bin) {
      const npmHome = path.join(cacheDir, 'npm-home');
      fs.mkdirSync(npmHome, { recursive: true });
      sandbox.run('npm', ['install', '--prefix', prefix, `opencode-ai@${VERSION}`, '--ignore-scripts', '--no-audit', '--no-fund'], {
        env: { ...process.env, HOME: npmHome, npm_config_cache: path.join(cacheDir, 'npm-cache') },
      });
      bin = find();
    }
    if (!bin) throw new Error(`opencode ${VERSION} binary not found after install under ${prefix}`);
  }
  const version = versionOfBin(bin);
  if (!version) throw new Error(`${bin} did not report a version`);
  if (!binOverride && version !== VERSION) throw new Error(`expected opencode ${VERSION}, found ${version}`);
  return { bin, version, sha256: sandbox.sha256File(bin), pinned: VERSION };
}

function resolveRipgrep(override, pathEnv = process.env.PATH) {
  if (override) return path.resolve(override);
  for (const dir of (pathEnv || '').split(path.delimiter).filter(Boolean)) {
    const f = path.join(dir, 'rg');
    try { fs.accessSync(f, fs.constants.X_OK); return fs.realpathSync(f); } catch { /* next */ }
  }
  return null;
}

function configJson({ konductor }) {
  const cfg = { $schema: 'https://opencode.ai/config.json', share: 'disabled', snapshot: false, autoupdate: false, enabled_providers: [PROVIDER] };
  if (konductor) cfg.agent = Object.fromEntries(BUILTIN_AGENTS.map((n) => [n, { disable: true }]));
  return cfg;
}

const countDirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;

// Fills the scratch HOME: config, translated agents and skills (konductor arms), a ripgrep copy, credentials.
function installInto(home, { arm, prepared, ctx, config, outDir, credentials = true }) {
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'opencode.json'), JSON.stringify(configJson({ konductor: !arm.vanilla }), null, 2) + '\n');
  const meta = {};
  const log = [`opencode ${ctx.opencode?.version ?? 'unknown'}, model ${PROVIDER}/${config.model}, variant ${variantOf(config.effort)}`];
  if (!arm.vanilla) {
    const t = translateAll(path.join(prepared.claudeDir, 'agents'), path.join(cfgDir, 'agents'), { model: `${PROVIDER}/${config.model}`, variant: variantOf(config.effort) });
    fs.cpSync(path.join(prepared.claudeDir, 'skills'), path.join(cfgDir, 'skills'), { recursive: true });
    meta.rewrittenAgents = t.agents;
    meta.modelNormalized = true;
    log.push(`agents: ${t.agents.join(', ')}`, `skipped variants: ${t.skipped.join(', ') || 'none'}`, `skills: ${countDirs(path.join(cfgDir, 'skills'))}`);
    for (const [name, tools] of Object.entries(t.dropped)) log.push(`dropped from ${name}: ${tools.join(', ')}`);
  }
  if (ctx.rgBin) {
    const rg = path.join(home, '.cache', 'opencode', 'bin', 'rg');
    fs.mkdirSync(path.dirname(rg), { recursive: true });
    fs.copyFileSync(ctx.rgBin, rg);
    fs.chmodSync(rg, 0o755);
  }
  if (credentials) installCredentials({ credsFile: ctx.awsCredsFile, profile: ctx.awsProfile, home, region: REGION });
  if (outDir) fs.writeFileSync(path.join(outDir, 'install.log'), `${log.join('\n')}\n`);
  return meta;
}

function envSetup({ arm, config, ctx, home, tmpdir }) {
  const env = {};
  for (const k of ALLOW) if (process.env[k] !== undefined) env[k] = process.env[k];
  const set = {
    HOME: home,
    TMPDIR: tmpdir || path.join(home, 'tmp'),
    TERM: 'dumb',
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    AWS_PROFILE: ctx.awsProfile,
    AWS_REGION: REGION,
    AWS_DEFAULT_REGION: REGION,
    AWS_SHARED_CREDENTIALS_FILE: path.join(home, '.aws', 'credentials'),
    AWS_CONFIG_FILE: path.join(home, '.aws', 'config'),
    AWS_EC2_METADATA_DISABLED: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_PURE: '1',
  };
  if (!arm.vanilla) set.KONDUCTOR_TELEMETRY = 'off';
  Object.assign(env, set);
  return { env, set, unset: [], keys: Object.keys(env).sort() };
}

const env = (o) => envSetup(o).env;

// resume: {sessionId, prompt} continues the session of an earlier turn (`-s`, or `-c` for the latest one).
function buildCommand({ arm, task, config, ctx, cwd, resume = null }) {
  const args = ['run', '--dir', cwd, '-m', `${PROVIDER}/${config.model}`, '--variant', variantOf(config.effort), '--format', 'json', '--auto', '--title', TITLE];
  if (arm.agent) args.push('--agent', arm.agent);
  if (resume) args.push(...(resume.sessionId ? ['-s', resume.sessionId] : ['-c']));
  args.push(resume ? resume.prompt : task.prompt);
  return { file: ctx.opencode.bin, args, display: `opencode ${args.map((a) => JSON.stringify(a)).join(' ')}` };
}

function dbRunner(bin, runEnv) {
  return (sql) => JSON.parse(execFileSync(bin, ['db', sql, '--format', 'json'], { env: runEnv, encoding: 'utf8', input: '', timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }));
}

// What the runner needs to know after one turn: how it ended and what the agent said last.
function turnSummary(streamText) {
  const a = aggregateEvents(parseStream(streamText).events);
  return { sessionId: a.sessionId, runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason, finalText: a.finalText, askedUser: a.askedUser };
}

// Parses the event stream and the session database. Fills `acc` so a throw part-way keeps what was read.
function parseResult(outDir, { home, tmpdir, acc, arm, ctx, config }) {
  const streamText = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  const { events } = parseStream(streamText);
  const a = aggregateEvents(events);
  acc.skills = skills.captureSkills({ runtime: 'opencode', events, arm, ctx });
  let stderr = '';
  try { stderr = fs.readFileSync(path.join(outDir, 'stderr.txt'), 'utf8'); } catch { /* none */ }
  acc.transcript = { bytes: Buffer.byteLength(streamText), chars: streamText.length, partial: false };

  let rollup = null;
  try {
    rollup = queryRollup(dbRunner(ctx.opencode.bin, env({ arm, config, ctx, home, tmpdir })), a.sessionId);
  } catch { /* flagged below */ }
  const flags = acc.meta.flags;
  if (!rollup) flags.push('usageUnavailable');
  else {
    if (rollup.orphanSessions.length) flags.push('orphanSessions');
    const streamDone = a.runFinishedStatus !== null;
    const same = (x, y) => Object.keys(x).every((k) => x[k] === y[k]);
    if (streamDone && (!same(rollup.root.tokens, a.tokens) || Math.abs(rollup.root.costUsd - a.costUsd) > 1e-6)) flags.push('usageMismatch');
    if (rollup.variants.some((v) => v !== config.effort)) flags.push('variantMismatch');
  }
  if (THROTTLE.test([...a.errors, stderr.slice(-4000)].join('\n'))) flags.push('throttled');

  const tokens = rollup ? rollup.tokens : a.tokens;
  const toolNames = rollup ? rollup.toolNames : a.toolNames;
  const toolCalls = rollup ? rollup.toolCalls : a.toolCalls;
  const subagentCalls = rollup ? rollup.subagentCalls : (a.toolNames.task || 0);
  const finalText = a.finalText === null ? null : a.finalText.slice(0, 20000);
  acc.agg = {
    sessionId: a.sessionId, sessionIds: a.sessionId ? [a.sessionId] : [], runFinishedStatus: a.runFinishedStatus, stopReason: a.stopReason,
    credits: 0, meteringEntries: 0, nonCreditUnits: [], turnDurationMs: a.turnDurationMs, contextUsagePercentage: null,
    toolCalls, workToolCalls: toolCalls - subagentCalls, subagentCalls, toolNames, skillsMcpOk: null,
    finalText, finalTextTruncated: a.finalText === null ? null : a.finalText.length > 20000, askedUser: a.askedUser,
  };
  acc.session = rollup ? { model: rollup.rootModel, totalRequestCount: rollup.modelCalls } : null;
  acc.usage = {
    tokens: { ...tokens, total: totalTokens(tokens) },
    costUsd: rollup ? rollup.costUsd : a.costUsd,
    modelCalls: rollup ? rollup.modelCalls : a.steps,
    sessions: rollup ? rollup.sessions : 1,
    variants: rollup ? rollup.variants : [],
  };
  return acc;
}

function collectArtifacts(home, outDir) {
  const cfg = path.join(home, '.config', 'opencode', 'opencode.json');
  if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(outDir, 'installed-config.json'));
}

// A model can print files in its HOME, so exact secret values are scrubbed from every output.
function finalize(outDir, ctx) {
  try {
    return scrubTree(outDir, readProfile(ctx.awsCredsFile, ctx.awsProfile).secrets);
  } catch { return 0; }
}

function prepareArm(arm, ctx) {
  const dir = path.join(ctx.cacheDir, `${arm.id}-${arm.cacheKey ?? arm.commitSha.slice(0, 12)}`);
  const exportDir = path.join(dir, 'src');
  const bin = path.join(dir, 'konductor');
  const claudeDir = path.join(dir, 'claude-install', '.claude');
  const readyFile = path.join(dir, '.ready');
  try {
    const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    if (sandbox.readyMatches(ready, arm) && fs.existsSync(path.join(claudeDir, 'agents', 'konductor.md'))) {
      return { exportDir, bin, claudeDir, mcpSha256: null, cliSha256: ready.cliSha256, cached: true };
    }
  } catch { /* rebuild */ }
  fs.rmSync(dir, { recursive: true, force: true });
  sandbox.exportArm(arm, ctx, exportDir);
  sandbox.buildCli(exportDir, bin, ctx);
  sandbox.synthArm(bin, exportDir);
  sandbox.runKonductor(bin, ['install', '--harness', 'claude', '--from', exportDir, '--target', path.join(dir, 'claude-install'), '--no-telemetry'], { home: path.join(dir, 'home') });
  const cliSha256 = sandbox.sha256File(bin);
  fs.writeFileSync(readyFile, JSON.stringify({ commitSha: arm.commitSha, contentHash: arm.contentHash ?? null, cliSha256 }) + '\n');
  return { exportDir, bin, claudeDir, mcpSha256: null, cliSha256, cached: false };
}

// Installs into a throwaway HOME and asks opencode to load the konductor agent, before any model call is made.
function trialInstall(prepared, ctx) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    const meta = installInto(home, { arm: { vanilla: false }, prepared, ctx, config: ctx.config, outDir: null, credentials: false });
    const tmpdir = path.join(home, 'tmp');
    fs.mkdirSync(tmpdir, { recursive: true });
    execFileSync(ctx.opencode.bin, ['debug', 'agent', 'konductor'], { env: env({ arm: { vanilla: false }, config: ctx.config, ctx, home, tmpdir }), input: '', stdio: ['pipe', 'ignore', 'pipe'], timeout: 60000 });
    prepared.skillInfo = skills.opencodeSkillInfo(path.join(home, '.config', 'opencode'), prepared.exportDir);
    return meta.rewrittenAgents;
  } catch (e) {
    throw new Error(`opencode cannot load the installed agents: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const keepPaths = (ctx) => [ctx.opencode?.bin, ctx.rgBin].filter(Boolean);

module.exports = {
  id, VERSION, PROVIDER, DEFAULT_MODEL, REGION, VARIANTS, TITLE, THROTTLE,
  prepareArm, requiredPaths: ['cli/konductor-rs/Cargo.toml'], trialInstall, installInto, buildCommand, env, envSetup, removeCredentials, keepPaths, parseResult, turnSummary, collectArtifacts, finalize,
  resolveOpencode, resolveRipgrep, variantOf, zeroTokens,
};
