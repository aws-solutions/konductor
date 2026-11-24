// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-harness parts of `bench run` (opencode, Claude Code, Strands, Kiro CLI): the run context each harness needs, its
// environment facts, its run-config record and the env.json description. Split out of run-cmd.js cmdRun (DEBT D-24).

const fs = require('node:fs');
const path = require('node:path');
const { opencode: oc, claudeCode: cc, strands: st, harnessFor } = require('./harness/index.js');
const { describeEnv } = require('./env.js');
const { readRunConfigs } = require('./run-configs.js');

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
function envInfoOf({ runtime, ...args }) {
  return harnessFor({ runtime }).runEnvInfo(args);
}

/** The harness part of the run config for `runtime` (DEBT D-24): the harness record and the env policy. */
function harnessRunConfig({ runtime, ...args }) {
  return harnessFor({ runtime }).harnessRunConfig(args);
}

/** Writes `<outDir>/env.json`: what each arm's agent env sets, passes and drops, with values hidden (DEBT D-24). */
function writeEnvJson({ outDir, runtime, ctx, config, envKeep, stCreds, interpreters, arms }) {
  const envFor = (konductor) => harnessFor({ runtime }).envOfArm({ konductor, ctx, config, envKeep, stCreds });
  fs.writeFileSync(path.join(outDir, 'env.json'), JSON.stringify({
    model: config.model, effort: config.effort,
    konductorArm: describeEnv(process.env, envFor(true)),
    vanillaArm: describeEnv(process.env, envFor(false)),
    interpreters,
    // The skill listing each arm's runs get (plugins/claude-code/listing.js; Kiro's record from its install), by arm id.
    skillListings: Object.fromEntries(arms.map((a) => [a.id, ctx.skillListings?.get(a.id)?.listing ?? null])),
  }, null, 2) + '\n');
}

module.exports = { setUpOpencode, setUpClaude, setUpStrands, envInfoOf, harnessRunConfig, writeEnvJson, flagValueOf };
