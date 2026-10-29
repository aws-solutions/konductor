// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { aggregateEvents, rollUp, totalTokens, queryRollup, SQL } = require('../lib/harness/opencode-parse.js');
const { parseStream } = require('../lib/stream.js');

const FX = path.join(__dirname, 'fixtures');
const events = (name) => parseStream(fs.readFileSync(path.join(FX, `opencode-${name}.stream.jsonl`), 'utf8')).events;
const rows = JSON.parse(fs.readFileSync(path.join(FX, 'opencode-konductor.rows.json'), 'utf8'));

test('the parent stream of a delegating run: steps, tokens, cost, final text and stop reason', () => {
  const a = aggregateEvents(events('konductor'));
  assert.equal(a.sessionId, 'ses_e7b054e3effeoNkTB9235JQROu');
  assert.equal(a.steps, 2);
  assert.deepEqual(a.tokens, { input: 6, output: 380, reasoning: 0, cacheRead: 35749, cacheWrite: 36199 });
  assert.ok(Math.abs(a.costUsd - 0.0978844) < 1e-9);
  assert.equal(a.runFinishedStatus, 'success');
  assert.equal(a.stopReason, 'end_turn');
  assert.match(a.finalText, /^I created `hello\.txt`/);
  assert.equal(a.toolCalls, 1);
  assert.deepEqual(a.toolNames, { task: 1 });
  assert.equal(a.askedUser, false);
  assert.equal(a.turnDurationMs, 1793232399049 - 1793232387935);
});

test('the vanilla stream has one write call and no subagent', () => {
  const a = aggregateEvents(events('vanilla'));
  assert.deepEqual(a.toolNames, { write: 1 });
  assert.equal(a.tokens.cacheWrite, 10685);
});

test('totalTokens is input + output + cache read + cache write; reasoning is not added again', () => {
  assert.equal(totalTokens({ input: 6, output: 380, reasoning: 50, cacheRead: 35749, cacheWrite: 36199 }), 72334);
});

test('a stream cut off after a tool call is unfinished, not a success', () => {
  const cut = events('konductor').slice(0, 4);
  const a = aggregateEvents(cut);
  assert.equal(a.runFinishedStatus, null);
  assert.equal(a.turnDurationMs, null);
  assert.equal(a.finalText, null);
});

test('an error event makes the run an error and keeps the message', () => {
  const ev = events('vanilla').slice(0, 3);
  const a = aggregateEvents([...ev, { type: 'error', timestamp: 1, sessionID: ev[0].sessionID, error: { name: 'APIError', data: { message: 'boom' } } }]);
  assert.equal(a.runFinishedStatus, 'error');
  assert.match(a.errors[0], /boom/);
});

test('a non-end stop reason is reported so askedUser is true', () => {
  const ev = events('vanilla').map((e) => (e.type === 'step_finish' && e.part.reason === 'stop' ? { ...e, part: { ...e.part, reason: 'length' } } : e));
  const a = aggregateEvents(ev);
  assert.equal(a.stopReason, 'length');
  assert.equal(a.askedUser, true);
});

test('rollUp adds every descendant session: parent + child equals the database total', () => {
  const u = rollUp(rows);
  assert.equal(u.sessions, 2);
  assert.equal(u.rootId, 'ses_e7b054e3effeoNkTB9235JQROu');
  assert.deepEqual(u.tokens, { input: 14, output: 765, reasoning: 0, cacheRead: 91613, cacheWrite: 64506 });
  assert.equal(totalTokens(u.tokens), 14 + 765 + 91613 + 64506);
  assert.ok(Math.abs(u.costUsd - 0.1781043) < 1e-9);
  assert.equal(u.modelCalls, 5);
  assert.equal(u.toolCalls, 4);
  assert.equal(u.workToolCalls, 3);
  assert.equal(u.subagentCalls, 1);
  assert.deepEqual(u.toolNames, { bash: 1, read: 1, task: 1, write: 1 });
  assert.deepEqual(u.orphanSessions, []);
  assert.equal(u.rootModel, 'global.anthropic.claude-sonnet-5-5');
  assert.deepEqual(u.root.tokens, { input: 6, output: 380, reasoning: 0, cacheRead: 35749, cacheWrite: 36199 });
  assert.deepEqual(u.models, ['global.anthropic.claude-sonnet-5-5']);
  assert.deepEqual(u.variants, ['default', 'low']);
  const parent = rows.sessions[0];
  const child = rows.sessions[1];
  assert.ok(Math.abs(u.costUsd - (parent.cost + child.cost)) < 1e-12);
});

test('a session outside the root tree is reported and not added', () => {
  const stray = { ...rows.sessions[1], id: 'ses_stray', parent_id: 'ses_missing', cost: 9 };
  const u = rollUp({ ...rows, sessions: [...rows.sessions, stray] });
  assert.deepEqual(u.orphanSessions, ['ses_stray']);
  assert.ok(u.costUsd < 1);
});

test('a grandchild session is included through its parent chain', () => {
  const grand = { ...rows.sessions[1], id: 'ses_grand', parent_id: rows.sessions[1].id, cost: 1, tokens_input: 1, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0 };
  const u = rollUp({ ...rows, sessions: [...rows.sessions, grand] });
  assert.equal(u.sessions, 3);
  assert.equal(u.tokens.input, 15);
});

test('rollUp prefers the stream session id as root and returns null for an empty database', () => {
  assert.equal(rollUp({ sessions: [], messages: [], tools: [] }), null);
  const two = [{ ...rows.sessions[0] }, { ...rows.sessions[0], id: 'ses_other', cost: 5 }];
  assert.equal(rollUp({ ...rows, sessions: two }, 'ses_other').rootId, 'ses_other');
});

test('queryRollup issues three read-only queries through the injected db runner', () => {
  const seen = [];
  const u = queryRollup((sql) => {
    seen.push(sql);
    if (sql === SQL.sessions) return rows.sessions;
    if (sql === SQL.messages) return rows.messages;
    if (sql === SQL.tools) return rows.tools;
    throw new Error(`unexpected ${sql}`);
  });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => /^select /i.test(s)));
  assert.equal(u.modelCalls, 5);
});
