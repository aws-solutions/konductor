// SPDX-License-Identifier: Apache-2.0
'use strict';

// The question channel of scripted-user tasks: the loader states it in the prompt of every arm alike, and one extractor
// reads the asks of every harness, a QUESTION: line counting as the same question in prose. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ASK_CHANNEL, withAskChannel, markedQuestions, questionsOf, plainProse } = require('../lib/ask-channel.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { scriptedToAutonomy, newConversation } = require('../lib/autonomy.js');
const { loadTasks } = require('../lib/tasks.js');

const BENCH = path.join(__dirname, '..', '..');
const SCRIPTED = {
  facts: [
    { id: 'budget', topics: ['budget'], answer: 'The budget is 12k a month.' },
    { id: 'deadline', topics: ['deadline'], answer: 'We launch on 3 March.' },
  ],
  defaultReply: 'No preference.',
};
const turn = (finalText, askedUser) => ({ runFinishedStatus: 'success', stopReason: 'end_turn', finalText, askedUser });

test('markedQuestions reads plain, list, numbered and bold QUESTION: lines and nothing else', () => {
  const text = [
    'I read the brief. One question: is there a budget?',
    'QUESTION: What is the budget?',
    '- QUESTION: When is the deadline',
    '2. **QUESTION:** Who signs off',
    '**QUESTION**: Which region',
    'question: lower case is prose, not the marker',
    'QUESTION:   ',
  ].join('\n');
  assert.deepEqual(markedQuestions(text), ['What is the budget?', 'When is the deadline', 'Who signs off', 'Which region']);
  assert.deepEqual(markedQuestions(null), []);
});

test('the channel text names no method or agent, does not tell the agent not to ask, and follows the prompt', () => {
  assert.doesNotMatch(ASK_CHANNEL, /konductor|skill|SOP|agent|socratic|elicit|INVEST|do(?:n't| not) ask|no (?:clarifying )?questions/i);
  assert.equal(withAskChannel('Write the doc.\n'), `Write the doc.\n\n${ASK_CHANNEL}`);
});

test('every loaded scripted task carries the channel once, and no other task does', () => {
  const tasks = loadTasks(BENCH, { extraDirs: ['t5', 't6'].map((d) => path.join(BENCH, 'scenarios', d)) });
  let scripted = 0;
  for (const t of tasks.values()) {
    const n = t.prompt.split(ASK_CHANNEL).length - 1;
    if (t.questions === 'scripted') { scripted++; assert.equal(n, 1, t.id); } else assert.equal(n, 0, t.id);
  }
  assert.ok(scripted >= 10, `scripted tasks loaded: ${scripted}`);
});

test('a QUESTION: line counts as the same question in plain prose; the marker is diagnostics only', () => {
  const marked = 'Draft started.\n\nQUESTION: What is the budget\nQUESTION: Is there a deadline\n\nI will continue after your answer.';
  const prose = 'Draft started.\n\nWhat is the budget?\nIs there a deadline?\n\nI will continue after your answer.';
  assert.equal(plainProse(marked), prose);
  const { markerLines, ...m } = questionsOf(marked);
  const { markerLines: none, ...p } = questionsOf(prose);
  assert.deepEqual(m, p);
  assert.deepEqual([markerLines, none], [2, 0]);
  const conv = newConversation(scriptedToAutonomy(SCRIPTED));
  const r = conv.record(turn(marked, false));
  assert.deepEqual(r.matched, ['budget', 'deadline']);
  const q = conv.questions[0];
  assert.deepEqual({ count: q.count, signal: q.signal, markerLines: q.markerLines, answered: q.answered }, { count: 2, signal: 'marker', markerLines: 2, answered: true });
  assert.equal(conv.askedFirstTurn, true);
});

test('a marked turn and the same turn in prose count the same question marks', () => {
  const a = questionsOf('Why? How? What?\n\nQUESTION: What is the budget?');
  const b = questionsOf('Why? How? What?\n\nWhat is the budget?');
  assert.equal(a.count, b.count);
  assert.equal(a.text, b.text);
});

test('the harness\'s own askedUser signal is not read: the final text alone decides', () => {
  const conv = newConversation(scriptedToAutonomy(SCRIPTED));
  const r = conv.record(turn('I read the brief.\n\nWhat is the budget? And the deadline?', false));
  assert.deepEqual(r.matched, ['budget', 'deadline']);
  assert.equal(conv.questions[0].signal, 'prose');
  assert.equal(conv.questions[0].count, 2);
  const done = newConversation(scriptedToAutonomy(SCRIPTED));
  assert.equal(done.record(turn('Done. I wrote the requirements.', true)), null);
  assert.equal(done.questions.length, 0);
});

// Cross-harness fixtures: each harness's contract stream with its final text replaced by the same plain-prose question
// (and by the same question with the marker). Every harness must give the scripted user the same question record.
const CONTRACT = path.join(__dirname, 'fixtures', 'harness-contract');
const FILES = { 'kiro-cli': 'kiro-cli.jsonl', 'claude-code': 'claude-code.jsonl', opencode: path.join(__dirname, '..', '..', 'plugins', 'opencode', 'test', 'fixtures', 'single-turn.jsonl'), strands: path.join(__dirname, '..', '..', 'plugins', 'strands', 'test', 'fixtures', 'single-turn.jsonl') };
function withFinalText(id, text) {
  const stream = fs.readFileSync(path.resolve(CONTRACT, FILES[id]), 'utf8');
  const old = HARNESSES[id].turnSummary(stream).finalText;
  const swap = (v) => (v === old ? text : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  return stream.split('\n').map((l) => (l.trim() ? JSON.stringify(swap(JSON.parse(l))) : l)).join('\n');
}

test('every harness gives the same question record for the same plain-prose question, with or without the marker', () => {
  assert.deepEqual(Object.keys(FILES).sort(), Object.keys(HARNESSES).sort(), 'a new harness needs a cross-harness question fixture');
  const PROSE = 'I read the brief and the current config.\n\nWhat is the budget for this, and is there a deadline?';
  const MARKED = 'I read the brief and the current config.\n\nQUESTION: What is the budget for this, and is there a deadline?';
  const records = {};
  for (const id of Object.keys(FILES)) {
    for (const [kind, text] of [['prose', PROSE], ['marked', MARKED]]) {
      const summary = HARNESSES[id].turnSummary(withFinalText(id, text));
      assert.equal(summary.finalText, text, `${id} ${kind}: fixture swap`);
      const conv = newConversation(scriptedToAutonomy(SCRIPTED));
      const r = conv.record(summary);
      assert.ok(r, `${id} ${kind}: the scripted user answers`);
      const { signal, markerLines, ...q } = conv.questions[0];
      records[`${id} ${kind}`] = q;
    }
  }
  const first = Object.values(records)[0];
  assert.equal(Object.keys(records).length, 8);
  for (const [k, q] of Object.entries(records)) assert.deepEqual(q, first, k);
  assert.deepEqual(first.matched, ['budget', 'deadline']);
});
