// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-harness parts of `bench run` (opencode, Claude Code, Strands, Kiro CLI): the run context each harness needs, its
// environment facts, its run-config record and the env.json description. Split out of run-cmd.js cmdRun (DEBT D-24).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { opencode: oc, claudeCode: cc, strands: st } = require('./harness/index.js');
const { buildChildEnv, describeEnv } = require('./env.js');
const sandbox = require('./sandbox.js');
const rc = require('./runconfig.js');
const { readRunConfigs } = require('./run-configs.js');

/** The kiro-cli model list (`chat --list-models`) under a scratch HOME with the auth db copied in. */
function listModels(kiroBin, authDb, scratchDir, envKeep, agentEngine) {
  const dir = fs.mkdtempSync(path.join(scratchDir, 'm-'));
  try {
    sandbox.copyAuthDb(authDb, dir);
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    const { env } = buildChildEnv(process.env, { home: dir, agentEngine, keep: envKeep });
    return execFileSync(kiroBin, ['chat', '--list-models', '-f', 'json'], { env, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const flagValueOf = (opts, name) => (opts[name] && opts[name] !== true ? opts[name] : null);

/** The opencode binary, ripgrep and credentials of an opencode run, set on `ctx` (DEBT D-24). Throws without ripgrep. */
function setUpOpencode(ctx, { opts, cacheDir, awsCredsFile, awsProfile, config, log }) {
  ctx.opencode = oc.resolveOpencode({ cacheDir, binOverride: flagValueOf(opts, 'opencode-bin') });
  ctx.rgBin = oc.resolveRipgrep(flagValueOf(opts, 'rg-bin'));
  if (!ctx.rgBin) throw new Error('ripgrep (rg) not found on PATH; install it or pass --rg-bin PATH (opencode would otherwise download it at run time)');
  Object.assign(ctx, { awsCredsFile, awsProfile });
  log(`opencode ${ctx.opencode.version} (${ctx.opencode.bin}), sha256 ${ctx.opencode.sha256.slice(0, 12)}, model ${oc.PROVIDER}/${config.model}, variant ${config.effort}, region ${oc.REGION}`);
}

/**
 * The claude binary, region, per-run budget and credentials of a Claude Code run, set on `ctx` (DEBT D-24). Throws when
 * the binary has no --effort, or when `outDir` holds runs of another claude binary and --allow-claude-change is not given.
 */
function setUpClaude(ctx, { opts, config, outDir, ccRegion, runBudgetUsd, ccCreds, log }) {
  const toolsDir = flagValueOf(opts, 'claude-tools-dir');
  ctx.claude = cc.resolveClaude({ binOverride: flagValueOf(opts, 'claude-bin') ?? undefined, toolsDir: toolsDir ?? undefined });
  if (!ctx.claude.supportsEffort) throw new Error(`${ctx.claude.bin} (claude ${ctx.claude.version}) has no --effort flag, so the run could not apply --effort ${config.effort}; use a claude that lists --effort in claude --help`);
  const claudeChanged = cc.claudeChanges(readRunConfigs(outDir), ctx.claude);
  if (claudeChanged.length && !opts['allow-claude-change']) throw new Error(cc.describeClaudeChanges(claudeChanged, ctx.claude, outDir, toolsDir));
  if (claudeChanged.length) log(`warning: --allow-claude-change: ${cc.describeClaudeChanges(claudeChanged, ctx.claude, outDir, toolsDir).split('. One study')[0]}`);
  Object.assign(ctx, { region: ccRegion, runBudgetUsd, ...(ccCreds ? { awsCreds: ccCreds } : {}) });
  const credsNote = ccCreds ? `credentials from profile ${ccCreds.profile}, read again before a run when they expire within 15 minutes` : `credentials from the environment (${cc.credentialNames().join(', ')})`;
  log(`claude ${ctx.claude.version} (${ctx.claude.bin}), sha256 ${ctx.claude.sha256.slice(0, 12)}, model ${config.model} (canonical ${config.canonicalModel}), effort ${config.effort}, region ${ccRegion}, permission mode ${cc.PERMISSION_MODE}, per-run budget $${runBudgetUsd ?? cc.DEFAULT_RUN_BUDGET_USD}, ${credsNote}`);
  const versionNote = cc.versionWarning(ctx.claude.version);
  if (versionNote) log(`warning: ${versionNote}`);
  const shadow = cc.PROFILE_VARS.filter((k) => process.env[k]);
  if (shadow.length) log(`note: ${shadow.join(', ')} ${shadow.length === 1 ? 'is' : 'are'} set here and is not passed to claude (the SDK would skip the exported keys)`);
}

/**
 * The Strands interpreter and agent file of a Strands run, set on `ctx`, with the spend cap when it runs on Bedrock
 * (DEBT D-24). `state.charged` is read live, so the cap's `left()` falls as the command spends.
 */
function setUpStrands(ctx, { opts, config, stModel, stCreds, budgetCredits, state, log }) {
  ctx.strands = st.resolveStrands({ python: flagValueOf(opts, 'strands-python') ?? 'python3', agentFile: flagValueOf(opts, 'strands-agent') });
  if (stCreds) Object.assign(ctx, { awsCreds: stCreds, strandsSpend: { capUsd: budgetCredits, left: () => budgetCredits - state.charged } });
  const credsNote = stCreds ? `${stModel.region}, keys of profile ${stCreds.profile}, hard spend cap $${budgetCredits} for the command` : 'no credentials passed';
  log(`strands-agents ${ctx.strands.version} (${ctx.strands.python}), agent ${ctx.strands.agentFile ?? 'plain Agent'}, model ${config.model}, ${credsNote}`);
}

/**
 * The environment facts a run records for `runtime` (DEBT D-24): the harness version, and for kiro-cli the CLI version
 * and a snapshot of its model list, written to `<outDir>/model-list.json`.
 */
function envInfoOf({ runtime, ctx, ccRegion, outDir, authDb, scratchDir, envKeep, config }) {
  if (runtime === 'strands') return { kiroCliVersion: null, harnessVersion: ctx.strands.version, modelListSnapshotPath: null };
  if (runtime === 'opencode') return { kiroCliVersion: null, harnessVersion: ctx.opencode.version, modelListSnapshotPath: null, region: oc.REGION };
  if (runtime === 'claude-code') return { kiroCliVersion: null, harnessVersion: ctx.claude.version, modelListSnapshotPath: null, region: ccRegion };
  const modelListPath = path.join(outDir, 'model-list.json');
  fs.writeFileSync(modelListPath, listModels(ctx.kiroBin, authDb, scratchDir, envKeep, config.agentEngine));
  return { kiroCliVersion: sandbox.kiroCliVersion(ctx.kiroBin), modelListSnapshotPath: modelListPath };
}

/** The harness part of the run config for `runtime` (DEBT D-24): the harness record and the env policy. */
function harnessRunConfig({ runtime, ctx, config, plantSuite, stModel, stCreds, budgetCredits, awsProfile, ccRegion, runBudgetUsd, arms, envKeep, kiro }) {
  if (runtime === 'strands') {
    return {
      harnessVersion: ctx.strands.version,
      strands: {
        python: ctx.strands.python, version: ctx.strands.version, agentFile: ctx.strands.agentFile, adapter: 'kind B: plant tools are forwarding stubs', census: plantSuite?.strandsCensus ?? null,
        bedrock: stModel ? { ...stModel, spendCapUsd: budgetCredits, awsProfile: stCreds.profile } : null,
      },
      env: rc.envPolicy(process.env, []),
    };
  }
  if (runtime === 'opencode') {
    return {
      harnessVersion: ctx.opencode.version,
      opencode: {
        npmPackage: `opencode-ai@${oc.VERSION}`, version: ctx.opencode.version, binaryPath: ctx.opencode.bin, binarySha256: ctx.opencode.sha256,
        provider: oc.PROVIDER, modelId: config.model, region: oc.REGION, variant: config.effort, title: oc.TITLE,
        awsProfile, ripgrep: ctx.rgBin,
        promptCache: 'Bedrock prompt cache lives about 5 minutes; back-to-back runs can read cache written by the previous run, so cache read and write vary with run order (seeded shuffle kept)',
      },
      env: rc.envPolicy(process.env, []),
    };
  }
  if (runtime === 'claude-code') {
    return { harnessVersion: ctx.claude.version, claudeCode: cc.runConfigRecord({ ctx, config, region: ccRegion, runBudgetUsd, arms }), env: rc.envPolicy(process.env, []) };
  }
  return {
    requireMcpStartup: true,
    env: rc.envPolicy(process.env, envKeep),
    kiroBinary: { path: kiro.bin, bypassedShim: kiro.shim },
    kiroEnabledFeatures: process.env.KIRO_ENABLED_FEATURES ?? null,
    agentEnginesAvailable: rc.availableEngines(kiro.bin),
  };
}

/** Writes `<outDir>/env.json`: what each arm's agent env sets, passes and drops, with values hidden (DEBT D-24). */
function writeEnvJson({ outDir, runtime, ctx, config, envKeep, stCreds, interpreters, arms }) {
  // The Strands launcher env is the whole env, so it is described as one: every key set, nothing passed through.
  const strandsSetup = () => {
    const placeholder = stCreds ? { awsCreds: { current: () => Object.fromEntries(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'].map((k) => [k, '<set>'])) } } : null;
    const set = st.env({ home: '<run-home>', tmpdir: '<run>/tmp', ctx: placeholder });
    return { keys: Object.keys(set).sort(), set, unset: [] };
  };
  const envFor = (konductor) => (runtime === 'strands'
    ? strandsSetup()
    : runtime === 'claude-code'
    ? cc.envSetup({ arm: { vanilla: !konductor }, ctx, home: '<run-home>', tmpdir: '<run>/tmp', baseEnv: { ...process.env, ...Object.fromEntries(cc.CREDENTIAL_VARS.map((k) => [k, '<set>'])) } })
    : runtime === 'opencode'
    ? oc.envSetup({ arm: { vanilla: !konductor }, config, ctx, home: '<run-home>' })
    : buildChildEnv(process.env, { home: '<run-home>', agentEngine: config.agentEngine, keep: envKeep, konductor }));
  fs.writeFileSync(path.join(outDir, 'env.json'), JSON.stringify({
    model: config.model, effort: config.effort,
    konductorArm: describeEnv(process.env, envFor(true)),
    vanillaArm: describeEnv(process.env, envFor(false)),
    interpreters,
    // The skill listing each arm's runs get (plugins/claude-code/listing.js; Kiro's record from its install), by arm id.
    skillListings: Object.fromEntries(arms.map((a) => [a.id, ctx.skillListings?.get(a.id)?.listing ?? null])),
  }, null, 2) + '\n');
}

module.exports = { setUpOpencode, setUpClaude, setUpStrands, envInfoOf, harnessRunConfig, writeEnvJson, listModels, flagValueOf };
