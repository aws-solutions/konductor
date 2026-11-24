// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-harness parts of `bench run`, dispatched to the run's harness (FW-18): its environment facts, its run-config
// record and the env.json description. Each harness sets up its own run context (setUpRun). Split out of run-cmd.js
// cmdRun (DEBT D-24).

const fs = require('node:fs');
const path = require('node:path');
const { harnessFor } = require('./harness/index.js');
const { describeEnv } = require('./env.js');

const flagValueOf = (opts, name) => (opts[name] && opts[name] !== true ? opts[name] : null);

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

module.exports = { envInfoOf, harnessRunConfig, writeEnvJson, flagValueOf };
