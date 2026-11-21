// SPDX-License-Identifier: Apache-2.0
'use strict';

// Starts one gateway for the first demo and the gateway tests, as a thin wrapper over GatewayProcess (gateway-proc.js):
// the same process group, core dumps off and minimal env as a real run. Never puts the token in argv, env or files.

const fs = require('node:fs');
const path = require('node:path');
const { GatewayProcess, DEADLINES } = require('./gateway-proc.js');
const { sha256File } = require('../sandbox.js');

const READY_MS = 10000;
const FINAL_MS = 15000;

/**
 * Spawns a gateway and waits for `ready`.
 * `taskFile` is the task JSON the gateway loads (its hash goes in hello); `logDir` receives both logs, plus the
 * gateway's own output in gateway.stdout.log and gateway.stderr.log; `socketPath` is where gw.sock is bound; `arm` is
 * "policy" or "allow-all"; `seed` seeds sensor noise; `python` is the interpreter (a pinned venv in counted runs);
 * `readyMs` how long to wait for `ready`. On any failure the gateway is killed before the error is thrown.
 */
async function startGateway({ taskFile, logDir, socketPath, arm = 'policy', seed = 1, release = 'local', python = 'python3', readyMs = READY_MS }) {
  const gw = new GatewayProcess({
    python,
    stdoutPath: path.join(logDir, 'gateway.stdout.log'),
    stderrPath: path.join(logDir, 'gateway.stderr.log'),
    deadlines: { ...DEADLINES, readyMs, finalMs: FINAL_MS },
  });
  // A gateway left running after a failure would hold fd 3 open and keep the caller's event loop alive for good.
  const killAndThrow = async (e) => {
    gw.kill();
    if (gw.exited) await gw.exited;
    throw e;
  };
  const ready = await gw.start({
    release, files: { [taskFile]: sha256File(taskFile) }, task: taskFile, arm, seed, socket: socketPath, logDir, testMode: false,
  }).catch(killAndThrow);
  return {
    runId: gw.runId,
    ready,
    pid: gw.proc.pid,
    /** Releases held connections whose peer is in pid namespace `pidns` (a `pid:[inode]` link). */
    peer: (pidns) => gw.peer(pidns),
    /** Sends stop and resolves with `final` and the exit code; throws when no final frame comes. */
    stop: async () => {
      const final = await gw.stop();
      const code = await gw.exited;
      if (!final) throw new Error(`no final frame within ${FINAL_MS} ms`);
      return { final, code };
    },
    kill: () => gw.kill(),
  };
}

/** The `pid:[inode]` link of this process's pid namespace. */
const ownPidns = () => fs.readlinkSync('/proc/self/ns/pid');

module.exports = { startGateway, ownPidns };
