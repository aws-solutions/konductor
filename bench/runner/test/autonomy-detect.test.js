// SPDX-License-Identifier: Apache-2.0
'use strict';

// The ask detector, the question extractor and the per-turn merge used by the autonomy tier.

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAskedUser, extractQuestion, mergeAggregates, aggregateStream, parseStream } = require('../lib/stream.js');

const OK = { runFinishedStatus: 'success', stopReason: 'end_turn' };
const asked = (finalText, extra = {}) => detectAskedUser({ ...OK, finalText, ...extra });

test('a final paragraph that ends with a question is an ask', () => {
  assert.equal(asked('I looked at the code.\n\nShould the limit apply per user or per account?'), true);
  assert.equal(asked('Which unit do you want for the timeout (seconds or milliseconds)?**'), true);
});

test('approval requests count even without a question mark', () => {
  assert.equal(asked('The migration would delete the old column. Shall I proceed'), true);
  assert.equal(asked('I can rewrite the table. Please confirm before I continue.'), true);
});

test('a question mark inside a fenced code block is not an ask', () => {
  const text = 'Here is the fix:\n\n```js\nconst limit = user.plan ? user.plan.limit : 10;\nconst x = a ?\n```';
  assert.equal(asked(text), false);
  const unclosed = 'Done. The ternary:\n\n```js\nconst ok = ready ?';
  assert.equal(asked(unclosed), false);
});

test('a question mark inside inline code is not an ask', () => {
  assert.equal(asked('I changed the optional chain to `value?`'), false);
  assert.equal(asked('The regex now ends with `ab?`.'), false);
});

test('a real question after a code block is still an ask', () => {
  assert.equal(asked('```js\nconst a = 1;\n```\n\nIs a per-day cap what you meant?'), true);
});

test('a question followed by a list of options is an ask', () => {
  const text = 'Which source should win when the two disagree?\n\n- the CSV export\n- the API response';
  assert.equal(asked(text), true);
  const numbered = 'I need to know a few things:\n\n1. Which currency?\n2. Which rounding?';
  assert.equal(asked(numbered), true);
});

test('a lead-in that announces questions makes a trailing list an ask even when items have no question mark', () => {
  assert.equal(asked('A few questions before I start:\n\n- the unit of the timeout\n- whether old rows are kept'), true);
});

test('a plain summary list is not an ask', () => {
  assert.equal(asked('All tests pass. Changes made:\n\n- added parseLimit\n- updated the README'), false);
  assert.equal(asked('Done.\n\nAssumptions:\n- limits are per user\n- seconds are the unit'), false);
});

test('earlier rhetorical questions and polite closers are not asks', () => {
  assert.equal(asked('Why did it fail? Because of X.\n\nFixed it.'), false);
  assert.equal(asked('All tests pass. Let me know if you need more.'), false);
});

test('a stop reason other than end_turn is an ask, and no result at all is null', () => {
  assert.equal(asked('cut off', { stopReason: 'max_tokens' }), true);
  assert.equal(detectAskedUser({ runFinishedStatus: null, stopReason: null, finalText: null }), null);
  assert.equal(asked(''), false);
});

test('extractQuestion returns the asking part of the final text, without code blocks', () => {
  const text = 'I read the module.\n\nIt has two exports.\n\n```js\nfoo ? a : b\n```\n\nBefore I change it: should the limit be per user or per account? The README is silent.\n\nWhich do you prefer?';
  const q = extractQuestion({ ...OK, finalText: text });
  assert.match(q, /per user or per account/);
  assert.match(q, /Which do you prefer\?/);
  assert.doesNotMatch(q, /foo \? a/);
  assert.doesNotMatch(q, /two exports/);
});

test('extractQuestion keeps the list under the question and names the stop reason when there is no text', () => {
  const q = extractQuestion({ ...OK, finalText: 'Intro.\n\nWhich source should win?\n\n- csv\n- api' });
  assert.match(q, /Which source should win\?/);
  assert.match(q, /- api/);
  assert.match(extractQuestion({ runFinishedStatus: 'success', stopReason: 'max_tokens', finalText: '' }), /max_tokens/);
});

test('mergeAggregates sums the spend over turns and takes the outcome from the last turn', () => {
  const ev = (type, data) => JSON.stringify({ type, data });
  const turn = (credits, finalText, id) => aggregateStream(parseStream([
    ev('sessionUpdate', { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: id, _meta: { kiro: { toolName: 'subagent' } } } }),
    ev('sessionUpdate', { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: `${id}b`, _meta: { kiro: { toolName: 'shell' } } } }),
    ev('metadata', { sessionId: 's1', turnDurationMs: 100, meteringUsage: [{ value: credits, unit: 'credit' }] }),
    ev('runFinished', { sessionId: 's1', status: 'success', stopReason: 'end_turn', finalText }),
  ].join('\n')).events);
  const a = turn(1.5, 'Which unit?', 't1');
  const b = turn(2, 'All done.', 't1');
  const m = mergeAggregates([a, b]);
  assert.equal(m.credits, 3.5);
  assert.equal(m.meteringEntries, 2);
  assert.equal(m.toolCalls, 4, 'same tool call ids in two turns are two calls');
  assert.equal(m.subagentCalls, 2);
  assert.equal(m.workToolCalls, 2);
  assert.deepEqual(m.toolNames, { subagent: 2, shell: 2 });
  assert.equal(m.turnDurationMs, 200);
  assert.equal(m.finalText, 'All done.');
  assert.equal(m.askedUser, false);
  assert.deepEqual(m.sessionIds, ['s1']);
});

test('mergeAggregates keeps a killed last turn unfinished', () => {
  const a = aggregateStream(parseStream(JSON.stringify({ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'q?' } })).events);
  const b = aggregateStream([]);
  const m = mergeAggregates([a, b]);
  assert.equal(m.runFinishedStatus, null);
  assert.equal(m.turnDurationMs, null);
});
