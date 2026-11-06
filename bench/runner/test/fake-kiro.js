// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `kiro-cli` (a node script) in a directory. Its behavior is read
// from fake-kiro.config.json next to it, because the runner passes it no custom env.

const fs = require('node:fs');
const path = require('node:path');
const { defaultAuthDb } = require('../lib/sandbox.js');

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const net = require('net');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-kiro.config.json'), 'utf8'));
const args = process.argv.slice(2);
const engine = args.includes('--agent-engine') ? args[args.indexOf('--agent-engine') + 1] : 'v2';
if (args[0] === '--version') { console.log('kiro-cli 9.9.9'); process.exit(0); }
if (args.includes('--list-models')) { console.log('[]'); process.exit(0); }
if (args.includes('--help')) { console.log('--agent-engine <ENGINE>\\n[possible values: v2, v1, v3]'); process.exit(0); }
// Multi-turn runs: each invocation is one turn; cfg.turns[i] overrides the base config for turn i+1.
let turn = 0;
try { turn = fs.readdirSync(cfg.dir).filter((f) => /^started-\\d+\\.json$/.test(f)).length; } catch { /* read-only probe directory */ }
const tc = { ...cfg, ...((cfg.turns || [])[Math.min(turn, (cfg.turns || []).length - 1)] || {}) };
const authFile = path.join(process.env.HOME, process.platform === 'darwin' ? 'Library/Application Support/kiro-cli' : '.local/share/kiro-cli', 'data.sqlite3');
const started = JSON.stringify({ pid: process.pid, cwd: process.cwd(), home: process.env.HOME, args, envKeys: Object.keys(process.env), authPresent: fs.existsSync(authFile), turn: turn + 1 });
try { fs.writeFileSync(path.join(cfg.dir, 'started.json'), started); fs.writeFileSync(path.join(cfg.dir, 'started-' + (turn + 1) + '.json'), started); } catch { /* the probe directory is read-only inside a namespace */ }
if (tc.plantFile) { fs.mkdirSync(path.dirname(tc.plantFile), { recursive: true }); fs.writeFileSync(tc.plantFile, tc.plantText || ''); }
if (tc.exitCode) { process.exit(tc.exitCode); }
if (tc.sleepSec) { setTimeout(() => {}, tc.sleepSec * 1000); return; }
const ev = (type, data) => console.log(JSON.stringify({ type, data }));
fs.writeFileSync('out.txt', 'done\\n');
for (const [f, text] of Object.entries(tc.files || {})) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const sid = cfg.sessionId || 's1';
// Engine v3 titles a call instead of naming the tool, marks a sub-agent call with its own subtask id, and reports
// credits once, in a turn_completion summary.
const V3_TITLES = { read_file: 'Read File', fs_write: 'Write File', execute_bash: 'Run Command' };
const v3Call = (c, i) => {
  const sub = c.toolName === 'subagent';
  const update = { toolCallId: (sub ? 'invoke_subagent_fake-' : 'fake-') + i, _meta: { kiro: sub ? { kind: 'agent-subtask', agentSubtaskId: 'subtask-' + i } : { toolOrigin: 'default' } } };
  const title = sub ? 'Sub-agent: ' + ((c.rawInput || {}).name || 'agent') : V3_TITLES[c.toolName] || c.toolName;
  ev('sessionUpdate', { sessionId: sid, update: { sessionUpdate: 'tool_call', title, rawInput: c.rawInput, ...update } });
  if (c.rawOutput !== undefined) ev('sessionUpdate', { sessionId: sid, update: { sessionUpdate: 'tool_call_update', status: 'completed', rawInput: c.rawInput, rawOutput: c.rawOutput, ...update } });
};
const v3Completion = () => {
  const id = 'exec-' + (turn + 1);
  const summary = { unit: 'credit', unitPlural: 'credits', usage: tc.credits ?? 0.5, usedTools: [] };
  ev('sessionUpdate', { sessionId: sid, update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', executionId: id, turnId: id, elapsedTime: 100, status: 'success', promptTurnSummaries: [summary], requestIds: [] } } } });
};
const finish = () => {
  ev('runStarted', { engine });
  (tc.toolCalls || []).forEach((c, i) => {
    if (engine === 'v3') { v3Call(c, i); return; }
    ev('sessionUpdate', { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 'fake-' + i, title: 'x', rawInput: c.rawInput, _meta: { kiro: { toolName: c.toolName, ...(c.mcpServerName ? { mcpServerName: c.mcpServerName } : {}) } } } });
    if (c.rawOutput !== undefined) ev('sessionUpdate', { sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: 'fake-' + i, status: 'completed', rawInput: c.rawInput, rawOutput: c.rawOutput } });
  });
  if (engine === 'v3') v3Completion(); else ev('metadata', { sessionId: sid, turnDurationMs: 100, meteringUsage: [{ value: tc.credits ?? 0.5, unit: 'credit' }] });
  if (tc.lingerMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, tc.lingerMs);
  if (tc.hangAfterMetering) { setTimeout(() => {}, 60000); return; }
  ev('runFinished', { sessionId: sid, status: 'success', stopReason: tc.stopReason ?? 'end_turn', finalText: tc.finalText ?? 'done', finalTextTruncated: false });
  if (cfg.sessionJson) {
    const sdir = path.join(process.env.HOME, '.kiro/sessions/cli');
    fs.mkdirSync(sdir, { recursive: true });
    const jf = path.join(sdir, sid + '.json');
    let j = { session_state: { conversation_metadata: { user_turn_metadatas: [] } } };
    try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { /* first turn */ }
    j.session_state.conversation_metadata.user_turn_metadatas.push({ model: tc.model ?? 'claude-sonnet-5.5', total_request_count: 1, metering_usage: [{ value: tc.credits ?? 0.5, unit: 'credit' }] });
    fs.writeFileSync(jf, JSON.stringify(j));
    fs.writeFileSync(path.join(sdir, sid + '.jsonl'), '{"kind":"Prompt"}\\n');
  }
};
if (cfg.breakSessions) { fs.mkdirSync(path.join(process.env.HOME, '.kiro/sessions'), { recursive: true }); fs.writeFileSync(path.join(process.env.HOME, '.kiro/sessions/cli'), 'not a directory'); }
if (cfg.agentJsonDir) fs.mkdirSync(path.join(process.env.HOME, '.kiro/agents/konductor.json'), { recursive: true });
if (cfg.sessionTree) {
  const sdir = path.join(process.env.HOME, '.kiro/sessions/cli');
  fs.mkdirSync(path.join(sdir, 's1/tool-results'), { recursive: true });
  fs.writeFileSync(path.join(sdir, 's1.jsonl'), '{"kind":"Prompt"}\\n');
  fs.writeFileSync(path.join(sdir, 's1/tool-results/out.txt'), 'nested');
}
if (cfg.sessionTreeV3) {
  const sdir = path.join(process.env.HOME, '.kiro/sessions', 'ab12cd34ef56ab78', sid);
  fs.mkdirSync(path.join(sdir, 'sub-executions'), { recursive: true });
  fs.writeFileSync(path.join(sdir, 'session.json'), JSON.stringify({ id: sid, workspacePaths: [process.cwd(), cfg.hostPath || '/none'] }));
  fs.writeFileSync(path.join(sdir, 'messages.jsonl'), JSON.stringify({ payload: { type: 'user', content: 'hello ' + (cfg.hostPath || '') } }) + '\\n');
  fs.writeFileSync(path.join(sdir, 'sub-executions', 'e1.jsonl'), JSON.stringify({ payload: { type: 'assistant', content: 'sub' } }) + '\\n');
  fs.writeFileSync(path.join(sdir, 'publish.cursor'), '1');
}
if (cfg.makeSocket) { const s = net.createServer(); s.listen(path.join(process.cwd(), 'sock'), () => { finish(); process.exit(0); }); } else if (tc.delayMs) { setTimeout(finish, tc.delayMs); } else { finish(); }
`;

function makeFakeKiro(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'kiro-cli');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-kiro.config.json'), JSON.stringify(config));
  return file;
}

// Plants a stand-in auth database where the runner looks for it under this HOME.
function writeFakeAuth(home) {
  const db = defaultAuthDb(home);
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.writeFileSync(db, 'fake-auth');
}

module.exports = { makeFakeKiro, writeFakeAuth };
