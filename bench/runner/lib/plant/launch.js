// SPDX-License-Identifier: Apache-2.0
'use strict';

// Starts one gateway with a private control pipe on fd 3 and drives hello, peer and stop. Never puts the token in argv, env or files.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { FrameReader } = require('./gateway-proc.js');

const PHYSICAL = path.join(__dirname, '..', '..', '..', 'physical');
const GATEWAY_START = path.join(PHYSICAL, 'gateway', 'start.py');
const READY_MS = 10000;
const FINAL_MS = 15000;

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Spawns a gateway and waits for `ready`.
 * `taskFile` is the task JSON the gateway loads (its hash goes in hello); `logDir` receives both logs;
 * `socketPath` is where gw.sock is bound; `arm` is "policy" or "allow-all"; `seed` seeds sensor noise;
 * `python` is the interpreter (a pinned venv in counted runs).
 */
async function startGateway({ taskFile, logDir, socketPath, arm = 'policy', seed = 1, release = 'local', python = 'python3' }) {
  const token = crypto.randomBytes(32).toString('hex');
  const runId = crypto.randomBytes(16).toString('hex');
  const proc = spawn(python, ['-I', GATEWAY_START, '--control-fd', '3'], {
    stdio: ['ignore', 'ignore', 'inherit', 'pipe'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  const control = proc.stdio[3];
  const frames = new FrameReader(control);
  const send = (frame) => control.write(JSON.stringify(frame) + '\n');
  send({
    op: 'hello', v: 'plant-control/1', token, runId, release, files: { [taskFile]: sha256File(taskFile) }, task: taskFile,
    arm, seed, socket: socketPath, logDir, testMode: false,
  });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const ready = await frames.next(['ready', 'error'], READY_MS);
  if (ready.op === 'error') throw new Error(`gateway refused hello: ${ready.code} ${ready.detail}`);
  return {
    runId,
    ready,
    /** Releases held connections whose peer is in pid namespace `pidns` (a `pid:[inode]` link). */
    peer: (pidns) => send({ op: 'peer', token, pidns }),
    /** Sends stop and resolves with `final` and the exit code. */
    stop: async () => {
      send({ op: 'stop', token });
      const final = await frames.next('final', FINAL_MS);
      return { final, code: await exited };
    },
    kill: () => proc.kill('SIGKILL'),
  };
}

/** The `pid:[inode]` link of this process's pid namespace. */
const ownPidns = () => fs.readlinkSync('/proc/self/ns/pid');

module.exports = { startGateway, ownPidns };
