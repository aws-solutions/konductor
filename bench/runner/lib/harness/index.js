// SPDX-License-Identifier: Apache-2.0
'use strict';

/**
 * A harness runs one agent CLI for one benchmark run. CONTRACT.md in this folder is the full contract.
 * @typedef {object} Harness
 * @property {string} id runtime name, one of RUNTIMES in runtime.js
 * @property {(arm: object, ctx: object) => object} prepareArm build or fetch what the arm needs; cached
 * @property {(prepared: object, ctx: object) => string[]} trialInstall prove the arm installs; returns the agents whose model was pinned
 * @property {(home: string, opts: {arm: object, prepared: object, ctx: object, config: object, outDir: string}) => object} installInto fill the run's scratch HOME; returns meta
 * @property {(o: {arm: object, task: object, config: object, ctx: object, cwd: string, resume: ?{sessionId: ?string, prompt: string}}) => {file: string, args: string[], display: string}} buildCommand
 * @property {(o: {arm: object, config: object, ctx: object, home: string, tmpdir: string}) => object} env allowlisted environment of the agent process
 * @property {(home: string) => void} removeCredentials delete the credential copy once the agent exits
 * @property {(ctx: object) => string[]} keepPaths binaries that must stay visible inside the isolation namespace
 * @property {(streamText: string) => {sessionId: ?string, runFinishedStatus: ?string, stopReason: ?string, finalText: ?string, askedUser: ?boolean}} turnSummary summary of one turn's stream
 * @property {(outDir: string, o: {home: string, tmpdir: string, acc: object, arm: object, ctx: object, config: object}) => void} parseResult fills acc.agg, acc.session, acc.transcript, acc.skills (and acc.usage for USD runtimes)
 * @property {(home: string, outDir: string, o: {arm: object}) => void} collectArtifacts
 * @property {string[]} [requiredPaths] repo-relative files the arm source must contain
 * @property {(outDir: string) => ?object} [orchMetrics]
 * @property {(outDir: string, ctx: object) => ({scrubbed: number, unscrubbed: {file: string, reason: string}[]}|number)} [finalize] redacts secrets from output files; returns the count of files rewritten and the files it could not scrub (a bare count means none)
 * @property {(ctx: object) => string[]} [secrets] literals scrubbed from result.json
 * @property {(o: {cwd: string, tmpdir: string, tmpBases: string[]}) => any} [cleanupRun]
 * @property {(removed: any, tmpdir: string) => object} [describeCleanup] required when cleanupRun is defined
 */

const kiro = require('./kiro.js');
const opencode = require('./opencode.js');
const claudeCode = require('./claude-code.js');
const { runtimeOf } = require('./runtime.js');

const HARNESSES = { 'kiro-cli': kiro, opencode, 'claude-code': claudeCode };

// id -> descriptor (id, label, armPrefix, costUnit, supports), read from each harness module. runtime.js and arms.js
// read the same descriptors through descriptors.js because they cannot load the harness modules (require cycle).
const registry = Object.fromEntries(Object.entries(HARNESSES).map(([id, h]) => [id, h.meta]));

const harnessFor = (armOrResult) => HARNESSES[runtimeOf(armOrResult)];

module.exports = { harnessFor, runtimeOf, HARNESSES, registry, kiro, opencode, claudeCode };
