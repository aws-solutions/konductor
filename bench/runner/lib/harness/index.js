// SPDX-License-Identifier: Apache-2.0
'use strict';

// A harness runs one agent CLI for one benchmark run. Interface (see kiro.js and opencode.js):
//   prepareArm(arm, ctx)                      build or fetch what the arm needs; cached
//   trialInstall(prepared, ctx)               prove the arm installs; returns the agents whose model was pinned
//   installInto(scratchHome, opts)            fill the run's scratch HOME (config, content, credentials); returns meta
//   buildCommand({arm, task, config, ctx, cwd, resume}) -> {file, args, display}
//                                             resume = {sessionId, prompt} continues the same session with a new message (autonomy tasks)
//   turnSummary(streamText)                   {sessionId, runFinishedStatus, stopReason, finalText, askedUser} of one turn's stream
//   env({arm, config, ctx, home, tmpdir})     environment for the agent process
//   removeCredentials(scratchHome)            delete the credential copy once the agent exits
//   parseResult(outDir, {home, tmpdir, acc, arm, ctx, config})  fills acc.agg, acc.session, acc.transcript (and acc.usage)
//   keepPaths(ctx)                            binaries that must stay visible inside the namespace

const kiro = require('./kiro.js');
const opencode = require('./opencode.js');
const { runtimeOf } = require('./runtime.js');

const HARNESSES = { 'kiro-cli': kiro, opencode };

const harnessFor = (armOrResult) => HARNESSES[runtimeOf(armOrResult)];

module.exports = { harnessFor, runtimeOf, HARNESSES, kiro, opencode };
