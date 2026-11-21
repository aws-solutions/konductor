// SPDX-License-Identifier: Apache-2.0
'use strict';

// One plant run end to end (7.2, 7.6, 7.7) and the end-of-run order (SR-11): gateway up, peer, watch, stop and final,
// running-hash check, score. Never repairs a log and never scores a run on the agent's stream alone.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../stream.js');
const { classifyPlantStartup } = require('../launch-failure.js');
const { GatewayProcess, runningHashProblems } = require('./gateway-proc.js');
const { writePlantAgent } = require('./agent-file.js');
const { scorePlant } = require('./score.js');
const { setModes, SOCKET_PATH_MAX } = require('./intake.js');
const { installForwarder, releaseForwarder, writeRunFile, PLANT_DIR } = require('./strands-adapter.js');
const { descriptorOf } = require('../harness/runtime.js');

const SHIM = path.join(__dirname, 'shim.js');
const MAX_RERUNS = 2;
const PEER_POLL_MS = 20;
// The gateway's limits that end a trial (ENDS_TRIAL in bench/physical/gateway/plant_gateway/limits.py).
const TRIAL_ENDING_LIMITS = new Set(['line', 'calls', 'bytes', 'log_size', 'nested_pidns']);

class PlantSuiteStop extends Error {}

const readOr = (file, fallback) => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };

/** The parsed lines of a JSONL `text`, skipping lines that do not parse (the scorer judges those). */
const jsonLines = (text) => parseStream(text).events;

/**
 * The `pid:[inode]` link of the sandbox's pid namespace. Under `unshare --pid --fork` (isolation mode "unshare") that is
 * the namespace of the first child of the unshare process `pid`, found through /proc/<pid>/task/*\/children within
 * `searchMs`. Any other mode shares the runner's namespace. Resolves null when no child appears in time.
 */
async function sandboxPidns(pid, mode, searchMs) {
  if (mode !== 'unshare') return fs.readlinkSync('/proc/self/ns/pid');
  const until = Date.now() + searchMs;
  while (Date.now() < until) {
    const child = firstChild(pid);
    if (child) return fs.readlinkSync(`/proc/${child}/ns/pid`);
    await new Promise((r) => setTimeout(r, PEER_POLL_MS));
  }
  return null;
}

/** The pid of the first child of process `pid` (from /proc/<pid>/task/*\/children), or null when it has none yet or is gone. */
function firstChild(pid) {
  try {
    for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
      const kids = fs.readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim();
      if (kids) return kids.split(/\s+/)[0];
    }
  } catch { /* not started yet, or gone */ }
  return null;
}

/** The stop decision for the first limit or foreign peer the gateway's `heartbeats` report, or null. A foreign peer wins. */
function terminalViolation(heartbeats) {
  const last = heartbeats.at(-1);
  if (last?.foreignConn) return { reason: 'plantForeignConn', detail: 'a foreign connection reached gw.sock' };
  if (last?.limitHit) return { reason: 'plantLimit', detail: `gateway limit ${last.limitHit}` };
  return null;
}

/** One plant run: made by openPlantRun, driven by run-one.js. */
class PlantRun {
  constructor({ suite, arm, task, plantDir, socketRoot, logDir, gateway }) {
    Object.assign(this, { suite, arm, task, plantDir, socketRoot, logDir, gateway });
    this.startError = null;
    this.spawnAt = null;
    this.toolsListed = false;
    this.noToolsList = false;
    this.lost = null;
    this.final = null;
    this.texts = null;
    this.hashProblems = [];
  }

  /** A stop watcher for the agent's spawn: the plant checks first, then `inner` (bench's stop watcher, or null). */
  watcher(inner) {
    return { poll: () => this.poll() ?? (inner ? inner.poll() : null) };
  }

  /** Called with the agent's pid once it is spawned: finds the sandbox's pid namespace and sends `peer`. */
  onSpawn(pid) {
    this.spawnAt = Date.now();
    sandboxPidns(pid, this.suite.isolationMode, this.suite.deadlines.peerSearchMs)
      .then((pidns) => { if (pidns) this.gateway.peer(pidns); })
      .catch(() => { /* no peer: the held connection times out and Kiro CLI exits 3, a plantStartup */ });
  }

  /**
   * A stop decision `{reason, detail}` when the gateway is lost, has reported a trial-ending limit or a foreign peer
   * (its `hb` frames carry both, and it sends one at once), or no tools/list came in time; else null.
   */
  poll() {
    const lost = this.gateway.lostReason();
    if (lost) {
      this.lost = lost;
      return { reason: 'plantGatewayLost', detail: lost };
    }
    const terminal = terminalViolation(this.gateway.heartbeats());
    if (terminal) return terminal;
    if (this.spawnAt === null || this.toolsListed || Date.now() - this.spawnAt <= this.suite.deadlines.toolsListMs) return null;
    this.toolsListed = jsonLines(readOr(this.logPath('gateway'), '')).some((l) => l.type === 'mcp' && l.method === 'tools/list');
    if (this.toolsListed) return null;
    this.noToolsList = true;
    return { reason: 'plantStartup', detail: `no tools/list within ${this.suite.deadlines.toolsListMs} ms` };
  }

  /** The path of plant log `name` (`gateway` or `world`) in this run's log dir. */
  logPath(name) {
    return path.join(this.logDir, `${name}.jsonl`);
  }

  /** The exec record of a run whose agent was never started because the gateway did not come up. */
  unstartedExec() {
    return { exitCode: null, timedOut: false, wallClockMs: 0, error: `plant gateway did not start: ${this.startError}` };
  }

  /** After the agent exits: stop and settle the gateway, take `final`, read both logs, check the running hashes. */
  async finish() {
    if (this.startError === null) {
      this.final = await this.gateway.stop();
      if (!this.final && !this.lost) this.lost = this.gateway.lostReason() ?? `no final within ${this.suite.deadlines.finalMs} ms of stop`;
    }
    this.texts = { gateway: readOr(this.logPath('gateway'), ''), world: readOr(this.logPath('world'), '') };
    this.hashProblems = runningHashProblems({ heartbeats: this.gateway.heartbeats(), final: this.final, gatewayText: this.texts.gateway, worldText: this.texts.world });
  }

  /** The plant flags the runner itself raises (10.1); the scorer adds plantPathLost, plantLogInvalid and plantPolicyGap. */
  runnerFlags({ agg, exec }) {
    const lines = jsonLines(this.texts.gateway);
    const raised = {
      plantGatewayStart: this.startError !== null,
      plantStartup: this.noToolsList || classifyPlantStartup({ agg, exec }) !== null,
      plantGatewayLost: this.lost !== null,
      plantLimit: lines.some((l) => l.type === 'limit' && TRIAL_ENDING_LIMITS.has(l.which)),
      plantForeignConn: lines.some((l) => l.type === 'foreign_conn'),
      plantLogIntegrity: this.startError === null && this.hashProblems.length > 0,
    };
    return Object.keys(raised).filter((f) => raised[f]);
  }

  /**
   * Scores the run into `meta` before bench's finalize scrub (SR-11): sets `meta.plant`, adds the plant flags, and
   * marks launch failures and infra-incomplete runs. `agg` is the stream aggregate, `exec` the exec record, `outDir`
   * the run's out dir.
   */
  scoreInto(meta, { agg, exec, outDir }) {
    const events = parseStream(readOr(path.join(outDir, 'stream.jsonl'), '')).events;
    this.scored = { agg, exec, events, infraError: meta.infraError ?? null, launchFailure: meta.launchFailure ?? null };
    this.applyScore(meta, []);
  }

  /**
   * After bench's finalize scrub: re-reads both logs. When the scrub changed one (plantLogScrubbed) or left files
   * unscrubbed, scores again from the logs and stream as they were before the scrub, with those facts.
   */
  rescoreAfterScrub(meta) {
    if (!this.scored) return;
    const changed = ['gateway', 'world'].some((n) => readOr(this.logPath(n), '') !== this.texts[n]);
    if (changed || meta.unscrubbed?.length) this.applyScore(meta, changed ? ['plantLogScrubbed'] : []);
  }

  /** Scores from the inputs kept by scoreInto plus `extraFlags`, and writes the outcome into `meta`. */
  applyScore(meta, extraFlags) {
    const { agg, exec, events } = this.scored;
    let plant;
    try {
      plant = scorePlant({
        identity: { release: this.suite.release.manifest.release, manifestSha256: this.suite.release.manifestSha256, keyId: this.suite.release.keyId, arm: this.arm.plant.arm, counted: this.suite.counted, comparable: this.suite.comparable, notCounted: this.suite.notCounted, seed: this.suite.tasks.seedOf(this.task.id) },
        environment: this.task.environment, gatewayText: this.texts.gateway, worldText: this.texts.world, streamEvents: events, finalText: agg?.finalText ?? null,
        streamFormat: descriptorOf(this.arm.runtime).streamFormat, forbidHooks: this.suite.counted && this.arm.plant.hooks === 'refuse',
        flags: [...meta.flags, ...this.runnerFlags({ agg, exec }), ...extraFlags], unscrubbedFiles: meta.unscrubbed ?? [],
        gateway: { ready: this.gateway.readyAt !== null && this.startError === null, heartbeatGaps: this.gateway.heartbeatGaps(), runningHashOk: this.hashProblems.length === 0 },
        refusalRule: this.suite.refusalRule,
      });
    } catch (e) {
      meta.infraError = [this.scored.infraError, `plant scoring failed: ${e.message}`].filter(Boolean).join(' | ');
      return;
    }
    meta.plant = plant;
    meta.flags = [...new Set([...meta.flags, ...plant.flags])];
    const why = [this.startError, this.lost, ...this.hashProblems].filter(Boolean).join('; ');
    const detail = `${plant.flags.join(', ') || 'no tools/list'}${why ? ` (${why})` : ''}`;
    meta.launchFailure = this.scored.launchFailure ?? (plant.runState === 'launch_failure' && !meta.authFailure ? `plant launch failure: ${detail}` : null);
    meta.infraError = [this.scored.infraError, plant.runState === 'complete' ? null : `plant ${plant.runState}: ${detail}`].filter(Boolean).join(' | ') || null;
  }

  /** Kills the gateway if it still runs, removes the socket root and makes the plant dir removable again. */
  dispose() {
    this.gateway.kill();
    fs.rmSync(this.socketRoot, { recursive: true, force: true });
    if (this.arm.runtime === 'strands') releaseForwarder(this.plantDir);
    else fs.chmodSync(this.plantDir, 0o700);
  }
}

/** Copies the shim to `shimPath` in a new `plantDir` and makes both read-only; nothing after this may throw in setup. */
function installShim(plantDir, shimPath) {
  fs.mkdirSync(plantDir, { mode: 0o700 });
  fs.copyFileSync(SHIM, shimPath);
  fs.chmodSync(shimPath, 0o444);
  fs.chmodSync(plantDir, 0o555);
}

/**
 * Sets up one plant run and starts its gateway (7.2 up to `ready`). `suite` is preparePlantSuite's result; `arm`, `task`
 * the run's; `runRoot` and `home` its scratch dirs; `cwd` the agent's work dir, copied from the read-only release
 * fixture and made writable here; `outDir` its out dir, which gets `plant/` for the logs. A gateway that does not come
 * up leaves `startError` set rather than throwing; a setup problem throws.
 */
async function openPlantRun({ suite, arm, task, runRoot, home, cwd, outDir }) {
  setModes(cwd, 0o700, 0o600);
  const logDir = path.join(outDir, 'plant');
  if (fs.existsSync(logDir)) throw new Error(`${logDir} already holds plant logs; use a new --out`);
  fs.mkdirSync(logDir, { recursive: true });
  const socketRoot = fs.mkdtempSync(path.join(suite.socketParent, 's-'));
  const socketPath = path.join(socketRoot, 'gw.sock');
  if (Buffer.byteLength(socketPath) > SOCKET_PATH_MAX) throw new Error(`socket path ${socketPath} passes ${SOCKET_PATH_MAX} bytes`);
  const plantDir = path.join(runRoot, PLANT_DIR);
  if (arm.runtime === 'strands') {
    // Kind B: the forwarder dials gw.sock from inside the agent process; its run file names the socket, nothing more.
    writeRunFile(home, { socketPath });
    installForwarder(plantDir);
  } else {
    const shimPath = path.join(plantDir, 'shim.js');
    writePlantAgent(home, { shimPath, socketPath, nodeBin: process.execPath, kind: task.environment.kind });
    installShim(plantDir, shimPath);
  }
  const gateway = new GatewayProcess({
    python: suite.python, stdoutPath: path.join(logDir, 'gateway.stdout'), stderrPath: path.join(logDir, 'gateway.stderr'),
    deadlines: suite.deadlines, ...(suite.makeToken ? { makeToken: suite.makeToken } : {}),
  });
  const run = new PlantRun({ suite, arm, task, plantDir, socketRoot, logDir, gateway });
  const taskFile = suite.tasks.fileOf(task.id);
  try {
    const ready = await gateway.start({
      release: suite.release.manifest.release, files: { ...suite.gatewayFiles, [taskFile]: suite.release.sha256Of(`tasks/${task.id}.json`) },
      task: taskFile, arm: arm.plant.arm, seed: suite.tasks.seedOf(task.id), socket: socketPath, logDir, testMode: false,
    });
    if (suite.policySha256 && ready.policySha256 !== suite.policySha256) throw new Error(`gateway loaded policy ${ready.policySha256}, the manifest says ${suite.policySha256}`);
  } catch (e) {
    run.startError = e.message;
    gateway.kill();
  }
  return run;
}

/** The host's TCP listening sockets from /proc/net (`tcp <local address>`), sorted. Missing tables read as empty. */
function readHostListeners() {
  const listening = [];
  for (const table of ['tcp', 'tcp6']) {
    for (const line of readOr(`/proc/net/${table}`, '').split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f[3] === '0A') listening.push(`${table} ${f[1]}`);
    }
  }
  return [...new Set(listening)].sort();
}

/**
 * Reads the host's listeners and returns those it did not have at the suite's first trial (SR-20). A counted suite,
 * and a control suite inside a sandbox, throw PlantSuiteStop on any new one. A NOT COUNTED pilot, and a control suite
 * under `--isolate none` (a control never counts, and the shared dev host opens listeners all the time, D-92), only
 * log it through `suite.log` and learn it, so each new listener is noted once and the suite goes on.
 */
function checkListeners(suite) {
  const read = suite.readListeners ?? readHostListeners;
  suite.listenersAtStart ??= new Set(read());
  const added = read().filter((l) => !suite.listenersAtStart.has(l));
  if (!added.length) return [];
  if (suite.counted || (suite.control && suite.isolationMode !== 'none')) throw new PlantSuiteStop(`a new listener appeared on the host between trials (${added.join(', ')}); the plant suite stops`);
  for (const l of added) suite.listenersAtStart.add(l);
  suite.log?.(`note: plant: a new listener appeared on the host between trials (${added.join(', ')}); ${suite.control ? 'this control suite runs without a sandbox and never counts' : 'this suite is not counted'}, so it goes on`);
  return added;
}

/** Moves everything in `outDir` but earlier attempts into `outDir/launch-attempts/<n>`, so a rerun starts clean. */
function keepAttempt(outDir, n) {
  const dest = path.join(outDir, 'launch-attempts', String(n));
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(outDir)) if (name !== 'launch-attempts') fs.renameSync(path.join(outDir, name), path.join(dest, name));
}

/**
 * Runs one plant cell with `execute` (run-one's executeRun) and `args` (its arguments). Checks the host's listeners
 * before each trial (a NOT COUNTED pilot records new ones in `plant.hostListenerNotes` and goes on), reruns a launch failure at most twice (10.1), and stops the suite on a foreign connection (SR-4).
 */
async function runPlantCell(execute, args) {
  for (let attempt = 1; ; attempt++) {
    const newListeners = checkListeners(args.ctx.plant);
    const result = await execute(args);
    if (newListeners.length && result.plant) result.plant.hostListenerNotes = newListeners;
    if (result.plant?.flags.includes('plantForeignConn')) throw new PlantSuiteStop(`a foreign connection reached gw.sock in ${args.outDir}; the plant suite stops`);
    if (result.plant?.runState !== 'launch_failure' || attempt > MAX_RERUNS) return result;
    keepAttempt(args.outDir, attempt);
  }
}

module.exports = { openPlantRun, runPlantCell, readHostListeners, sandboxPidns, PlantSuiteStop, PlantRun, MAX_RERUNS };
