// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `kiro-cli` for plant runs (a node script), in the pattern of fake-kiro.js. It reads the plant agent
// file, starts the shim it names, does the MCP handshake and the calls in fake-plant-kiro.config.json, and writes a
// stream in the shape of the engine named by --agent-engine (v2 by default; v3 also probes server/discover on its own
// shim first, as a real v3 run does). Test data only.

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
const engine = args.includes('--agent-engine') && args[args.indexOf('--agent-engine') + 1] === 'v3' ? 'v3' : 'v2';
const update = (u) => ev('sessionUpdate', { sessionId: 's1', update: { sessionUpdate: 'tool_call', ...u } });
// v3: a Tool Load first (not a call), then '@plant/<tool>'; a deferred call is wrapped as Tool Call, an unreadable one has no '@plant/' title.
function streamCall(call, i) {
  const { tool, args: input } = call;
  if (engine === 'v2') return update({ toolCallId: 'fake-' + i, title: 'Running: @plant/' + tool, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: 'plant' } } });
  update({ toolCallId: 'fake-load-' + i, title: 'Tool Load', status: 'in_progress', rawInput: { id: 'tool::plant::' + tool }, _meta: { kiro: { toolOrigin: 'default' } } });
  const meta = { kiro: { serverName: 'plant', toolOrigin: 'default' } };
  if (call.deferred) return update({ toolCallId: 'fake-' + i, title: 'Tool Call', rawInput: { tool_id: 'tool::plant::' + tool, arguments: input }, _meta: meta });
  update({ toolCallId: 'fake-' + i, title: call.unreadable ? 'Plant call' : '@plant/' + tool, rawInput: input, _meta: meta });
}

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

// The gateway of this run only: the process holding a socket bound to this run's gw.sock (from /proc/net/unix). Other
// gateways on the host, such as another test file's, are never touched.
function ownGatewayPids(socketPath) {
  const inodes = new Set(fs.readFileSync('/proc/net/unix', 'utf8').split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/)).filter((f) => f[7] === socketPath).map((f) => 'socket:[' + f[6] + ']'));
  return gatewayProcs().map((p) => p.pid).filter((pid) => {
    try { return fs.readdirSync('/proc/' + pid + '/fd').some((fd) => inodes.has(fs.readlinkSync('/proc/' + pid + '/fd/' + fd))); } catch { return false; }
  });
}

if (cfg.exit3) { ev('runError', { stage: 'init', message: 'MCP server plant failed to start' }); process.exit(3); }
const agent = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.kiro/agents/plant.json'), 'utf8'));
const server = agent.mcpServers.plant;
// The v3 probe: server/discover on a shim of its own, which ends after the -32601.
const discover = () => new Promise((resolve) => {
  const probeShim = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  let reply = '';
  probeShim.stdout.setEncoding('utf8');
  probeShim.stdout.on('data', (chunk) => { reply += chunk; if (reply.includes('\n')) probeShim.stdin.end(); });
  probeShim.on('exit', () => { probe('discover.json', JSON.parse(reply.split('\n')[0])); resolve(); });
  probeShim.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover', params: {} }) + '\n');
});
let shim;
let buf = '';
const waiting = new Map();
function startShim() {
  shim = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
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
}
let nextId = 0;
const request = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); shim.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

(async () => {
  if (engine === 'v3') await discover();
  startShim();
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-plant-kiro', version: '0' } });
  shim.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await request('tools/list', {});
  ev('runStarted', { engine });
  if (cfg.dump) probe('dump.json', { argv: process.argv, env: process.env, procs: gatewayProcs(), files: filesUnder(path.dirname(process.env.HOME)) });
  if (cfg.stopGateway) {
    const own = ownGatewayPids(server.args[1]);
    probe('stopped.json', own);
    for (const pid of own) process.kill(pid, 'SIGSTOP');
    setTimeout(() => {}, 60000);
    return;
  }
  let i = 0;
  // window > 1 keeps that many gateway calls in flight instead of one at a time, for tests that need many calls.
  const inFlight = new Set();
  for (const call of cfg.calls || []) {
    if (call.inStream !== false) streamCall(call, i++);
    if (call.inGateway === false) continue;
    const reply = request('tools/call', { name: call.tool, arguments: call.args });
    if (!(cfg.window > 1)) { await reply; continue; }
    inFlight.add(reply);
    reply.then(() => inFlight.delete(reply));
    if (inFlight.size >= cfg.window) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  if (cfg.overLongLine) shim.stdin.write('x'.repeat(65 * 1024) + '\n');
  if (cfg.hold) { probe('held.json', { at: Date.now() }); setTimeout(() => {}, 60000); return; }
  ev('metadata', { sessionId: 's1', turnDurationMs: 100, meteringUsage: [{ value: 0.5, unit: 'credit' }] });
  ev('runFinished', { sessionId: 's1', status: 'success', stopReason: 'end_turn', finalText: cfg.finalText || 'done', finalTextTruncated: false });
  shim.stdin.end();
  shim.on('exit', () => process.exit(0));
})();
`;

/** Writes the fake `kiro-cli` into `binDir` with `config`: `dir` (probe dir), `calls` ([{tool, args, inStream, inGateway, deferred, unreadable}]; the last two shape a v3 stream line), `finalText`, `exit3`, `stopGateway`, `dump`, `overLongLine` (sends a line over the gateway's line limit after the calls), `window` (gateway calls kept in flight at once, default 1) and `hold` (never finishes after the calls). Returns its path. */
function makeFakePlantKiro(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'kiro-cli');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-plant-kiro.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakePlantKiro };
