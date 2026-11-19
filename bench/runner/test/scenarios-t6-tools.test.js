// SPDX-License-Identifier: Apache-2.0
'use strict';

// The T6 scenario tools: the shared hidden-test helper (doc-key.js), the fake scripted user, and that every task's
// hidden copy of doc-key.js is the current one. The full dry run is bench/scenarios/t6/tools/dryrun.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const T6 = path.join(__dirname, '..', '..', 'scenarios', 't6');
const key = require(path.join(T6, 'tools', 'doc-key.js'));
const { converse, unmatchedFacts } = require(path.join(T6, 'tools', 'fake-user.js'));

test('lastJsonBlock takes the last block that parses', () => {
  const doc = 'x\n```json\n{"a":1}\n```\ntext\n```json\n{"a":2}\n```\n```json\n{broken\n```\n';
  assert.deepEqual(key.lastJsonBlock(doc), { a: 2 });
  assert.equal(key.lastJsonBlock('no block'), null);
});

test('requirementTexts joins string fields except id, and keeps plain strings', () => {
  const texts = key.requirementTexts({ requirements: [{ id: 'R1', text: 'Send at 9', note: 'local time' }, 'Plain one', 7] });
  assert.deepEqual(texts, ['Send at 9 local time', 'Plain one']);
});

test('numbersIn normalises thousands and skips 0 and 1', () => {
  assert.deepEqual(key.numbersIn('2,000 orders, 1 site, 0 errors, 3.5 hours, R12'), ['2000', '3.5']);
});

test('questionCount uses count when given, else question marks, at least 1 per turn', () => {
  assert.equal(key.questionCount({ questions: [{ text: 'a? b?' }, { text: 'tell me' }, { text: 'x?', count: 4 }] }), 7);
});

const TASK = {
  id: 't6-sample',
  scriptedUser: {
    defaultReply: "I'm not sure, use your judgement.",
    facts: [
      { id: 'F1', topics: ['time ?zone', 'quiet'], answer: 'No texts before 8:00 local time.' },
      { id: 'F2', topics: ['language', 'spanish'], answer: 'Spanish and English.' },
    ],
  },
};

test('the fake user answers each fact once, by topic, and gives the default reply otherwise', () => {
  const conv = converse(TASK, ['What about time zones and quiet hours?', 'Which language? Time zones again?', 'Anything else?']);
  assert.deepEqual(conv.questions.map((q) => q.matched), [['F1'], ['F2'], []]);
  assert.equal(conv.questions[2].reply, TASK.scriptedUser.defaultReply);
  assert.deepEqual(conv.questions.map((q) => q.count), [1, 2, 1]);
  assert.deepEqual(unmatchedFacts(TASK, converse(TASK, ['Which language?'])), ['F1']);
});

test('every T6 hidden doc-key.js copy matches tools/doc-key.js', () => {
  const hidden = path.join(T6, 'hidden');
  const want = fs.readFileSync(path.join(T6, 'tools', 'doc-key.js'), 'utf8');
  const dirs = fs.existsSync(hidden) ? fs.readdirSync(hidden) : [];
  for (const d of dirs) {
    const copy = path.join(hidden, d, 'hidden', 'doc-key.js');
    if (fs.existsSync(copy)) assert.equal(fs.readFileSync(copy, 'utf8'), want, `${d} has a stale doc-key.js`);
  }
});
