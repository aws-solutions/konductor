// SPDX-License-Identifier: Apache-2.0
// Tests for the OpenCode trace reader (scripts/bench/lib/opencode-trace.js), against committed captures in
// tests/fixtures/bench/opencode/. No process is started.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  normalizeToolName,
  readOpenCodeTrace,
} = require('../../../scripts/bench/lib/opencode-trace');

const FIXTURES = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'opencode',
);
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const event = (type, part, extra = {}) =>
  JSON.stringify({ type, sessionID: 'ses_x', part, ...extra });

test('happy path capture: a fused tool_use call and result, the last text is the answer, usage and cost summed', () => {
  const record = readOpenCodeTrace(fixture('happy-path.jsonl'));
  assert.equal(record.runtime, 'opencode');
  assert.equal(record.session_id, 'ses_ecda516feffeNvgcXmcrfRRoZH');
  assert.equal(record.tool_calls.length, 1);
  assert.deepEqual(
    {
      ...record.tool_calls[0],
      result: record.tool_calls[0].result.slice(0, 21),
    },
    {
      tool_name: 'read',
      raw_tool_name: 'read',
      arguments: { path: 'build/smoke/scenario-artifact.md' },
      status: 'completed',
      result: 'Read file build/smoke',
    },
  );
  assert.ok(record.tool_calls[0].result.includes('MARKER'));
  // The fence is kept: reading it is the judge-scale parser's job.
  assert.ok(record.response_text.startsWith('```json\n'));
  assert.ok(record.response_text.includes('29e7707f9f2b46c8'));
  assert.equal(record.cost_usd, 0.0047465);
  assert.deepEqual(record.usage, {
    input_tokens: 4,
    output_tokens: 59,
    cache_read_tokens: 12045,
    cache_write_tokens: 142,
  });
  assert.deepEqual(record.errors, []);
});

test('no tool calls capture: no tool_use event and no step_finish, so usage is null, not zero', () => {
  const record = readOpenCodeTrace(fixture('no-tool-calls.jsonl'));
  assert.deepEqual(record.tool_calls, []);
  assert.equal(record.response_text, 'OK');
  assert.equal(record.usage, null);
  assert.equal(record.cost_usd, null);
});

test('error capture: a type "error" event is recorded with its message, and there is no answer', () => {
  const record = readOpenCodeTrace(fixture('error.jsonl'));
  assert.equal(record.errors.length, 1);
  assert.match(record.errors[0].message, /use an inference profile ID/);
  assert.equal(record.errors[0].raw.type, 'provider.invalid-request');
  assert.equal(record.response_text, '');
  assert.deepEqual(record.tool_calls, []);
});

test('degraded capture: one tool call, usage from its single step_finish', () => {
  const record = readOpenCodeTrace(fixture('degraded.jsonl'));
  assert.equal(record.tool_calls.length, 1);
  assert.equal(
    record.response_text,
    'Only got through one of the three expected lookups.',
  );
  assert.deepEqual(record.usage, {
    input_tokens: 4,
    output_tokens: 10,
    cache_read_tokens: 100,
    cache_write_tokens: 0,
  });
  assert.equal(record.cost_usd, 0.001);
});

test('usage and cost are summed over every step_finish; reasoning tokens count as output', () => {
  const finish = (tokens, cost) =>
    event('step_finish', { type: 'step-finish', cost, tokens });
  const record = readOpenCodeTrace(
    [
      finish(
        { input: 10, output: 5, reasoning: 7, cache: { read: 1, write: 2 } },
        0.25,
      ),
      finish({ input: 1, output: 1, cache: { read: 3 } }, 0.5),
      event('text', { type: 'text', text: 'first' }),
      event('text', { type: 'text', text: 'last' }),
    ].join('\n'),
  );
  assert.deepEqual(record.usage, {
    input_tokens: 11,
    output_tokens: 13,
    cache_read_tokens: 4,
    cache_write_tokens: 2,
  });
  assert.equal(record.cost_usd, 0.75);
  assert.equal(record.response_text, 'last');
});

test('a tool_use that did not complete is an error, never a completed call', () => {
  for (const status of ['running', 'error', undefined]) {
    const record = readOpenCodeTrace(
      event('tool_use', {
        tool: 'bash',
        state: { status, input: { command: 'x' } },
      }),
    );
    assert.equal(record.tool_calls[0].status, 'error', String(status));
    assert.match(record.errors[0].message, /"bash" did not complete/);
  }
});

test('lines that are not JSON, not objects or of unknown type are skipped; bad token values count as 0', () => {
  const record = readOpenCodeTrace(
    [
      'not json',
      '42',
      'null',
      event('mystery', { text: 'x' }),
      event('step_finish', {
        cost: 'free',
        tokens: { input: -5, output: 'x', reasoning: NaN, cache: 'none' },
      }),
      event('text', { type: 'text', text: 7 }),
    ].join('\n'),
  );
  assert.deepEqual(record.usage, {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  });
  assert.equal(record.cost_usd, null);
  assert.equal(record.response_text, '');
  assert.deepEqual(record.errors, []);
});

test('an error event without a message gets a fixed one; an array of lines or empty input is accepted', () => {
  assert.equal(
    readOpenCodeTrace([JSON.stringify({ type: 'error' })]).errors[0].message,
    'opencode error event',
  );
  for (const empty of ['', null, undefined, []])
    assert.equal(readOpenCodeTrace(empty).response_text, '');
});

test('step_started: a step event says a model step began; an error-only or empty trace says none did', () => {
  for (const type of ['step_start', 'step_finish', 'text', 'tool_use'])
    assert.equal(
      readOpenCodeTrace([JSON.stringify({ type, part: {} })]).step_started,
      true,
      type,
    );
  assert.equal(
    readOpenCodeTrace([JSON.stringify({ type: 'error', error: {} })])
      .step_started,
    false,
  );
  assert.equal(readOpenCodeTrace('').step_started, false);
  assert.equal(readOpenCodeTrace('not json\n').step_started, false);
});

test('an error event with its text in error.data.message (newer OpenCode) keeps the text and the error name', () => {
  const errorEvent = (error) => [JSON.stringify({ type: 'error', error })];
  const message = (error) => readOpenCodeTrace(errorEvent(error)).errors[0];
  const nested = message({
    name: 'ProviderModelNotFoundError',
    data: { message: 'The provided model identifier is invalid.' },
  });
  assert.equal(
    nested.message,
    'ProviderModelNotFoundError: The provided model identifier is invalid.',
  );
  assert.equal(nested.raw.name, 'ProviderModelNotFoundError');
  assert.equal(
    message({ data: { message: 'no name given' } }).message,
    'no name given',
  );
  assert.equal(message({ name: 'UnknownError' }).message, 'UnknownError');
  // A top-level message still wins over the nested one.
  assert.equal(
    message({ message: 'top', name: 'X', data: { message: 'nested' } }).message,
    'top',
  );
});

test('normalizeToolName: MCP and plugin names collapse to the tool, lowercased', () => {
  assert.equal(normalizeToolName('mcp__my_server__Read_File'), 'read_file');
  assert.equal(normalizeToolName('plugin:server:tool__Sub'), 'sub');
  assert.equal(normalizeToolName('plugin:server:Tool'), 'tool');
  assert.equal(normalizeToolName('WebFetch'), 'webfetch');
  assert.equal(normalizeToolName('a__b'), 'a__b');
  assert.equal(normalizeToolName(''), '');
  assert.equal(normalizeToolName(undefined), '');
});

test('the session id is the first one in the stream; a later one or a non-string id is ignored', () => {
  const stream = (...ids) =>
    ids
      .map((sessionID) =>
        JSON.stringify({
          type: 'text',
          sessionID,
          part: { type: 'text', text: 'a' },
        }),
      )
      .join('\n');
  assert.equal(
    readOpenCodeTrace(stream('ses_one', 'ses_two')).session_id,
    'ses_one',
  );
  assert.equal(readOpenCodeTrace(stream(7, 'ses_two')).session_id, 'ses_two');
  assert.equal(readOpenCodeTrace(stream(7)).session_id, null);
});

test('finish_reason is the reason of the last step_finish; null with none, and a non-string or empty reason is ignored', () => {
  const finish = (reason) =>
    event('step_finish', { type: 'step-finish', reason, tokens: { input: 1 } });
  assert.equal(readOpenCodeTrace(finish('length')).finish_reason, 'length');
  assert.equal(
    readOpenCodeTrace([finish('tool-calls'), finish('stop')].join('\n'))
      .finish_reason,
    'stop',
    'the last one decides',
  );
  assert.equal(
    readOpenCodeTrace([finish('length'), finish(undefined)].join('\n'))
      .finish_reason,
    'length',
    'a later event with no reason does not erase it',
  );
  for (const bad of [7, null, '', {}])
    assert.equal(readOpenCodeTrace(finish(bad)).finish_reason, null);
  assert.equal(readOpenCodeTrace('').finish_reason, null);
  assert.equal(
    readOpenCodeTrace(event('text', { text: 'hello' })).finish_reason,
    null,
  );
  // The committed captures end their steps with `tool-calls`.
  assert.equal(
    readOpenCodeTrace(fixture('happy-path.jsonl')).finish_reason,
    'tool-calls',
  );
});
