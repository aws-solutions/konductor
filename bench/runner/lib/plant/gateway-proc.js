// SPDX-License-Identifier: Apache-2.0
'use strict';

// One gateway process and its fd 3 control channel: hello, ready, heartbeats, peer, stop and final. The token is made
// and used only here: never in argv, env, a file or a log.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const procs = require('../procs.js');
const { plantFolders } = require('./kinds.js');

const CONTROL_VERSION = 'plant-control/1';
const GATEWAY_START = path.join(__dirname, '..', '..', '..', 'physical', 'gateway', 'start.py');
/** Deadlines in ms (10.1). Tests pass shorter ones. */
const DEADLINES = Object.freeze({ readyMs: 10000, heartbeatLossMs: 5000, finalMs: 5000, toolsListMs: 60000, peerSearchMs: 10000 });
// A heartbeat comes every 1 s; an interval over twice that is counted in `heartbeatGaps`.
const HEARTBEAT_GAP_MS = 2000;
const EXIT_WAIT_MS = 2000;

class GatewayStartError extends Error {}

const randomHex = (bytes) => () => crypto.randomBytes(bytes).toString('hex');

/** Reads newline-delimited JSON frames from `stream`, keeps them with their arrival time from `clock`, and wakes waiters by `op`. */
class FrameReader {
  constructor(stream, clock = Date.now) {
    this.frames = [];
    this.waiters = [];
    this.broken = null;
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('error', (e) => { this.broken ??= `control channel failed: ${e.code ?? e.message}`; });
    stream.on('data', (chunk) => {
      buf += chunk;
      let at;
      while ((at = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        try { this.push({ ...JSON.parse(line), at: clock() }); } catch { this.broken = `bad control frame: ${line.slice(0, 80)}`; }
      }
    });
  }

  /** Keeps `frame` and hands it to every waiter whose ops include its op; those waiters are removed. */
  push(frame) {
    this.frames.push(frame);
    this.waiters = this.waiters.filter((w) => (w.ops.includes(frame.op) ? (w.resolve(frame), false) : true));
  }

  /** Resolves with the first unread frame whose op is in `ops` (an op name or a list), or rejects after `ms`. */
  next(ops, ms) {
    const wanted = [].concat(ops);
    const take = (f) => Object.assign(f, { taken: true });
    const seen = this.frames.find((f) => wanted.includes(f.op) && !f.taken);
    if (seen) return Promise.resolve(take(seen));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${wanted.join('/')} frame within ${ms} ms`)), ms);
      this.waiters.push({ ops: wanted, resolve: (f) => { clearTimeout(timer); resolve(take(f)); } });
    });
  }

  /** Every frame of `op` received so far. */
  all(op) {
    return this.frames.filter((f) => f.op === op);
  }
}

/** The `{file, args, env}` that start a gateway under `python`, with core dumps off before Python runs and a minimal env. */
function gatewayCommand(python) {
  // Minimal env, plus the dynamic-linker search path when it is set, so a Python built against a non-default shared
  // library (the arm gateway's mujoco needing libffi on this host) can load its C extensions. BENCH_PLANT_DIRS names
  // the plant folders the gateway loads (physical/sim/__init__.py). No agent/task data.
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', BENCH_PLANT_DIRS: plantFolders().join(path.delimiter) };
  if (process.env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
  return {
    file: '/bin/sh',
    args: ['-c', 'ulimit -c 0 && exec "$0" "$@"', python, '-I', GATEWAY_START, '--control-fd', '3'],
    env,
  };
}

/**
 * One gateway process for one run.
 * `python` is the interpreter; `stdoutPath` and `stderrPath` are new files for its output; `deadlines` replaces
 * DEADLINES; `clock` returns ms; `makeToken` returns the 64-hex run token (tests may pass a known one).
 */
class GatewayProcess {
  constructor({ python, stdoutPath, stderrPath, deadlines = DEADLINES, clock = Date.now, makeToken = randomHex(32) }) {
    Object.assign(this, { python, stdoutPath, stderrPath, deadlines, clock });
    this.token = makeToken();
    this.runId = randomHex(16)();
    this.proc = null;
    this.frames = null;
    this.readyAt = null;
    this.exitCode = undefined;
    this.stopping = false;
  }

  /** Spawns the gateway, sends hello (`fields` without op, v, token and runId) and resolves with `ready`. Throws GatewayStartError. */
  async start(fields) {
    const cmd = gatewayCommand(this.python);
    const out = fs.openSync(this.stdoutPath, 'wx', 0o600);
    const err = fs.openSync(this.stderrPath, 'wx', 0o600);
    try {
      this.proc = spawn(cmd.file, cmd.args, { stdio: ['ignore', out, err, 'pipe'], env: cmd.env, detached: true });
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    procs.trackGroup(this.proc.pid);
    this.exited = new Promise((resolve) => this.proc.once('exit', (code) => { this.exitCode = code; resolve(code); }));
    this.frames = new FrameReader(this.proc.stdio[3], this.clock);
    this.send({ op: 'hello', v: CONTROL_VERSION, runId: this.runId, ...fields });
    const early = this.exited.then((code) => { throw new Error(`gateway exited with code ${code} before ready`); });
    let ready;
    try {
      ready = await Promise.race([this.frames.next(['ready', 'error'], this.deadlines.readyMs), early]);
    } catch (e) {
      throw new GatewayStartError(e.message);
    }
    if (ready.op === 'error') throw new GatewayStartError(`gateway refused hello: ${ready.code} ${ready.detail}`);
    this.readyAt = ready.at;
    return ready;
  }

  /** Writes one control frame with the token added. */
  send(frame) {
    this.proc.stdio[3].write(JSON.stringify({ ...frame, token: this.token }) + '\n');
  }

  /** Lets held connections from pid namespace `pidns` (a `pid:[inode]` link) through. */
  peer(pidns) {
    this.send({ op: 'peer', pidns });
  }

  /** Why the gateway counts as lost at `now`, or null: it exited, sent a bad frame, or missed heartbeats. */
  lostReason(now = this.clock()) {
    if (this.readyAt === null || this.stopping) return null;
    if (this.exitCode !== undefined) return `gateway exited with code ${this.exitCode} during the run`;
    if (this.frames.broken) return this.frames.broken;
    const last = this.frames.all('hb').at(-1)?.at ?? this.readyAt;
    return now - last > this.deadlines.heartbeatLossMs ? `no heartbeat for ${now - last} ms` : null;
  }

  /** The heartbeat frames received so far, in order. */
  heartbeats() {
    return this.frames ? this.frames.all('hb') : [];
  }

  /** Intervals between ready and successive heartbeats that were over HEARTBEAT_GAP_MS. */
  heartbeatGaps() {
    if (this.readyAt === null) return 0;
    const times = [this.readyAt, ...this.heartbeats().map((h) => h.at)];
    return times.filter((t, i) => i > 0 && t - times[i - 1] > HEARTBEAT_GAP_MS).length;
  }

  /** Sends stop and resolves with `final`, or null when the gateway is lost or misses the deadline. Then ends the process. */
  async stop() {
    if (this.lostReason() !== null) {
      this.kill();
      return null;
    }
    this.stopping = true;
    this.send({ op: 'stop' });
    const final = await this.frames.next('final', this.deadlines.finalMs).catch(() => null);
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, EXIT_WAIT_MS).unref())]);
    this.kill();
    return final;
  }

  /** Kills the gateway's process group. Safe to call more than once. */
  kill() {
    if (!this.proc) return;
    try { process.kill(-this.proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    procs.untrackGroup(this.proc.pid);
  }
}

/** SHA-256 hex of the first k lines of `text`, for k from 0 to the number of complete lines. */
function prefixHashes(text) {
  const hash = crypto.createHash('sha256');
  const out = [hash.copy().digest('hex')];
  let from = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', from)) {
    hash.update(text.slice(from, at + 1));
    out.push(hash.copy().digest('hex'));
    from = at + 1;
  }
  return out;
}

/**
 * Problems between the running hashes the gateway sent and the log files as read (SR-17); empty means they agree.
 * `heartbeats` are the hb frames, `final` the final frame (or null), `gatewayText` and `worldText` the two logs.
 */
function runningHashProblems({ heartbeats, final, gatewayText, worldText }) {
  const gateway = prefixHashes(gatewayText);
  const worldPrefixes = prefixHashes(worldText);
  const world = new Set(worldPrefixes);
  const problems = [];
  for (const hb of heartbeats) {
    if (gateway[hb.lastSeq + 1] !== hb.logSha256?.gateway) problems.push(`hb ${hb.n}: gateway.jsonl up to seq ${hb.lastSeq} does not match its running hash`);
    if (!world.has(hb.logSha256?.world)) problems.push(`hb ${hb.n}: world.jsonl has no prefix with its running hash`);
  }
  if (!final) return problems;
  const lines = { gateway: gateway.length - 1, world: worldPrefixes.length - 1 };
  if (final.lines?.gateway !== lines.gateway || final.lines?.world !== lines.world) problems.push(`final line counts ${JSON.stringify(final.lines)} differ from the files ${JSON.stringify(lines)}`);
  if (final.lastSeq !== lines.gateway - 1) problems.push(`final lastSeq ${final.lastSeq} is not the last gateway line`);
  if (final.logSha256?.gateway !== gateway.at(-1)) problems.push('gateway.jsonl does not match the final running hash');
  if (final.logSha256?.world !== worldPrefixes.at(-1)) problems.push('world.jsonl does not match the final running hash');
  return problems;
}

module.exports = { GatewayProcess, GatewayStartError, FrameReader, gatewayCommand, runningHashProblems, prefixHashes, DEADLINES, CONTROL_VERSION, GATEWAY_START };
