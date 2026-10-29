// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQuoteMatcher, segmentsOf } = require('../../judge/quote.js');
const fixtures = require('./fixtures/ellipsis-quotes.json');

const BUNDLE = 'The handler checks the token.\n\n- **Reservation length:** REQ-3 says 7 days and REQ-6 says 5.\n- Window: one configurable value.\n\nThe queue is `FIFO` by createdAt.';
const has = (quote, text = BUNDLE) => makeQuoteMatcher(text)(quote);

test('a verbatim quote is found', () => {
  assert.equal(has('REQ-3 says 7 days and REQ-6 says 5'), true);
});

test('case, whitespace and markdown emphasis do not matter', () => {
  assert.equal(has('reservation LENGTH: req-3 says 7 days'), true);
  assert.equal(has('Reservation   length:\n REQ-3 says 7 days'), true);
  assert.equal(has('queue is FIFO by createdAt'), true);
});

test('segments around an ellipsis must appear in order, each at or after the previous one', () => {
  assert.equal(has('handler checks the token... REQ-6 says 5'), true);
  assert.equal(has('handler checks the token\u2026 REQ-6 says 5'), true);
  assert.equal(has('REQ-6 says 5 ... handler checks the token'), false);
});

test('a fabricated quote is not found, with or without an ellipsis', () => {
  assert.equal(has('The service retries the email three times'), false);
  assert.equal(has('handler checks the token... and then deletes every record'), false);
});

test('an ellipsis does not make a quote match on its trivial pieces alone', () => {
  assert.equal(has('... ...'), false);
  assert.equal(has('a... b'), false);
  assert.equal(has(''), false);
});

test('a segment may not overlap the previous one', () => {
  assert.equal(has('configurable value... configurable value'), false);
});

test('segmentsOf drops trivial fragments such as a stray bracket', () => {
  assert.deepEqual(segmentsOf('[...] REQ-3 says 7 days'), ['req-3 says 7 days']);
});

test('the 28 ellipsis quotes from the lite run', async (t) => {
  assert.equal(fixtures.length, 28);
  for (const f of fixtures) {
    await t.test(`${f.judge} ${f.armId} ${f.taskId} ${f.criterion}`, () => {
      const match = makeQuoteMatcher(f.haystack);
      assert.equal(match(f.quote), f.foundByEllipsisAwareRule);
      assert.equal(f.verbatimMatchedInOriginalRun, false, 'the old verbatim rule rejected every one of them');
      const segs = f.quote.split(/\.\.\.|\u2026/).map((s) => s.trim()).filter((s) => s.length > 8);
      if (f.foundByEllipsisAwareRule && segs.length >= 2) {
        assert.equal(match([...segs].reverse().join(' ... ')), false, 'reordered segments');
      }
      if (f.foundByEllipsisAwareRule) {
        assert.equal(match(`${segs[0]} ... an invented sentence that is nowhere in the output`), false, 'fabricated segment');
      }
    });
  }
  const found = fixtures.filter((f) => f.foundByEllipsisAwareRule).length;
  assert.equal(found, 23);
});
