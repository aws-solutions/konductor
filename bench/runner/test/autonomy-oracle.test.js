// SPDX-License-Identifier: Apache-2.0
'use strict';

// The scripted user: matching a question to clarifications, defaults, repeats and the interjection cap.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOracle, normalizeAutonomy, CAP_MESSAGE, assumptionsStated, clip } = require('../lib/autonomy.js');

const AUTONOMY = {
  clarifications: [
    { id: 'unit', topic: 'timeout unit', keywords: ['\\bseconds?\\b', 'milliseconds?', 'unit'], answer: 'Seconds.' },
    { id: 'scope', topic: 'limit scope', keywords: ['per (user|account)', 'scope'], answer: 'Per account.' },
    { id: 'order', topic: 'sort order', keywords: ['sort(ed|ing)?', 'order'], answer: 'Newest first.' },
  ],
};
const oracle = (over = {}) => createOracle(normalizeAutonomy({ ...AUTONOMY, ...over }));

test('defaults are applied to an autonomy block', () => {
  const a = normalizeAutonomy({ clarifications: [] });
  assert.equal(a.maxInterjections, 4);
  assert.equal(a.defaultAnswer, 'Use your best judgment and continue.');
  assert.equal(a.noQuestionNeeded, false);
});

test('one matching clarification gives its answer alone', () => {
  const r = oracle().reply('Should the timeout be in seconds or milliseconds?');
  assert.equal(r.text, 'Seconds.');
  assert.deepEqual(r.matched, ['unit']);
  assert.equal(r.kind, 'clarification');
  assert.equal(r.counted, true);
});

test('matching is case-insensitive over regular expressions', () => {
  assert.deepEqual(oracle().reply('PER ACCOUNT or per USER?').matched, ['scope']);
});

test('several matches in one question give one numbered reply in clarification order', () => {
  const r = oracle().reply('What order do you want, and is the limit per user or per account?');
  assert.deepEqual(r.matched, ['scope', 'order']);
  assert.equal(r.text, '1. Per account.\n2. Newest first.');
});

test('a question that matches nothing gets the default answer and counts as unmatched', () => {
  const r = oracle().reply('Do you want a changelog entry?');
  assert.equal(r.text, 'Use your best judgment and continue.');
  assert.deepEqual(r.matched, []);
  assert.equal(r.kind, 'default');
  assert.equal(r.unmatched, true);
  assert.equal(r.counted, true);
});

test('a repeated question gets the default answer because its clarification was already used', () => {
  const o = oracle();
  assert.deepEqual(o.reply('seconds or milliseconds?').matched, ['unit']);
  const again = o.reply('Sorry, seconds or milliseconds?');
  assert.equal(again.unmatched, true);
  assert.equal(again.text, 'Use your best judgment and continue.');
});

test('the cap sends the proceed message once, flags the cap and then stops answering', () => {
  const o = oracle({ maxInterjections: 2 });
  assert.equal(o.reply('unit?').counted, true);
  assert.equal(o.reply('scope?').counted, true);
  assert.equal(o.state.interjections, 2);
  const cap = o.reply('order?');
  assert.equal(cap.text, CAP_MESSAGE);
  assert.equal(cap.kind, 'cap');
  assert.equal(cap.counted, false);
  assert.equal(o.state.interjections, 2, 'the proceed message is not an interjection');
  assert.equal(o.state.capHit, true);
  assert.equal(o.reply('anything else?'), null, 'no further reply after the proceed message');
});

test('the cap message text is fixed', () => {
  assert.equal(CAP_MESSAGE, 'Proceed with your best judgment now and do not ask further questions.');
});

test('a task with no clarifications answers every question with the default', () => {
  const o = createOracle(normalizeAutonomy({ clarifications: [], noQuestionNeeded: true }));
  const r = o.reply('Which unit?');
  assert.equal(r.unmatched, true);
});

test('an invalid keyword pattern is skipped rather than crashing the run', () => {
  const o = createOracle(normalizeAutonomy({ clarifications: [{ id: 'x', topic: 't', keywords: ['(', 'ok'], answer: 'A' }] }));
  assert.deepEqual(o.reply('is it ok?').matched, ['x']);
});

test('a reply never starts with a dash, which the agent CLI would read as an option', () => {
  const o = createOracle(normalizeAutonomy({ clarifications: [{ id: 'x', topic: 't', keywords: ['dash'], answer: '--force it' }], defaultAnswer: '- go on' }));
  assert.equal(o.reply('dash?').text, 'Answer: --force it');
  assert.equal(o.reply('another?').text, 'Answer: - go on');
});

test('clip shortens to the limit with an ellipsis marker', () => {
  assert.equal(clip('abc', 10), 'abc');
  assert.equal(clip('x'.repeat(400), 300).length, 300);
});

test('assumptionsStated reads the final text of the last turn', () => {
  assert.equal(assumptionsStated('Done.\n\nAssumptions:\n- seconds are the unit'), true);
  assert.equal(assumptionsStated('I assumed limits are per account.'), true);
  assert.equal(assumptionsStated('I went with seconds because the README uses them.'), true);
  assert.equal(assumptionsStated('All tests pass.'), false);
  assert.equal(assumptionsStated(null), false);
});
