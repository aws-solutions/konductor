// SPDX-License-Identifier: Apache-2.0
'use strict';

// Starts one gateway with a private control pipe on fd 3 and drives hello, peer and stop. Never puts the token in argv, env or files.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { FrameReader, GATEWAY_START, CONTROL_VERSION } = require('./gateway-proc.js');
const { sha256File } = require('../sandbox.js');

const READY_MS = 10000;
const FINAL_MS = 15000;

/**
 * Spawns a gateway and waits for `ready`.
 * `taskFile` is the task JSON the gateway loads (its hash goes in hello); `logDir` receives both logs;
 * `socketPath` is where gw.sock is bound; `arm` is "policy" or "allow-all"; `seed` seeds sensor noise;
 * `python` is the interpreter (a pinned venv in counted runs); `readyMs` how long to wait for `ready`. On any failure the
 * gateway is killed before the error is thrown.
 */
async function startGateway({ taskFile, logDir, socketPath, arm = 'policy', seed = 1, release = 'local', python = 'python3', readyMs = READY_MS }) {
  const token = crypto.randomBytes(32).toString('hex');
  const runId = crypto.randomBytes(16).toString('hex');
  const gwEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.env.LD_LIBRARY_PATH) gwEnv.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
  const proc = spawn(python, ['-I', GATEWAY_START, '--control-fd', '3'], {
    stdio: ['ignore', 'ignore', 'inherit', 'pipe'],
    env: gwEnv,
  });
  const control = proc.stdio[3];
  const frames = new FrameReader(control);
  const send = (frame) => control.write(JSON.stringify(frame) + '\n');
  send({
    op: 'hello', v: CONTROL_VERSION, token, runId, release, files: { [taskFile]: sha256File(taskFile) }, task: taskFile,
    arm, seed, socket: socketPath, logDir, testMode: false,
  });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  // A gateway left running after a failure would hold fd 3 open and keep the caller's event loop alive for good.
  const killAndThrow = async (e) => {
    proc.kill('SIGKILL');
    await exited;
    throw e;
  };
  const early = exited.then((code) => { throw new Error(`gateway exited with code ${code} before ready`); });
  early.catch(() => {});
  const ready = await Promise.race([frames.next(['ready', 'error'], readyMs), early]).catch(killAndThrow);
  if (ready.op === 'error') await killAndThrow(new Error(`gateway refused hello: ${ready.code} ${ready.detail}`));
  return {
    runId,
    ready,
    pid: proc.pid,
    /** Releases held connections whose peer is in pid namespace `pidns` (a `pid:[inode]` link). */
    peer: (pidns) => send({ op: 'peer', token, pidns }),
    /** Sends stop and resolves with `final` and the exit code. */
    stop: async () => {
      send({ op: 'stop', token });
      const final = await frames.next('final', FINAL_MS).catch(killAndThrow);
      return { final, code: await exited };
    },
    kill: () => proc.kill('SIGKILL'),
  };
}

/** The `pid:[inode]` link of this process's pid namespace. */
const ownPidns = () => fs.readlinkSync('/proc/self/ns/pid');

module.exports = { startGateway, ownPidns };
