#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Copies MCP lines between Kiro CLI's stdio and gw.sock, byte for byte. Decides nothing, holds no secret.

const net = require('node:net');

const LOST = 'plant connection lost';
const REINIT_PREFIX = 'shim-reinit-';

/**
 * One shim between `input`/`output` (the agent's MCP stdio) and the gateway socket at `socketPath`.
 * `connect` opens a socket to a path (net.createConnection in production; tests may pass their own).
 */
class Shim {
  constructor({ socketPath, input, output, connect = net.createConnection }) {
    this.socketPath = socketPath;
    this.input = input;
    this.output = output;
    this.connect = connect;
    this.open = new Map();
    this.saved = { initialize: null, initialized: null };
    this.reinits = 0;
    this.dropId = null;
    this.sock = null;
    this.pending = [];
  }

  /** Connects and starts copying. Resolves when the input ends. */
  run() {
    this.dial(false);
    return new Promise((resolve) => {
      eachLine(this.input, (line) => this.fromAgent(line), () => {
        if (this.sock) this.sock.end();
        resolve();
      });
    });
  }

  fromAgent(line) {
    const msg = parseOrNull(line);
    if (msg && msg.method === 'initialize' && msg.id !== undefined) this.saved.initialize = msg;
    if (msg && msg.method === 'notifications/initialized') this.saved.initialized = line;
    if (msg && msg.method && msg.id !== undefined) this.open.set(idKey(msg.id), msg.id);
    if (!this.sock) this.dial(this.saved.initialize !== null && msg?.method !== 'initialize');
    this.send(line);
  }

  fromGateway(line) {
    const msg = parseOrNull(line);
    if (msg && !msg.method && msg.id !== undefined) {
      if (this.dropId !== null && msg.id === this.dropId) return;
      this.open.delete(idKey(msg.id));
    }
    this.output.write(line + '\n');
  }

  send(line) {
    if (this.sock?.readyState === 'open') this.sock.write(line + '\n');
    else this.pending.push(line);
  }

  /** Opens gw.sock. `replay` re-sends the saved initialize (under a shim id) and initialized notification first. */
  dial(replay) {
    const sock = this.connect(this.socketPath);
    this.sock = sock;
    // Replay goes ahead of anything queued while the socket was down, so the gateway sees a handshake first.
    if (replay) {
      this.reinits += 1;
      this.dropId = REINIT_PREFIX + this.reinits;
      this.pending.unshift(JSON.stringify({ ...this.saved.initialize, id: this.dropId }), ...(this.saved.initialized ? [this.saved.initialized] : []));
    }
    sock.on('connect', () => {
      const queued = this.pending;
      this.pending = [];
      for (const line of queued) sock.write(line + '\n');
    });
    eachLine(sock, (line) => this.fromGateway(line), () => this.lost(sock));
    sock.on('error', () => sock.destroy());
  }

  /** Answers every request still open on the dead socket with -32000, so no agent call waits forever. */
  lost(sock) {
    if (this.sock !== sock) return;
    this.sock = null;
    this.pending = [];
    for (const id of this.open.values()) {
      this.output.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: LOST } }) + '\n');
    }
    this.open.clear();
  }
}

/** Calls `onLine` for each newline-terminated line of `stream` (without the newline) and `onEnd` once at its end. */
function eachLine(stream, onLine, onEnd) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let at;
    while ((at = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, at));
      buf = buf.slice(at + 1);
    }
  });
  stream.once('close', onEnd);
  stream.once('end', () => stream.destroy?.());
}

function parseOrNull(line) {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const idKey = (id) => `${typeof id}:${id}`;

if (require.main === module) {
  const socketPath = process.argv[2];
  if (!socketPath) {
    process.stderr.write('usage: shim.js <gw.sock path>\n');
    process.exit(2);
  }
  new Shim({ socketPath, input: process.stdin, output: process.stdout }).run().then(() => process.exit(0));
}

module.exports = { Shim, LOST, REINIT_PREFIX };
