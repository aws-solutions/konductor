// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paraphrase evidence rule: a faithful restatement of the output counts, an invented or absent point does not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQuoteMatcher, paraphraseMatch, JUDGE_QUOTE_RULES } = require('../../judge/quote.js');
const { checkRule } = require('../../judge/views.js');
const { loadScoring, quoteRuleOf } = require('../../report/scores.js');
const path = require('node:path');

const OUT = [
  '# ADR 0001: session store',
  'kv-on-demand puts 60% of 25,000 writes per second on 8 hot partitions, 1,875 WCU each, above the 1,000 WCU ceiling.',
  'We choose kv-provisioned-autoscaling at USD 6,540 per month, under the USD 7,000 budget.',
].join('\n');

test('a restatement whose figures and words are in the output is accepted', () => {
  assert.equal(paraphraseMatch(OUT, 'On-demand sends 1875 WCU to each hot partition, over the 1000 WCU ceiling'), true);
  assert.equal(paraphraseMatch(OUT, 'The chosen provisioned autoscaling option costs 6540 per month within the 7000 budget'), true);
});

test('an invented figure, an absent point or a line that does not exist fails', () => {
  assert.equal(paraphraseMatch(OUT, 'On-demand sends 2100 WCU to each hot partition, over the ceiling'), false, 'figure not in the output');
  assert.equal(paraphraseMatch(OUT, 'The record compares cross-region replication lag and failover drills in detail'), false, 'words not in the output');
  assert.equal(paraphraseMatch(OUT, 'Line 40 says the budget is 7000'), false, 'cited line past the end');
  assert.equal(paraphraseMatch(OUT, 'budget'), false, 'too short to support anything');
});

test('the matcher tries strict, then lenient, then paraphrase only when asked', () => {
  const restated = 'On-demand sends 1875 WCU to each hot partition, over the 1000 WCU ceiling';
  assert.equal(makeQuoteMatcher(OUT, { lenient: true })(restated), false);
  assert.equal(makeQuoteMatcher(OUT, { paraphrase: true })(restated), true);
  assert.equal(makeQuoteMatcher(OUT, { paraphrase: true })('We choose kv-provisioned-autoscaling at USD 6,540 per month'), true, 'a verbatim quote stays accepted');
});

test('a judge pass refuses the paraphrase rule; a scoring profile selects it', () => {
  assert.deepEqual(JUDGE_QUOTE_RULES, ['strict', 'lenient']);
  assert.throws(() => checkRule('paraphrase', '--quote-match', JUDGE_QUOTE_RULES), /takes strict or lenient/);
  assert.equal(checkRule('paraphrase'), 'paraphrase');
  assert.equal(quoteRuleOf(loadScoring(path.join(__dirname, '..', '..', 'profiles', 'scoring-paraphrase.json'))), 'paraphrase');
});
