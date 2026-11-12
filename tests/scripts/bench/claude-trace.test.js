// SPDX-License-Identifier: Apache-2.0
// Tests for the Claude Code trace reader (scripts/bench/lib/claude-trace.js). They read the four committed traces in
// tests/fixtures/bench/claude-code/ and small traces built here. No process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  readClaudeCodeTrace,
} = require('../../../scripts/bench/lib/claude-trace');

const FIXTURES = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'claude-code',
);
const fixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8');
const event = (value) => JSON.stringify(value);

test('happy path: init tools, paired tool calls, answer, usage and cost', () => {
  const trace = readClaudeCodeTrace(fixture('happy-path'));
  assert.equal(trace.runtime, 'claude-code');
  assert.equal(trace.session_id, 'sess_fixture_1');
  assert.equal(trace.model_id, 'claude-sonnet-5-20250514-v1:0');
  assert.deepEqual(trace.available_tools, [
    'Read',
    'Write',
    'Skill',
    'mcp__docs-server__SkillsTool',
  ]);
  assert.deepEqual(
    trace.tool_calls.map((call) => [
      call.tool_name,
      call.raw_tool_name,
      call.status,
    ]),
    [
      ['read', 'Read', 'completed'],
      ['skillstool', 'mcp__docs-server__SkillsTool', 'completed'],
    ],
  );
  assert.deepEqual(trace.tool_calls[0].arguments, { path: 'src/index.ts' });
  assert.equal(trace.tool_calls[0].result, 'export function hello() {}');
  assert.equal(
    trace.response_text,
    'The file looks fine. CRITICAL: none found.',
  );
  assert.deepEqual(trace.usage, {
    input_tokens: 512,
    output_tokens: 128,
    cache_read_tokens: 256,
    cache_write_tokens: 64,
  });
  assert.equal(trace.cost_usd, 0.0123);
  assert.equal(trace.result_seen, true);
  assert.equal(trace.result_is_error, false);
  assert.deepEqual(trace.errors, []);
  // The fixture's result event has no modelUsage.
  assert.deepEqual(trace.models_used, []);
});

test('degraded and no-tool-calls traces read like any other', () => {
  const degraded = readClaudeCodeTrace(fixture('degraded'));
  assert.deepEqual(degraded.available_tools, ['Read']);
  assert.equal(degraded.tool_calls.length, 1);
  assert.equal(degraded.tool_calls[0].status, 'completed');
  assert.equal(
    degraded.response_text,
    'I was only able to check one of the three required sources.',
  );
  const quiet = readClaudeCodeTrace(fixture('no-tool-calls'));
  assert.deepEqual(quiet.tool_calls, []);
  assert.equal(quiet.response_text, 'No tool calls needed. The answer is 42.');
  assert.equal(quiet.cost_usd, 0.0021);
});

test('error trace: a failed tool result and an error event are errors; no result, no usage', () => {
  const trace = readClaudeCodeTrace(fixture('error'));
  assert.equal(trace.tool_calls[0].status, 'error');
  assert.equal(trace.tool_calls[0].result, 'ENOENT: no such file or directory');
  assert.deepEqual(
    trace.errors.map((entry) => entry.message),
    [
      'tool_use_id toolu_err1 returned an error',
      'claude CLI exited with code 1: fatal error',
    ],
  );
  assert.equal(trace.result_seen, false);
  assert.equal(trace.usage, null);
  assert.equal(trace.cost_usd, null);
  assert.equal(trace.response_text, '');
});

test('result event: modelUsage keys, permission denials and is_error are read', () => {
  const trace = readClaudeCodeTrace(
    [
      event({ type: 'system', subtype: 'init', tools: ['Skill'] }),
      event({
        type: 'result',
        result: 'refused',
        is_error: true,
        modelUsage: { 'claude-sonnet-5-5': {}, 'other-model[1m]': {} },
        permission_denials: [{ tool_name: 'Read' }, {}, null],
      }),
    ].join('\n'),
  );
  assert.deepEqual(trace.models_used, ['claude-sonnet-5-5', 'other-model[1m]']);
  assert.deepEqual(trace.permission_denials, ['Read', '?', '?']);
  assert.equal(trace.result_is_error, true);
  assert.deepEqual(
    trace.errors.map((entry) => entry.message),
    ['refused'],
  );
});

test('without a result event the answer is the assistant text in order', () => {
  const trace = readClaudeCodeTrace([
    event({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'First. ' }] },
    }),
    event({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Second.' }] },
    }),
  ]);
  assert.equal(trace.response_text, 'First. Second.');
  assert.equal(trace.result_seen, false);
});

test('the answer is the result event only: an empty result is an empty answer, not the narration before it', () => {
  const narration = event({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Let me load the skill. ' }] },
  });
  for (const resultEvent of [
    { type: 'result', result: '' },
    { type: 'result' },
    { type: 'result', result: null },
    { type: 'result', result: 42 },
  ]) {
    const trace = readClaudeCodeTrace(
      [narration, event(resultEvent)].join('\n'),
    );
    assert.equal(trace.result_seen, true);
    assert.equal(
      trace.response_text,
      '',
      `result ${JSON.stringify(resultEvent.result)}`,
    );
  }
  // A result that holds text wins over the turns before it.
  const answered = readClaudeCodeTrace(
    [narration, event({ type: 'result', result: 'Final.' })].join('\n'),
  );
  assert.equal(answered.response_text, 'Final.');
  // Only a log with no result event falls back to the assistant text.
  const cutOff = readClaudeCodeTrace(narration);
  assert.equal(cutOff.result_seen, false);
  assert.equal(cutOff.response_text, 'Let me load the skill. ');
});

test('usage is null with no usage object, and an object of nulls when the object carries no count', () => {
  assert.equal(
    readClaudeCodeTrace(event({ type: 'result', result: 'x' })).usage,
    null,
  );
  assert.deepEqual(
    readClaudeCodeTrace(event({ type: 'result', result: 'x', usage: {} }))
      .usage,
    {
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
    },
  );
});

test('error messages: an error event gives its message, else its error text, else a fixed line; an is_error result without text too', () => {
  const messages = (...events) =>
    readClaudeCodeTrace(events.map(event).join('\n')).errors.map(
      (entry) => entry.message,
    );
  assert.deepEqual(
    messages(
      { type: 'error', message: 'm', error: 'e' },
      { type: 'error', error: 'e' },
      { type: 'error' },
    ),
    ['m', 'e', 'claude code error event'],
  );
  assert.deepEqual(messages({ type: 'result', is_error: true }), [
    'claude code reported is_error on the result event',
  ]);
});

test('no init event: available_tools is null, never an empty list', () => {
  const trace = readClaudeCodeTrace(event({ type: 'result', result: 'x' }));
  assert.equal(trace.available_tools, null);
  const empty = readClaudeCodeTrace(
    event({ type: 'system', subtype: 'init', tools: [] }),
  );
  assert.deepEqual(empty.available_tools, []);
});

test('lines that are not JSON or not objects are skipped; a result for an unknown call is ignored', () => {
  const trace = readClaudeCodeTrace(
    [
      'not json',
      '42',
      'null',
      event({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'nobody', is_error: true },
          ],
        },
      }),
      event({
        type: 'assistant',
        message: { content: [null, { type: 'tool_use', name: 'Skill' }] },
      }),
      event({
        type: 'result',
        result: 'ok',
        usage: { input_tokens: -5, output_tokens: 'many' },
      }),
    ].join('\n'),
  );
  assert.deepEqual(trace.errors, []);
  assert.equal(trace.tool_calls.length, 1);
  assert.equal(trace.tool_calls[0].status, 'unknown');
  assert.deepEqual(trace.tool_calls[0].arguments, {});
  assert.deepEqual(trace.usage, {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
  });
  assert.deepEqual(readClaudeCodeTrace(undefined).tool_calls, []);
});
