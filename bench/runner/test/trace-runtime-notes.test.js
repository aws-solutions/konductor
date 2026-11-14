// SPDX-License-Identifier: Apache-2.0
'use strict';

// What trace says per runtime: which runs it refuses, which timeline it reads, the "what is missing" notes and how the
// listed skills are described. Pinned so the descriptor that now supplies them cannot change the wording.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { buildTrace } = require('../lib/trace.js');

const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const KIRO_STREAM = [
  { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'List Directory', rawInput: { path: '/w' }, _meta: { kiro: {} } } } },
  { type: 'runFinished', data: { sessionId: 's', status: 'success', stopReason: 'end_turn', finalText: 'ok' } },
];
const CC_STREAM = [
  { type: 'system', subtype: 'init', model: 'claude-x', slash_commands: ['verification', 'plan-review', 'x'] },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  { type: 'result', subtype: 'success', stop_reason: 'end_turn', total_cost_usd: 0.1, duration_ms: 10, num_turns: 1, result: 'hi' },
];
const INSTALLED = { name: 'konductor', prompt: 'p', mcpServers: { 'konductor-skills': { command: 'x', args: ['--skill-name-filter', 'a,b'] } } };

const NO_SESSIONS = 'no session files were saved (no session/ directory), so the model prompts, the system prompt and the per-session message log are not available; this trace comes from stream.jsonl alone';
const KIRO_TIME = 'stream.jsonl has no timestamps per event; time is only known per turn';
const CC_TIME = 'stream.jsonl has no per-event timestamps; time is only known for the whole run';

function runDir(root, { stream, result, installed }) {
  const dir = path.join(root, 'run', 'konductor', 't1', '1');
  write(path.join(dir, 'stream.jsonl'), jsonl(stream));
  if (result) write(path.join(dir, 'result.json'), JSON.stringify({ armId: 'konductor', taskId: 't1', replicate: 1, status: 'success', flags: [], ...result }));
  if (installed) write(path.join(dir, 'installed-agent.json'), JSON.stringify(installed));
  return dir;
}

test('an opencode run is refused with this exact message', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: [{ type: 'text', part: { text: 'x' } }], result: { harness: 'opencode' } });
    assert.throws(() => buildTrace(dir), { message: 'trace reads kiro-cli and Claude Code streams; this run is an opencode run' });
    const viaRuntime = runDir(root, { stream: [{ type: 'text', part: { text: 'x' } }], result: { runtime: 'opencode' } });
    assert.throws(() => buildTrace(viaRuntime), { message: 'trace reads kiro-cli and Claude Code streams; this run is an opencode run' });
  } finally { cleanup(root); }
});

test('kiro-cli: notes on session files and per-turn time, and the skill filter of the installed agent', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: KIRO_STREAM, result: { harness: 'kiro-cli', flags: [] }, installed: INSTALLED });
    const t = buildTrace(dir);
    assert.deepEqual(t.header.transcript.missing, [NO_SESSIONS, KIRO_TIME]);
    assert.equal(t.header.skillsListed.summary, "2 skills in the installed agent's filter");
    assert.deepEqual(t.header.skillsListed.names, ['a', 'b']);
    assert.deepEqual(t.entries.map((e) => e.kind), ['tool', 'final']);
    write(path.join(dir, 'session/sess_1/messages.jsonl'), '{}\n');
    assert.deepEqual(buildTrace(dir).header.transcript.missing, [KIRO_TIME]);
    write(path.join(dir, 'result.json'), JSON.stringify({ armId: 'konductor', harness: 'kiro-cli', status: 'success', flags: ['transcriptPartial'] }));
    assert.deepEqual(buildTrace(dir).header.transcript.missing, ["session files were saved (1) but the transcript is flagged partial: a session's own messages.jsonl or .jsonl is missing", KIRO_TIME]);
  } finally { cleanup(root); }
});

test('kiro-cli without an installed-agent.json: the listing is unknown and there are no names', () => {
  const root = tmp();
  try {
    const t = buildTrace(runDir(root, { stream: KIRO_STREAM, result: { harness: 'kiro-cli' } }));
    assert.equal(t.header.skillsListed.summary, 'unknown (no installed-agent.json in the run directory)');
    assert.equal(t.header.skillsListed.names, null);
  } finally { cleanup(root); }
});

test('a result with no harness, a legacy harness name, or no result.json at all is traced as kiro-cli', () => {
  const root = tmp();
  try {
    for (const result of [{}, { harness: 'none' }, { harness: 'kiro-cli-v2' }, undefined]) {
      const dir = runDir(path.join(root, JSON.stringify(result ?? 'none').replace(/\W/g, '')), { stream: KIRO_STREAM, result, installed: INSTALLED });
      const t = buildTrace(dir);
      assert.equal(t.run.harness, 'kiro-cli', JSON.stringify(result));
      assert.deepEqual(t.header.transcript.missing, [NO_SESSIONS, KIRO_TIME], JSON.stringify(result));
      assert.deepEqual(t.header.skillsListed.names, ['a', 'b'], JSON.stringify(result));
    }
  } finally { cleanup(root); }
});

test('Claude Code: one time note, no session-file notes, slash commands instead of a filter even when an installed agent is present', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: CC_STREAM, result: { harness: 'claude-code', flags: ['transcriptPartial'] }, installed: INSTALLED });
    const t = buildTrace(dir);
    assert.deepEqual(t.header.transcript.missing, [CC_TIME]);
    assert.equal(t.header.transcript.partial, true);
    assert.equal(t.header.skillsListed.summary, '3 slash commands in the session init (skills are offered by name)');
    assert.equal(t.header.skillsListed.names, null);
    assert.deepEqual(t.entries.map((e) => e.kind), ['start', 'assistant', 'final']);
    assert.equal(t.entries[0].engine, 'claude-code');
  } finally { cleanup(root); }
});
