// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner side of the kind-B Strands adapter (design 15.1 to 15.3): installs the forwarder into a run's plant dir,
// writes its run file, and judges a hook census. Starts no process (the scorer imports it); strands-census.js runs the
// census. The forwarder itself is bench/physical/strands/.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', '..', 'physical', 'strands');
const PACKAGE = 'plant_strands';
const LAUNCHER = 'launch.py';
const PACKAGE_FILE = /\.(?:py|json)$/;
// The plant dir's name under a run root; lifecycle.js makes it, and the Strands harness finds the launcher there.
const PLANT_DIR = 'plant';
const RUN_FILE = path.join('.plant', 'strands.json');
// What a tool-event hook may write that cancels, rewrites or retries a call (strands-agents 1.65.0 `_can_write`, plus
// interrupts). `end_turn` only ends the turn and changes no call, so it is listed but allowed.
const CALL_CHANGING_WRITES = new Set(['cancel', 'interrupt', 'cancel_tool', 'selected_tool', 'tool_use', 'result', 'retry']);
const TOOL_STAGE = 'executeTool';
const SDK_EXECUTORS = 'strands.tools.executors.';

/** The interpreter arguments that run the launcher at `launcher`: isolated mode, no bytecode written. */
const pythonArgs = (launcher) => ['-I', '-B', launcher];

/** The launcher's path in the plant dir of the run whose agent works in `cwd` (`<runRoot>/work`). */
const launcherForCwd = (cwd) => path.join(path.dirname(cwd), PLANT_DIR, LAUNCHER);

/**
 * Copies the launcher and the forwarder package (its Python files and the Bedrock pin file) into a new `plantDir` and
 * makes the copy read-only, as installShim does for Kiro CLI. Returns the launcher's path.
 */
function installForwarder(plantDir) {
  fs.mkdirSync(path.join(plantDir, PACKAGE), { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(SOURCE, LAUNCHER), path.join(plantDir, LAUNCHER));
  for (const name of fs.readdirSync(path.join(SOURCE, PACKAGE)).filter((n) => PACKAGE_FILE.test(n))) {
    fs.copyFileSync(path.join(SOURCE, PACKAGE, name), path.join(plantDir, PACKAGE, name));
  }
  for (const dir of [path.join(plantDir, PACKAGE), plantDir]) {
    for (const name of fs.readdirSync(dir)) if (PACKAGE_FILE.test(name)) fs.chmodSync(path.join(dir, name), 0o444);
    fs.chmodSync(dir, 0o555);
  }
  return path.join(plantDir, LAUNCHER);
}

/** Makes a plant dir made by installForwarder removable again (its package dir too). Missing dirs are skipped. */
function releaseForwarder(plantDir) {
  for (const dir of [plantDir, path.join(plantDir, PACKAGE)]) if (fs.existsSync(dir)) fs.chmodSync(dir, 0o700);
}

/** Writes `<home>/.plant/strands.json` with the gateway socket path the forwarder dials (no token: A-7). */
function writeRunFile(home, { socketPath }) {
  fs.mkdirSync(path.join(home, path.dirname(RUN_FILE)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, RUN_FILE), JSON.stringify({ socket: socketPath }) + '\n', { mode: 0o600 });
}

/**
 * Why a census rules out a counted run of a plain Strands arm (SR-22): one line per entry that can cancel, rewrite or
 * retry a plant call. SDK entries (module `strands.`) are allowed; the only ones in 1.65.0 act on agent-as-tool
 * delegates, never on a plain tool. Every non-SDK tool-event hook counts, because what a callback does cannot be read
 * from outside it. An unreadable registry, a stock executor swapped out or a plant tool that is not the forwarder
 * stub count too. Empty when the run may go ahead.
 */
function censusProblems(census) {
  if (!census) return ['no census line in the trace'];
  const problems = (census.unreadable ?? []).map((u) => `census could not read ${u}`);
  for (const h of census.hooks ?? []) {
    const writes = (h.mayWrite ?? []).filter((w) => CALL_CHANGING_WRITES.has(w));
    if (!h.sdk && writes.length) problems.push(`hook ${h.callback} on ${h.event} may ${writes.join(', ')}`);
  }
  for (const m of census.middleware ?? []) if (!m.sdk && m.stage === TOOL_STAGE) problems.push(`middleware ${m.handler} wraps tool execution`);
  if (!String(census.executor ?? '').startsWith(SDK_EXECUTORS)) problems.push(`tool executor ${census.executor} is not a Strands executor`);
  for (const [tool, state] of Object.entries(census.tools ?? {})) if (state !== 'forwarder') problems.push(`plant tool ${tool} is ${state}, not the forwarding stub`);
  return problems;
}

module.exports = { installForwarder, releaseForwarder, writeRunFile, censusProblems, launcherForCwd, pythonArgs, PLANT_DIR, RUN_FILE };
