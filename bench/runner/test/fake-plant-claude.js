// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `claude` for plant runs at <toolsDir>/<version>/claude, in the pattern of fake-plant-kiro.js. It
// reads the --mcp-config file the harness passes, starts the plant shim it names, does the MCP handshake and the calls
// in fake-plant-claude.config.json, and writes a Claude Code stream-json (`mcp__plant__<tool>` tool_use blocks and a
// result line). Like fake-claude.js, the file is a shell stub padded to the size the harness expects of the real
// binary. Test data only: it never contacts a model.

const fs = require('node:fs');
const path = require('node:path');
const { MIN_BINARY_BYTES } = require('../lib/harness/claude-code.js');

const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-plant-claude.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
const probe = (name, value) => fs.writeFileSync(path.join(cfg.dir, name), JSON.stringify(value));
probe('started.json', { pid: process.pid, args, envKeys: Object.keys(process.env).sort(), stdin: fs.readFileSync(0, 'utf8') });
const MODEL = 'us.anthropic.claude-sonnet-5-5';
const SESSION = 'fake-plant-session';
const out = (line) => console.log(JSON.stringify({ ...line, session_id: SESSION }));
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const say = (content) => out({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', id: 'msg-' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', content, usage } });
const configFile = args[args.indexOf('--mcp-config') + 1];
if (!args.includes('--mcp-config') || !fs.existsSync(configFile)) { console.error('fake: no --mcp-config file'); process.exit(1); }
const server = JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers.plant;
if (cfg.exitEarly) process.exit(1);

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
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-plant-claude', version: '0' } });
  shim.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = await request('tools/list', {});
  const tools = (listed.result?.tools ?? []).map((t) => 'mcp__plant__' + t.name);
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Bash', 'Glob', 'Grep', 'Read', 'Write', ...tools], mcp_servers: [{ name: 'plant', status: 'connected' }], model: MODEL, permissionMode: 'acceptEdits', agents: [], skills: [] });
  let i = 0;
  for (const call of cfg.calls || []) {
    const id = 'toolu_fake_' + i++;
    // inStream false: the gateway sees the call but the stream does not (a mismatch); inGateway false: the reverse.
    if (call.inStream !== false) say([{ type: 'tool_use', id, name: 'mcp__plant__' + (call.streamName ?? call.tool), input: call.args }]);
    if (call.inGateway === false) continue;
    const reply = await request('tools/call', { name: call.tool, arguments: call.args });
    out({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(reply.result ?? reply.error), is_error: Boolean(reply.error) }] } });
  }
  say([{ type: 'text', text: cfg.finalText || 'done' }]);
  out({
    type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', terminal_reason: 'completed', result: cfg.finalText || 'done',
    num_turns: i + 1, duration_ms: 10, duration_api_ms: 5, total_cost_usd: 0, usage, permission_denials: [],
    modelUsage: { [MODEL]: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, canonicalModel: 'claude-sonnet-5-5', provider: 'bedrock', costBasis: 'list' } },
  });
  shim.stdin.end();
  shim.on('exit', () => process.exit(0));
})();
`;

// The trailing comment carries the --effort flag text, so resolveClaude reports the effort flag as the real binary does.
const stub = () => `#!/bin/sh\nexec '${process.execPath}' "$(dirname "$0")/fake-plant-claude.js" "$@"\n# --effort\n`;

/**
 * Writes the fake plant `claude` under `toolsDir/<version>/` with `config`: `dir` (probe dir), `calls`
 * ([{tool, args, inStream, inGateway, streamName}]), `finalText` and `exitEarly` (exits 1 before starting the shim).
 * Returns the binary's path.
 */
function makeFakePlantClaude(toolsDir, config, version = '9.9.9') {
  const dir = path.join(toolsDir, version);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude');
  fs.writeFileSync(path.join(dir, 'fake-plant-claude.js'), SCRIPT);
  fs.writeFileSync(file, stub(), { mode: 0o755 });
  fs.truncateSync(file, MIN_BINARY_BYTES + 1);
  fs.writeFileSync(path.join(dir, 'fake-plant-claude.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakePlantClaude };
