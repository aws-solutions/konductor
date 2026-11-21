// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paraphrase-guarded evidence rule: a figure the output lacks fails on every loose path, and a copy of the rubric's
// own text fails; an honest quote or restatement still passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeQuoteMatcher, copiedFromRubric, evidenceFiguresOf, QUOTE_RULES } = require('../../judge/quote.js');
const { bundleMatcher, checkRule } = require('../../judge/views.js');
const { loadScoring, quoteRuleOf } = require('../../report/scores.js');

const OUT = [
  '# ADR 0001: session store',
  'Each primary node has 78.75 GB available after the engine reservation, and the two primary nodes together provide 157.5 GB for the working set.',
  'kv-on-demand puts 60% of 25,000 writes per second on 8 hot partitions, 1,875 WCU each, above the 1,000 WCU ceiling.',
  'We choose kv-provisioned-autoscaling at USD 6,540 per month, under the USD 7,000 budget.',
  'The 600 requests/second staging pilot figure is superseded by the production measurement and is not used anywhere in this record.',
].join('\n');

const RUBRIC = 'The ADR weighs every option. Pass: shows kv-on-demand at 1,875 WCU per hot partition against the 1,000 ceiling, and that the chosen option is under budget, and names the hot-key risk the team must watch.';

test('a changed figure inside a long quote passes the lenient rule but fails the guarded one', () => {
  const changed = 'The 679 requests/second staging pilot figure is superseded by the production measurement and is not used anywhere in this record.';
  assert.equal(makeQuoteMatcher(OUT, { lenient: true })(changed), true, 'the gap the guard closes');
  assert.equal(makeQuoteMatcher(OUT, { paraphrase: true })(changed), true, 'paraphrase inherits it');
  assert.equal(makeQuoteMatcher(OUT, { guarded: true })(changed), false);
});

test('honest quotes and restatements still pass the guarded rule', () => {
  const m = makeQuoteMatcher(OUT, { guarded: true });
  assert.equal(m('We choose kv-provisioned-autoscaling at USD 6,540 per month'), true, 'verbatim');
  assert.equal(m('kv-on-demand puts 60% of 25,000 writes ... above the 1,000 WCU ceiling'), true, 'shortened with an ellipsis');
  assert.equal(m('On-demand sends 1875 WCU to each hot partition, over the 1000 WCU ceiling'), true, 'restated, figures held');
  assert.equal(m('Each primary node has 78.75 GB ... together provide 157.5 GB.', RUBRIC), true, 'a real quote with a rubric text given');
});

test('figures are compared as the paraphrase rule compares them', () => {
  assert.deepEqual(evidenceFiguresOf('25,000 writes, 1,875.0 WCU, see line 12'), ['25000', '1875']);
  assert.equal(makeQuoteMatcher(OUT, { guarded: true })('kv-on-demand puts 60% of 25000 writes per second on 8 hot partitions, 1875 WCU each'), true);
});

test('a copy of the rubric text is refused only when the output does not hold it', () => {
  const copy = 'shows kv-on-demand at 1,875 WCU per hot partition against the 1,000 ceiling, and that the chosen option is under budget';
  assert.equal(copiedFromRubric(RUBRIC, copy), true);
  assert.equal(makeQuoteMatcher(OUT, { paraphrase: true })(copy, RUBRIC), true, 'paraphrase accepts the copy: its figures and words are in the output');
  assert.equal(makeQuoteMatcher(OUT, { guarded: true })(copy, RUBRIC), false);
  assert.equal(makeQuoteMatcher(OUT, { guarded: true })(copy), true, 'without the rubric text only the figure guard applies');
  // The output itself says it: a verbatim quote that the rubric also holds is accepted.
  const out2 = `${OUT}\nThe ADR weighs every option.`;
  assert.equal(makeQuoteMatcher(out2, { guarded: true })('The ADR weighs every option.', RUBRIC), true);
});

test('bundleMatcher hands each criterion its own rubric text', () => {
  const copy = 'shows kv-on-demand at 1,875 WCU per hot partition against the 1,000 ceiling, and that the chosen option is under budget';
  const m = bundleMatcher({ text: OUT }, { lenient: true, paraphrase: true, guarded: true, rubric: [{ id: 'reasoning', criterion: RUBRIC }, { id: 'other', criterion: 'Names the owner.' }] });
  assert.equal(m(copy, 'reasoning'), false);
  assert.equal(m(copy, 'other'), true, 'not a copy of that criterion');
});

test('the rule is report-time only, opt-in, and a profile selects it', () => {
  assert.ok(QUOTE_RULES.includes('paraphrase-guarded'));
  assert.equal(checkRule('paraphrase-guarded'), 'paraphrase-guarded');
  assert.throws(() => checkRule('paraphrase-guarded', '--quote-match', ['strict', 'lenient']), /takes strict or lenient/);
  const profiles = path.join(__dirname, '..', '..', 'profiles');
  assert.equal(quoteRuleOf(loadScoring(path.join(profiles, 'scoring-paraphrase-guarded.json'))), 'paraphrase-guarded');
  assert.notEqual(quoteRuleOf(loadScoring(path.join(profiles, 'scoring.json'))), 'paraphrase-guarded', 'the default is unchanged');
});
