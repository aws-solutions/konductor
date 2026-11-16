// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `kiro-cli` for plant runs (a node script), in the pattern of fake-kiro.js. It reads the plant agent
// file, starts the shim it names, does the MCP handshake and the calls in fake-plant-kiro.config.json, and writes a
// stream in the engine v2 shape. Test data only.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-plant-kiro.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('kiro-cli 9.9.9'); process.exit(0); }
const probe = (name, value) => fs.writeFileSync(path.join(cfg.dir, name), JSON.stringify(value));
probe('started.json', { pid: process.pid, args });
const ev = (type, data) => console.log(JSON.stringify({ type, data }));
const streamCall = (tool, input, i) => ev('sessionUpdate', { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 'fake-' + i, title: 'Running: @plant/' + tool, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: 'plant' } } } });

// Every process whose command line runs the gateway: its argv and env, as /proc shows them to the host.
function gatewayProcs() {
  const out = [];
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmdline = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
      if (!cmdline.includes('--control-fd')) continue;
      out.push({ pid: Number(pid), cmdline, environ: fs.readFileSync('/proc/' + pid + '/environ', 'utf8') });
    } catch { /* gone or not ours */ }
  }
  return out;
}

// Every regular file under dir, by path, with its text.
function filesUnder(dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else if (e.isFile()) out[p] = fs.readFileSync(p, 'latin1');
  }
  return out;
}

if (cfg.exit3) { ev('runError', { stage: 'init', message: 'MCP server plant failed to start' }); process.exit(3); }
const agent = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.kiro/agents/plant.json'), 'utf8'));
const server = agent.mcpServers.plant;
const shim = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const waiting = new Map();
shim.stdout.setEncoding('utf8');
shim.stdout.on('data', (chunk) => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, at));
    buf = buf.slice(at + 1);
    if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  }
});
let nextId = 0;
const request = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); shim.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

(async () => {
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-plant-kiro', version: '0' } });
  shim.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await request('tools/list', {});
  ev('runStarted', { engine: 'v2' });
  if (cfg.dump) probe('dump.json', { argv: process.argv, env: process.env, procs: gatewayProcs(), files: filesUnder(path.dirname(process.env.HOME)) });
  if (cfg.stopGateway) {
    for (const p of gatewayProcs()) process.kill(p.pid, 'SIGSTOP');
    setTimeout(() => {}, 60000);
    return;
  }
  let i = 0;
  for (const call of cfg.calls || []) {
    if (call.inStream !== false) streamCall(call.tool, call.args, i++);
    if (call.inGateway !== false) await request('tools/call', { name: call.tool, arguments: call.args });
  }
  if (cfg.overLongLine) shim.stdin.write('x'.repeat(65 * 1024) + '\n');
  if (cfg.hold) { setTimeout(() => {}, 60000); return; }
  ev('metadata', { sessionId: 's1', turnDurationMs: 100, meteringUsage: [{ value: 0.5, unit: 'credit' }] });
  ev('runFinished', { sessionId: 's1', status: 'success', stopReason: 'end_turn', finalText: cfg.finalText || 'done', finalTextTruncated: false });
  shim.stdin.end();
  shim.on('exit', () => process.exit(0));
})();
`;

/** Writes the fake `kiro-cli` into `binDir` with `config`: `dir` (probe dir), `calls` ([{tool, args, inStream, inGateway}]), `finalText`, `exit3`, `stopGateway`, `dump`, `overLongLine` (sends a line over the gateway's line limit after the calls) and `hold` (never finishes after the calls). Returns its path. */
function makeFakePlantKiro(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'kiro-cli');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-plant-kiro.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakePlantKiro };
