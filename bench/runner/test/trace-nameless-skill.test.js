// SPDX-License-Identifier: Apache-2.0
'use strict';

// `trace --instructions` on a run whose skill load carries no name (a refused get_skill) or whose load_resource has no id:
// the instruction map has the same shape for every entry and the renderer says so instead of throwing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { buildTrace, renderMarkdown, mentionsOf } = require('../lib/trace.js');

const upd = (u) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update: u } });
const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

const STREAM = [
  { type: 'runStarted', data: { engine: 'v3' } },
  upd({ sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'Tool Call', rawInput: { tool_id: 'tool::konductor-skills::get_skill', arguments: {} } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'g1', status: 'failed', rawInput: { tool_id: 'tool::konductor-skills::get_skill', arguments: {} }, rawOutput: { message: 'Tool "tool::konductor-skills::get_skill" has not been loaded yet.' } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'l1', title: 'Load Resource', rawInput: {} }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'l1', status: 'failed', title: 'Load Resource', rawInput: {}, rawOutput: { message: 'Use one exact resource ID.' } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'g2', title: 'Tool Call', rawInput: { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'verification' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'g2', status: 'failed', rawInput: { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'verification' } }, rawOutput: { message: 'refused' } }),
  { type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'done' } },
];

function runDir(root) {
  const dir = path.join(root, 'run', 'konductor', 't1', '1');
  write(path.join(dir, 'stream.jsonl'), jsonl(STREAM));
  write(path.join(dir, 'result.json'), JSON.stringify({ armId: 'konductor', taskId: 't1', replicate: 1, harness: 'kiro-cli', status: 'success', flags: [] }));
  write(path.join(dir, 'installed-agent.json'), JSON.stringify({ name: 'konductor', prompt: 'Load verification before you finish.' }));
  return dir;
}

test('mentionsOf returns the full object shape for a missing name', () => {
  for (const name of [undefined, null, '']) assert.deepEqual(mentionsOf([{ label: 'x', lines: ['a'] }], name), { total: 0, hits: [], listed: [] });
});

test('trace --instructions renders a nameless refused skill load and a nameless load_resource without throwing', () => {
  const root = tmp();
  try {
    const t = buildTrace(runDir(root), { instructions: true });
    const loads = t.entries.filter((e) => e.kind === 'skill-load');
    assert.equal(loads.length, 2);
    assert.equal(loads[0].input.name, undefined);
    assert.deepEqual(loads[0].instructions, { total: 0, hits: [], listed: [] });
    const md = renderMarkdown(t);
    assert.match(md, /LOAD SKILL {2}\(no name\)/);
    assert.match(md, /INFERRED, the call recorded no name \(a refused call\)/);
    assert.match(md, /INFERRED, instruction text that mentions "verification" \(1 line\(s\)\)/);
    assert.ok(t.entries.some((e) => e.kind === 'tool' && e.title === 'Load Resource'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an entry carrying the old empty-array instructions still renders', () => {
  const root = tmp();
  try {
    const t = buildTrace(runDir(root), { instructions: true });
    for (const e of t.entries) if (e.instructions) e.instructions = [];
    assert.doesNotThrow(() => renderMarkdown(t));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
