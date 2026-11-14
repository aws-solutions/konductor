// SPDX-License-Identifier: Apache-2.0
'use strict';

// finalTextOf picks the text the judge sees from stream.jsonl, and the rule differs per runtime: kiro-cli reads the
// runFinished text, opencode the last assistant text, Claude Code the last result line's text, else the last main-session
// assistant text. Pinned per runtime so the descriptor that now selects the rule cannot change which text is judged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { finalTextOf } = require('../../judge/bundle.js');

const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

const KIRO = [
  { type: 'metadata', data: { sessionId: 's1' } },
  { type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'kiro final' } },
];
const OC_FINISHED = [
  { type: 'text', part: { text: 'opencode early' } },
  { type: 'text', part: { text: 'opencode last' } },
  { type: 'step_finish', part: { reason: 'stop' } },
];
const OC_UNFINISHED = [{ type: 'text', part: { text: 'opencode last' } }, { type: 'step_finish', part: { reason: 'tool-calls' } }];
const CC = [
  { type: 'system', subtype: 'init', model: 'claude-x' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'claude assistant text' }] } },
  { type: 'result', subtype: 'success', stop_reason: 'end_turn', total_cost_usd: 0.1, duration_ms: 10, num_turns: 1, result: 'claude result text' },
];
const CC_NO_RESULT = CC.slice(0, 2);
const CC_EMPTY_RESULT = [CC[0], CC[1], { ...CC[2], result: '' }];

function textOf(stream, result) {
  const root = tmp();
  try {
    write(path.join(root, 'stream.jsonl'), jsonl(stream));
    return finalTextOf(root, result);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('kiro-cli: the runFinished text, for a result that names it, names nothing, a legacy harness, or no result at all', () => {
  for (const result of [{ harness: 'kiro-cli' }, {}, { harness: 'none' }, { harness: 'kiro-cli-v2' }, null, undefined]) {
    assert.equal(textOf(KIRO, result), 'kiro final', JSON.stringify(result));
  }
  assert.equal(textOf([KIRO[0]], { harness: 'kiro-cli' }), null, 'no runFinished, no text');
});

test('opencode: the last assistant text, with or without a finishing step; found by harness or by runtime', () => {
  for (const result of [{ harness: 'opencode' }, { runtime: 'opencode' }]) {
    assert.equal(textOf(OC_FINISHED, result), 'opencode last');
    assert.equal(textOf(OC_UNFINISHED, result), 'opencode last');
  }
});

test('Claude Code: the result line text, an empty result stays empty, and without a result the last main-session text', () => {
  for (const result of [{ harness: 'claude-code' }, { runtime: 'claude-code' }]) {
    assert.equal(textOf(CC, result), 'claude result text');
    assert.equal(textOf(CC_EMPTY_RESULT, result), '');
    assert.equal(textOf(CC_NO_RESULT, result), 'claude assistant text');
  }
});

test('each runtime reads only its own stream shape: foreign events give no text', () => {
  assert.equal(textOf(OC_FINISHED, { harness: 'kiro-cli' }), null);
  assert.equal(textOf(CC, { harness: 'kiro-cli' }), null);
  assert.equal(textOf(KIRO, { harness: 'opencode' }), null);
  assert.equal(textOf(CC, { harness: 'opencode' }), null);
  assert.equal(textOf(KIRO, { harness: 'claude-code' }), null);
  assert.equal(textOf(OC_FINISHED, { harness: 'claude-code' }), null);
});

test('a run directory with no stream.jsonl has no final text', () => {
  const root = tmp();
  try {
    for (const harness of ['kiro-cli', 'opencode', 'claude-code']) assert.equal(finalTextOf(root, { harness }), null, harness);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every registered runtime has a final-text reader', () => {
  const { registry } = require('../lib/harness/index.js');
  for (const id of Object.keys(registry)) assert.doesNotThrow(() => textOf([{ type: 'noop' }], { harness: id }), id);
});
