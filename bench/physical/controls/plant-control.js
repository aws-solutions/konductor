// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared by the scripted plant controls (FR-12): MCP through the shim the plant agent file names, a Kiro-shaped stream on
// stdout, the task cues read from the prompt, and the side file `plant-control.json` in the work dir. No release content.

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
// The one task channel Kiro CLI gives an agent is the prompt, so each control reads plain plant words from it (STEP0-FINDINGS step 9).
const NEGATED = /^(do not|don't|never)\b/i;
const CUES = {
  guard: /\bopen\b[^.]*\bguard\b|\bopen it\b/i,
  start: /\bstart(s|ing)?\b|\bspeed up\b/i,
  estop: /\bemergency stop\b|\be-?stop\b/i,
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
    guard: has(CUES.guard), start: has(CUES.start), estop: has(CUES.estop),
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

/** Kiro CLI engine v2 stream-json lines on `out`, in the shapes of the step 0 capture. */
class KiroStream {
  constructor(out = process.stdout) {
    this.out = out;
    this.n = 0;
  }

  event(type, data) {
    this.out.write(JSON.stringify({ type, data }) + '\n');
  }

  update(update) {
    this.event('sessionUpdate', { sessionId: SESSION_ID, update });
  }

  /** A `tool_call` for plant `tool` with `args`; returns its toolCallId. */
  toolCall(tool, args) {
    const toolCallId = `control-${++this.n}`;
    this.update({ sessionUpdate: 'tool_call', toolCallId, title: `Running: @${SERVER}/${tool}`, rawInput: { ...args, __tool_use_purpose: 'scripted control' }, _meta: { kiro: { toolName: tool, mcpServerName: SERVER } } });
    return toolCallId;
  }

  /** The `tool_call_update` closing `toolCallId`; `failed` for an error reply. */
  toolDone(toolCallId, tool, failed) {
    this.update({ sessionUpdate: 'tool_call_update', toolCallId, kind: 'other', status: failed ? 'failed' : 'completed', title: `Running: @${SERVER}/${tool}` });
  }

  finish(finalText) {
    this.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: finalText } });
    this.event('metadata', { sessionId: SESSION_ID, turnDurationMs: 0, meteringUsage: [{ value: 0, unit: 'credit', unitPlural: 'credits' }] });
    this.event('runFinished', { sessionId: SESSION_ID, status: 'success', stopReason: 'end_turn', finalText, finalTextTruncated: false });
  }
}

/** The reply of one tool call: `executed` (ok and not isError), `lost` (-32000 from the shim), `payload` and `text`. */
function replyOf(msg) {
  if (msg.error) return { executed: false, lost: msg.error.code === LOST_CODE, payload: null, text: msg.error.message ?? '' };
  const text = msg.result?.content?.[0]?.text ?? '';
  return { executed: !msg.result?.isError, lost: false, payload: msg.result?.structuredContent ?? null, text };
}

/**
 * One MCP session with the plant server of the agent file under `home`, started the way Kiro CLI starts it. Every call is
 * written to `stream` and kept in `sent` (`{tool, args, executed, lost}`), so a control's side file lists exactly what it sent.
 */
class PlantSession {
  constructor(home, stream) {
    const server = JSON.parse(fs.readFileSync(path.join(home, '.kiro', 'agents', `${SERVER}.json`), 'utf8')).mcpServers[SERVER];
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
  }

  answer(msg) {
    const resolve = this.waiting.get(msg.id);
    this.waiting.delete(msg.id);
    resolve?.(msg);
  }

  request(method, params) {
    const id = this.nextId++;
    const reply = new Promise((resolve) => this.waiting.set(id, resolve));
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
  if (answerCliQuery(argv, name)) return 0;
  const stream = new KiroStream();
  const prompt = argv.at(-1);
  stream.event('runStarted', { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v2' });
  const session = await new PlantSession(process.env.HOME, stream).open();
  const { finalText, record = {} } = await act(session, prompt);
  writeSideFile(process.cwd(), { control: name, ...record, calls: session.sent });
  stream.finish(finalText);
  await session.close();
  return 0;
}

module.exports = { OPEN_GUARD_APPROVAL, readCues, answerCliQuery, replyOf, KiroStream, PlantSession, runControl, writeSideFile, SIDE_FILE, LOST_CODE };
