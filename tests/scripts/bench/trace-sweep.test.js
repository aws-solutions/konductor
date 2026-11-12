// SPDX-License-Identifier: Apache-2.0
// Tests for the secret check of a trace's joined text (scripts/bench/lib/trace-sweep.js). Pure text: no process, no
// file and no model. Credentials are made-up strings.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  flatText,
  traceTexts,
  sweepTrace,
  traceSecurityNote,
} = require('../../../scripts/bench/lib/trace-sweep');
const {
  readClaudeCodeTrace,
} = require('../../../scripts/bench/lib/claude-trace');
const { newCanary } = require('../../../scripts/bench/lib/redact');

const event = (value) => JSON.stringify(value);
const SESSION_TOKEN = 'fixture-session-' + 'trace-sweep';
const SECRET_KEY = 'fixture-secret-' + 'trace-sweep';
const LITERALS = [SESSION_TOKEN, SECRET_KEY];
const half = (text) => [
  text.slice(0, text.length >> 1),
  text.slice(text.length >> 1),
];
const turn = (text) =>
  event({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });

test('flatText joins every string of a value in order, with nothing between', () => {
  assert.equal(flatText('abc'), 'abc');
  assert.equal(
    flatText([{ text: 'ab' }, 'cd', { a: ['e', { b: 'f' }] }]),
    'abcdef',
  );
  assert.equal(flatText({ n: 1, ok: true, none: null, s: 'x' }), 'x');
  // A content block counts as its text, so its type tag never sits between two pieces.
  assert.equal(
    flatText([
      { type: 'text', text: 'ab' },
      { type: 'text', text: 'cd' },
    ]),
    'abcd',
  );
  assert.equal(flatText({ type: 'image', source: { data: 'zz' } }), 'imagezz');
  assert.equal(flatText(undefined), '');
  assert.equal(flatText(null), '');
  assert.equal(flatText(7), '');
});

test('flatText walks a very deep value without overflowing the call stack', () => {
  let deep = 'bottom';
  for (let level = 0; level < 200000; level += 1) deep = [deep];
  assert.equal(flatText(deep), 'bottom');
});

test('traceTexts names each field; each call gives its arguments and result separately', () => {
  const trace = readClaudeCodeTrace(
    [
      event({
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        tools: ['Skill'],
      }),
      event({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Skill',
              input: { skill: 'x' },
            },
            { type: 'text', text: 'hello ' },
          ],
        },
      }),
      event({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'loaded' },
          ],
        },
      }),
      event({ type: 'result', result: 'final' }),
    ].join('\n'),
  );
  const byName = Object.fromEntries(
    traceTexts(trace).map(({ source, text }) => [source, text]),
  );
  assert.equal(byName['the answer text'], 'final');
  assert.equal(byName['tool_calls[0] arguments'], 'x');
  assert.equal(byName['tool_calls[0] result'], 'loaded');
  assert.equal(byName.session_id, 's1');
  assert.equal(byName.available_tools, 'Skill');
});

test('sweepTrace finds the canary and a handed-over value printed in pieces across turns', () => {
  const canary = newCanary();
  for (const [value, name] of [
    [canary, 'canary'],
    [SESSION_TOKEN, 'literal'],
  ]) {
    const [first, second] = half(value);
    const text = turn(first) + '\n' + turn(second);
    const trace = readClaudeCodeTrace(text);
    assert.ok(
      !text.includes(value),
      'no line of the log holds the value whole',
    );
    assert.equal(trace.response_text, value);
    const result = sweepTrace(trace, { literals: [...LITERALS, canary] });
    assert.equal(result.clean, false, name);
    // The canary is also one of the literals, as in a launch, so it counts under both names.
    assert.deepEqual(result.hits, [
      {
        source: 'the answer text',
        found: name === 'canary' ? { canary: 1, literal: 1 } : { literal: 1 },
      },
    ]);
  }
});

test('sweepTrace finds a value split across the blocks of a tool result, and in tool arguments', () => {
  const [first, second] = half(SECRET_KEY);
  const trace = readClaudeCodeTrace(
    [
      event({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Skill',
              input: { skill: 'a', note: [first, second] },
            },
          ],
        },
      }),
      event({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [
                { type: 'text', text: first },
                { type: 'text', text: second },
              ],
            },
          ],
        },
      }),
    ].join('\n'),
  );
  const result = sweepTrace(trace, { literals: LITERALS });
  assert.deepEqual(
    result.hits.map((hit) => hit.source),
    ['tool_calls[0] arguments', 'tool_calls[0] result'],
  );
});

test('sweepTrace finds a value the log wrote with JSON escapes for its characters', () => {
  // The CLI may escape any character of a string. The escaped log line does not contain the value, the parsed text does.
  const escaped = [...SESSION_TOKEN]
    .map((character) => `\\u00${character.charCodeAt(0).toString(16)}`)
    .join('');
  const line = `{"type":"result","result":"${escaped}"}`;
  assert.ok(!line.includes(SESSION_TOKEN));
  const result = sweepTrace(readClaudeCodeTrace(line), { literals: LITERALS });
  assert.deepEqual(result.hits, [
    { source: 'the answer text', found: { literal: 1 } },
  ]);
});

test('sweepTrace: a clean trace, secret-shaped text and a bare variable name are not hits', () => {
  const trace = readClaudeCodeTrace(
    [
      turn('Set AWS_SESSION_TOKEN before you run it.'),
      turn('A key id looks like AKIA' + 'Q3EGRAKUZ7ORH4XB.'),
      event({
        type: 'result',
        result: 'The canary is a bench-canary- prefix.',
      }),
    ].join('\n'),
  );
  const result = sweepTrace(trace, { literals: LITERALS });
  assert.equal(result.clean, true);
  assert.deepEqual(result.hits, []);
  assert.ok(result.scanned > 0);
  assert.equal(traceSecurityNote(result), '');
});

test('sweepTrace needs valid literals, like the file sweep', () => {
  assert.throws(
    () => sweepTrace(readClaudeCodeTrace(''), { literals: ['short'] }),
    /at least 8 characters/,
  );
});

test('traceSecurityNote names the fields and counts and never the value; it names the quarantined log', () => {
  const canary = newCanary();
  const [first, second] = half(canary);
  const result = sweepTrace(
    readClaudeCodeTrace(turn(first) + '\n' + turn(second)),
    { literals: LITERALS },
  );
  const note = traceSecurityNote(result, { quarantined: 'raw.jsonl~q' });
  assert.match(
    note,
    /^SECURITY STOP: .* is in text the run returned: the answer text \(canary x1\)\. The raw log is quarantined as raw\.jsonl~q\. The matching text is not shown\.$/,
  );
  assert.ok(!note.includes(canary));
  assert.ok(!note.includes(first));
  assert.doesNotMatch(traceSecurityNote(result), /quarantined/);
});
