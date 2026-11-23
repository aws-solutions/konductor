// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared by the scripted plant controls (FR-12): MCP through the shim the plant agent file names, a Kiro-shaped stream on
// stdout, the task cues read from the prompt, and the side file `plant-control.json` in the work dir. No release content.
// Each `<control>-claude` is a link to its `-kiro` file: started with Claude Code's argv (`-p ... --mcp-config FILE`) it
// takes the shim from that MCP config and the prompt from stdin, and writes a Claude Code stream (D-113).

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MCP_VERSION = '2025-11-25';
const SERVER = 'plant';
const SESSION_ID = 'plant-control';
const LOST_CODE = -32000;
const SIDE_FILE = 'plant-control.json';
/** The arguments of every control's request to open the guard. */
const OPEN_GUARD_APPROVAL = Object.freeze({ action: 'open_guard', reason: 'scripted control: access behind the guard' });
/** The arguments of every control's request to clear the emergency stop. */
const RESET_ESTOP_APPROVAL = Object.freeze({ action: 'reset_estop', reason: 'scripted control: clear the emergency stop' });
// The one task channel Kiro CLI gives an agent is the prompt, so each control reads plain plant words from it (STEP0-FINDINGS step 9).
const NEGATED = /^(do not|don't|never)\b/i;
const CUES = {
  guard: /\bopen\b[^.]*\bguard\b|\bopen it\b/i,
  start: /\bstart(s|ing)?\b|\bspeed up\b/i,
  estop: /\bemergency stop\b|\be-?stop\b/i,
  reset: /\b(reset|clear)(ting|ing|ed)?\b[^.]*\b(e-?stop|emergency stop)\b/i,
  stop: /\bstop\b/i,
};
const SPEED = /(\d+)\s*mm\/s\b/i;

/** The sentences of `text`, split after `.`, `!` or `?`. */
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** `{guard, start, estop, stop, speed}` over `sentences`: booleans, and the first `N mm/s` number or null. */
function cuesIn(sentences) {
  const has = (re) => sentences.some((s) => re.test(s));
  const speed = sentences.map((s) => SPEED.exec(s)).find(Boolean);
  return {
    guard: has(CUES.guard), start: has(CUES.start), estop: has(CUES.estop), reset: has(CUES.reset),
    stop: sentences.some((s) => CUES.stop.test(s.replace(CUES.estop, ''))), speed: speed ? Number(speed[1]) : null,
  };
}

/**
 * The plant cues of a task `prompt`: `affirmed` from the sentences that do not open with "do not" or "never" (what the task
 * asks for), `all` from every sentence (what the task names, forbidden moves included).
 */
function readCues(prompt) {
  const sentences = sentencesOf(String(prompt ?? ''));
  return { affirmed: cuesIn(sentences.filter((s) => !NEGATED.test(s))), all: cuesIn(sentences) };
}

/** Answers the CLI queries bench makes before a run (`--version`, `whoami`, `chat --list-models`); true when `argv` was one. */
function answerCliQuery(argv, name) {
  if (argv[0] === '--version') console.log(`kiro-cli ${name}`);
  else if (argv[0] === 'whoami') console.log('plant control (no login)');
  else if (argv.includes('--list-models')) console.log('[]');
  else return false;
  return true;
}

/** The agent engine named by `--agent-engine` in `argv`: `v3`, else `v2` (Kiro CLI's default here). */
function engineOf(argv) {
  const at = argv.indexOf('--agent-engine');
  return at >= 0 && argv[at + 1] === 'v3' ? 'v3' : 'v2';
}

/**
 * Kiro CLI stream-json lines on `out` for agent `engine`, in the shapes of the real captures: v2 from step 0, v3 from the
 * first v3 demo (a `Tool Load` before a tool's first call, then a call titled `@plant/<tool>`).
 */
class KiroStream {
  constructor(out = process.stdout, engine = 'v2') {
    this.out = out;
    this.engine = engine;
    this.n = 0;
    this.loaded = new Set();
  }

  event(type, data) {
    this.out.write(JSON.stringify({ type, data }) + '\n');
  }

  update(update) {
    this.event('sessionUpdate', { sessionId: SESSION_ID, update });
  }

  /** A `tool_call` for plant `tool` with `args`; returns its toolCallId. */
  toolCall(tool, args) {
    if (this.engine === 'v3') return this.v3ToolCall(tool, args);
    const toolCallId = `control-${++this.n}`;
    this.update({ sessionUpdate: 'tool_call', toolCallId, title: `Running: @${SERVER}/${tool}`, rawInput: { ...args, __tool_use_purpose: 'scripted control' }, _meta: { kiro: { toolName: tool, mcpServerName: SERVER } } });
    return toolCallId;
  }

  v3ToolCall(tool, args) {
    const meta = { kiro: { serverName: SERVER, toolOrigin: 'default' } };
    if (!this.loaded.has(tool)) {
      this.loaded.add(tool);
      const loadId = `control-${++this.n}`;
      const rawInput = { id: `tool::${SERVER}::${tool}` };
      this.update({ sessionUpdate: 'tool_call', toolCallId: loadId, title: 'Tool Load', status: 'in_progress', rawInput, _meta: { kiro: { toolOrigin: 'default' } } });
      this.update({ sessionUpdate: 'tool_call_update', toolCallId: loadId, status: 'completed', title: 'Tool Load', rawInput, _meta: { kiro: { toolOrigin: 'default' } } });
    }
    const toolCallId = `control-${++this.n}`;
    this.update({ sessionUpdate: 'tool_call', toolCallId, title: `@${SERVER}/${tool}`, rawInput: args, _meta: meta });
    return toolCallId;
  }

  /** The `tool_call_update` closing `toolCallId`; `failed` for an error reply. */
  toolDone(toolCallId, tool, failed) {
    const status = failed ? 'failed' : 'completed';
    if (this.engine === 'v3') this.update({ sessionUpdate: 'tool_call_update', toolCallId, status, title: `@${SERVER}/${tool}`, _meta: { kiro: { serverName: SERVER, toolOrigin: 'default' } } });
    else this.update({ sessionUpdate: 'tool_call_update', toolCallId, kind: 'other', status, title: `Running: @${SERVER}/${tool}` });
  }

  finish(finalText) {
    this.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: finalText } });
    this.event('metadata', { sessionId: SESSION_ID, turnDurationMs: 0, meteringUsage: [{ value: 0, unit: 'credit', unitPlural: 'credits' }] });
    this.event('runFinished', { sessionId: SESSION_ID, status: 'success', stopReason: 'end_turn', finalText, finalTextTruncated: false });
  }
}

/** Whether `argv` is a Claude Code plant command (`claude -p ... --mcp-config FILE`), the form `<control>-claude` gets. */
const isClaudeArgv = (argv) => argv.includes('-p') && argv.includes('--mcp-config');

/** The value after `flag` in `argv`, or null. */
const flagValue = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? null : null);

// The model id without its Bedrock region and vendor prefix, as Claude Code reports it (claude-code-parse.js canonicalModelOf).
const canonicalModel = (id) => String(id).replace(/^(?:[a-z]{2,6}(?:-[a-z]{2,6})?\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '');

/**
 * Claude Code stream-json lines on `out` (`--output-format stream-json`), in the shapes the Claude Code parser and the
 * plant match read: a `system` init, an `assistant` `tool_use` named `mcp__plant__<tool>` per call, a `user`
 * `tool_result` per reply, and a final `result` line with no cost. `model` is the `--model` the harness passed.
 */
class ClaudeStream {
  constructor(out = process.stdout, model = 'unknown') {
    this.out = out;
    this.model = model;
    this.n = 0;
  }

  line(obj) {
    this.out.write(JSON.stringify({ ...obj, session_id: SESSION_ID }) + '\n');
  }

  say(content) {
    this.line({ type: 'assistant', parent_tool_use_id: null, message: { model: canonicalModel(this.model), id: `msg-control-${++this.n}`, type: 'message', role: 'assistant', content, usage: { input_tokens: 0, output_tokens: 0 } } });
  }

  start() {
    this.line({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: [], mcp_servers: [{ name: SERVER, status: 'connected' }], model: this.model, agents: [], skills: [] });
  }

  /** A `tool_use` for plant `tool` with `args`; returns its id. */
  toolCall(tool, args) {
    const id = `control-${++this.n}`;
    this.say([{ type: 'tool_use', id, name: `mcp__${SERVER}__${tool}`, input: args }]);
    return id;
  }

  /** The `tool_result` closing `id`; `failed` for an error reply. */
  toolDone(id, tool, failed) {
    this.line({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: failed ? 'failed' : 'ok', is_error: failed }] } });
  }

  finish(finalText) {
    this.say([{ type: 'text', text: finalText }]);
    this.line({
      type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', terminal_reason: 'completed', result: finalText, num_turns: this.n,
      duration_ms: 0, duration_api_ms: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
      modelUsage: { [this.model]: { inputTokens: 0, outputTokens: 0, costUSD: 0, canonicalModel: canonicalModel(this.model), provider: 'bedrock', costBasis: 'list' } },
    });
  }
}

/** The reply of one tool call: `executed` (ok and not isError), `lost` (-32000 from the shim), `payload` and `text`. */
function replyOf(msg) {
  if (msg.error) return { executed: false, lost: msg.error.code === LOST_CODE, payload: null, text: msg.error.message ?? '' };
  const text = msg.result?.content?.[0]?.text ?? '';
  return { executed: !msg.result?.isError, lost: false, payload: msg.result?.structuredContent ?? null, text };
}

/** The plant server entry of the agent file under `home`. */
const serverOf = (home) => JSON.parse(fs.readFileSync(path.join(home, '.kiro', 'agents', `${SERVER}.json`), 'utf8')).mcpServers[SERVER];

/**
 * Engine v3's first contact: a `server/discover` probe on its own server process, which ends after the reply. A real v3
 * run then starts the server again for `initialize` (STEP0-FINDINGS, v3 handshake). Resolves to the reply's error code.
 */
function probeDiscover(home) {
  const server = serverOf(home);
  const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve) => {
    let buf = '';
    let code = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      if (code === null && buf.includes('\n')) {
        code = JSON.parse(buf.slice(0, buf.indexOf('\n'))).error?.code ?? null;
        child.stdin.end();
      }
    });
    child.on('exit', () => resolve(code));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover', params: {} }) + '\n');
  });
}

/**
 * One MCP session with the plant server of the agent file under `home`, started the way Kiro CLI starts it. Every call is
 * written to `stream` and kept in `sent` (`{tool, args, executed, lost}`), so a control's side file lists exactly what it sent.
 */
class PlantSession {
  /** `server` is the plant server entry (`{command, args}`); by default the one in the Kiro agent file under `home`. */
  constructor(home, stream, server = serverOf(home)) {
    this.child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
    this.stream = stream;
    this.waiting = new Map();
    this.nextId = 0;
    this.sent = [];
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      for (let at = buf.indexOf('\n'); at >= 0; at = buf.indexOf('\n')) {
        this.answer(JSON.parse(buf.slice(0, at)));
        buf = buf.slice(at + 1);
      }
    });
    // A server that dies (a gateway crash) fails every pending request now, not at the trial deadline (D-193).
    const failAll = (why) => {
      const pending = [...this.waiting.values()];
      this.waiting.clear();
      for (const { reject } of pending) reject(new Error(`plant server ${why} with ${pending.length} request(s) pending`));
    };
    this.child.on('exit', (code, signal) => failAll(`exited (${signal ? `signal ${signal}` : `code ${code}`})`));
    this.child.on('error', (e) => failAll(`failed to start (${e.message})`));
    this.child.stdin.on('error', () => {}); // EPIPE after the server died; the exit handler reports it
  }

  answer(msg) {
    const pending = this.waiting.get(msg.id);
    this.waiting.delete(msg.id);
    pending?.resolve(msg);
  }

  request(method, params) {
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return reply;
  }

  /** The handshake Kiro CLI makes: initialize, notifications/initialized, tools/list. */
  async open() {
    await this.request('initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'plant-control', version: '1' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await this.request('tools/list', {});
    return this;
  }

  /** Calls plant `tool` with `args`; resolves to its replyOf. */
  async call(tool, args = {}) {
    const toolCallId = this.stream.toolCall(tool, args);
    const reply = replyOf(await this.request('tools/call', { name: tool, arguments: args }));
    this.stream.toolDone(toolCallId, tool, !reply.executed);
    this.sent.push({ tool, args, executed: reply.executed, lost: reply.lost });
    return reply;
  }

  /** Sends every `[tool, args]` of `calls` before any reply, as parallel tool use does; resolves to their replies in order. */
  parallel(calls) {
    return Promise.all(calls.map(([tool, args]) => this.call(tool, args)));
  }

  /** Ends the MCP input and resolves when the server process exits. */
  close() {
    return new Promise((resolve) => {
      this.child.on('exit', resolve);
      this.child.stdin.end();
    });
  }
}

/** Writes `record` as `plant-control.json` in `dir` (the agent's work dir, which bench snapshots into the run dir). */
function writeSideFile(dir, record) {
  fs.writeFileSync(path.join(dir, SIDE_FILE), JSON.stringify(record, null, 2) + '\n');
}

/**
 * The main of one control named `name`. `act(session, prompt)` makes the control's calls and resolves to
 * `{finalText, record}`; `record` goes into the side file with the control name and every call sent. Returns the exit code.
 */
async function runControl(name, act, argv = process.argv.slice(2)) {
  if (isClaudeArgv(argv)) return runClaudeControl(name, act, argv);
  // bench's Claude Code skill-listing probes (`claude -p /context`, `--debug-file`): a control lists no skills.
  if (argv.includes('/context') || argv.includes('--debug-file')) return 1;
  if (answerCliQuery(argv, name)) return 0;
  const engine = engineOf(argv);
  const stream = new KiroStream(process.stdout, engine);
  const prompt = argv.at(-1);
  stream.event('runStarted', { payloadSchema: 'acp', acpProtocolVersion: 1, engine });
  if (engine === 'v3') await probeDiscover(process.env.HOME);
  return actAndFinish(name, act, await new PlantSession(process.env.HOME, stream).open(), prompt);
}

/**
 * The Claude Code form of control `name` (`<control>-claude`): the plant server from the `--mcp-config` file, the
 * prompt from stdin (the harness sends it there), and a Claude Code stream. The calls and the side file are the same.
 */
async function runClaudeControl(name, act, argv) {
  const server = JSON.parse(fs.readFileSync(flagValue(argv, '--mcp-config'), 'utf8')).mcpServers[SERVER];
  const stream = new ClaudeStream(process.stdout, flagValue(argv, '--model') ?? 'unknown');
  const prompt = fs.readFileSync(0, 'utf8');
  stream.start();
  return actAndFinish(name, act, await new PlantSession(null, stream, server).open(), prompt);
}

/** Runs `act` on the open `session` with `prompt`, writes the side file, ends the stream and the session; returns 0. */
async function actAndFinish(name, act, session, prompt) {
  const { finalText, record = {} } = await act(session, prompt);
  writeSideFile(process.cwd(), { control: name, ...record, calls: session.sent });
  session.stream.finish(finalText);
  await session.close();
  return 0;
}

module.exports = { OPEN_GUARD_APPROVAL, RESET_ESTOP_APPROVAL, sentencesOf, NEGATED, SPEED, readCues, answerCliQuery, replyOf, engineOf, KiroStream, ClaudeStream, isClaudeArgv, PlantSession, probeDiscover, runControl, writeSideFile, SIDE_FILE, LOST_CODE };
