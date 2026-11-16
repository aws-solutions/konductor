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
  redactTraceLog,
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

test('traceSecurityNote says so when the raw log could not be quarantined', () => {
  const [first, second] = half(SESSION_TOKEN);
  const result = sweepTrace(
    readClaudeCodeTrace(turn(first) + '\n' + turn(second)),
    { literals: LITERALS },
  );
  const note = traceSecurityNote(result, { quarantineFailed: true });
  assert.match(
    note,
    /\. The raw log could not be quarantined and is still in the run folder\. The matching text is not shown\.$/,
  );
  assert.doesNotMatch(note, /is quarantined as/);
});

// ---- redactTraceLog: the quarantined copy of a raw log -------------------------------------------------------------

const rows = (log) =>
  log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const turnTexts = (log) =>
  rows(log)
    .filter((row) => row.type === 'assistant')
    .map((row) => row.message.content[0].text);

test('redactTraceLog cuts a value printed in pieces across turns from every turn that holds a piece', () => {
  const third = Math.floor(SESSION_TOKEN.length / 3);
  const pieces = [
    SESSION_TOKEN.slice(0, third),
    SESSION_TOKEN.slice(third, 2 * third),
    SESSION_TOKEN.slice(2 * third),
  ];
  const log = [
    turn(`before ${pieces[0]}`),
    turn(pieces[1]),
    turn(`${pieces[2]} after`),
  ].join('\n');
  const copy = redactTraceLog(log, { literals: LITERALS });
  assert.deepEqual(turnTexts(copy), ['before [REDACTED]', '', ' after']);
  for (const piece of pieces) assert.ok(!copy.includes(piece));
});

test('redactTraceLog cuts a value split across the blocks of a tool result and across tool arguments', () => {
  const [first, second] = half(SECRET_KEY);
  const log = [
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
              { type: 'text', text: `x ${first}` },
              { type: 'text', text: `${second} y` },
            ],
          },
        ],
      },
    }),
  ].join('\n');
  const [use, result] = rows(redactTraceLog(log, { literals: LITERALS }));
  assert.deepEqual(use.message.content[0].input, {
    skill: 'a',
    note: ['[REDACTED]', ''],
  });
  assert.deepEqual(result.message.content[0].content, [
    { type: 'text', text: 'x [REDACTED]' },
    { type: 'text', text: ' y' },
  ]);
});

test('redactTraceLog replaces a whole value in any string, also beside a content block text, and a canary split in pieces', () => {
  const canary = newCanary();
  const [first, second] = half(canary);
  const log = [
    event({ type: 'result', result: `key ${SESSION_TOKEN}`, session_id: 's' }),
    event({
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'ok', note: `note ${SECRET_KEY}` },
          { type: 'text', text: first },
          { type: 'text', text: second },
        ],
      },
    }),
  ].join('\n');
  // As in a launch, the canary is also one of the literals.
  const copy = redactTraceLog(log, { literals: [...LITERALS, canary] });
  for (const value of [SESSION_TOKEN, SECRET_KEY, canary, first, second])
    assert.ok(!copy.includes(value));
  const [resultRow, userRow] = rows(copy);
  assert.deepEqual(resultRow, {
    type: 'result',
    result: 'key [REDACTED]',
    session_id: 's',
  });
  assert.equal(userRow.message.content[0].note, 'note [REDACTED]');
});

test('redactTraceLog cuts a canary-shaped value printed in pieces although it is not one of the literals', () => {
  const stray = newCanary();
  const [first, second] = half(stray);
  const log = [turn(`note: ${first}`), turn(second)].join('\n');
  assert.equal(
    sweepTrace(readClaudeCodeTrace(log), { literals: LITERALS }).clean,
    false,
  );
  const copy = redactTraceLog(log, { literals: LITERALS });
  assert.ok(!copy.includes(first));
  assert.ok(!copy.includes(second));
  assert.equal(
    sweepTrace(readClaudeCodeTrace(copy), { literals: LITERALS }).clean,
    true,
  );
});

test('redactTraceLog cuts all of a value that has another literal inside it', () => {
  const inner = SESSION_TOKEN.slice(4, 14);
  const [first, second] = half(SESSION_TOKEN);
  const log = [turn(first), turn(second)].join('\n');
  const copy = redactTraceLog(log, { literals: [SESSION_TOKEN, inner] });
  assert.ok(!copy.includes(SESSION_TOKEN.slice(14)));
  assert.equal(
    sweepTrace(readClaudeCodeTrace(copy), { literals: LITERALS }).clean,
    true,
  );
});

test('redactTraceLog finds a value the log wrote with JSON escapes', () => {
  const escaped = [...SESSION_TOKEN]
    .map((character) => `\\u00${character.charCodeAt(0).toString(16)}`)
    .join('');
  const line = `{"type":"result","result":"${escaped}"}`;
  assert.ok(!line.includes(SESSION_TOKEN));
  assert.deepEqual(rows(redactTraceLog(line, { literals: LITERALS })), [
    { type: 'result', result: '[REDACTED]' },
  ]);
});

test('redactTraceLog keeps what holds no value: other lines, a line that is not JSON, a blank line and the final newline', () => {
  const plain = [
    event({ type: 'system', subtype: 'init', tools: ['Skill'] }),
    'not json at all',
    '',
    turn('nothing secret here'),
  ].join('\n');
  assert.equal(
    redactTraceLog(`${plain}\n`, { literals: LITERALS }),
    `${plain}\n`,
  );
  // A line that is not JSON is the trace reader's to skip, so it is returned as it is: the caller's redactor replaces
  // a value in it, as in any text.
  assert.equal(
    redactTraceLog(`oops ${SESSION_TOKEN}`, { literals: LITERALS }),
    `oops ${SESSION_TOKEN}`,
  );
});

test('redactTraceLog leaves no value of a line that cannot be written again', () => {
  const depth = 100000;
  const deep = `${'['.repeat(depth)}"${SESSION_TOKEN}"${']'.repeat(depth)}`;
  const copy = redactTraceLog(`${deep}\n${turn('fine')}`, {
    literals: LITERALS,
  });
  assert.ok(!copy.includes(SESSION_TOKEN));
  assert.deepEqual(copy.split('\n').length, 2);
  assert.deepEqual(turnTexts(copy.split('\n')[1]), ['fine']);
});

test('redactTraceLog needs valid literals, like the file sweep', () => {
  assert.throws(
    () => redactTraceLog('{}', { literals: ['short'] }),
    /at least 8 characters/,
  );
});

test('redactTraceLog leaves a copy that sweepTrace finds clean, for each place sweepTrace joins pieces', () => {
  const [first, second] = half(SESSION_TOKEN);
  const toolUse = (input) =>
    event({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't1', name: 'Skill', input }],
      },
    });
  const toolResult = (content, extra = {}) =>
    event({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content, ...extra },
        ],
      },
    });
  const logs = {
    'answer turns with no result event': [turn(first), turn(second)],
    'init tool list': [
      event({ type: 'system', subtype: 'init', tools: [first, second] }),
    ],
    'tool arguments': [toolUse({ a: first, b: second })],
    'tool result blocks': [
      toolUse({}),
      toolResult([
        { type: 'text', text: first },
        { type: 'text', text: second },
      ]),
    ],
    'tool result error': [
      toolUse({}),
      toolResult(
        [
          { type: 'text', text: first },
          { type: 'text', text: second },
        ],
        { is_error: true },
      ),
    ],
    'permission denials': [
      event({
        type: 'result',
        result: 'done',
        permission_denials: [
          { tool_name: first, tool_use_id: 'd1', tool_input: { path: 'a' } },
          { tool_name: second, tool_use_id: 'd2', tool_input: { path: 'b' } },
          { tool_name: 7, tool_use_id: 'd3' },
          null,
          {},
        ],
      }),
    ],
  };
  for (const [name, lines] of Object.entries(logs)) {
    const log = lines.join('\n');
    const before = sweepTrace(readClaudeCodeTrace(log), {
      literals: LITERALS,
    });
    assert.equal(before.clean, false, `${name}: the log holds the value`);
    const copy = redactTraceLog(log, { literals: LITERALS });
    const after = sweepTrace(readClaudeCodeTrace(copy), {
      literals: LITERALS,
    });
    assert.equal(after.clean, true, `${name}: the copy is clean`);
    assert.ok(!copy.includes(first), name);
    assert.ok(!copy.includes(second), name);
  }
});
