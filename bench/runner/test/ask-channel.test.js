// SPDX-License-Identifier: Apache-2.0
'use strict';

// The question channel of scripted-user tasks: the loader states it in the prompt of every arm alike, and the
// conversation counts QUESTION: lines as the asks. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ASK_CHANNEL, withAskChannel, markedQuestions } = require('../lib/ask-channel.js');
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

test('a QUESTION: turn is an ask even when the text heuristic says no; its lines are matched and counted', () => {
  const conv = newConversation(scriptedToAutonomy(SCRIPTED));
  const r = conv.record(turn('Draft started.\n\nQUESTION: What is the budget\nQUESTION: Is there a deadline\n\nI will continue after your answer.', false));
  assert.deepEqual(r.matched, ['budget', 'deadline']);
  assert.deepEqual(conv.questions[0], { turn: 1, text: 'What is the budget Is there a deadline', count: 2, signal: 'marker', matched: ['budget', 'deadline'], answered: true, reply: '1. The budget is 12k a month.\n2. We launch on 3 March.' });
  assert.equal(conv.askedFirstTurn, true);
});

test('a marked turn counts its lines, not the question marks in the rest of the text', () => {
  const conv = newConversation(scriptedToAutonomy(SCRIPTED));
  conv.record(turn('Why? How? What?\n\nQUESTION: What is the budget?', true));
  assert.equal(conv.questions[0].count, 1);
  assert.equal(conv.questions[0].text, 'What is the budget?');
});

test('without markers the heuristic still decides, so an arm that asks in prose is answered the same way, and says so', () => {
  const conv = newConversation(scriptedToAutonomy(SCRIPTED));
  const r = conv.record(turn('I read the brief.\n\nWhat is the budget? And the deadline?', true));
  assert.deepEqual(r.matched, ['budget', 'deadline']);
  assert.equal(conv.questions[0].signal, 'heuristic');
  assert.equal(conv.questions[0].count, 2);
  const done = newConversation(scriptedToAutonomy(SCRIPTED));
  assert.equal(done.record(turn('Done. I wrote the requirements.', false)), null);
  assert.equal(done.questions.length, 0);
});
