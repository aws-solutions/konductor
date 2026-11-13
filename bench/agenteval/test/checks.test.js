// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkInput, checkExpectedOutput } = require('../lib/validity.js');
const { findDuplicates } = require('../lib/dedup.js');

const codes = (r) => r.reasons.map((x) => x.code);

test('placeholder and non-scenario inputs are rejected', () => {
  assert.deepEqual(codes(checkInput('string')), ['input:placeholder']);
  assert.deepEqual(codes(checkInput(' "Input" ')), ['input:placeholder']);
  assert.deepEqual(codes(checkInput('')), ['input:empty']);
  assert.deepEqual(codes(checkInput(null)), ['input:empty']);
  assert.deepEqual(codes(checkInput(42)), ['input:empty']);
  assert.deepEqual(codes(checkInput('Here are a few test cases for order status:')), ['input:chatter']);
  assert.deepEqual(codes(checkInput('Where is it?')), ['input:too-short']);
});

test('a title-like phrase is rejected, with or without a task description to compare to', () => {
  assert.deepEqual(codes(checkInput('_Customer Service Assistant')), ['input:title-like']);
  assert.deepEqual(codes(checkInput('check on my order status please and thank you everyone', { taskDescription: 'Check on my order status. Please, and thank you everyone!' })), ['input:title-like']);
  assert.equal(checkInput('Hi, can you help me with my order?').ok, true);
  assert.equal(checkInput('Where is my order').ok, true);
});

test('surrounding quotes and a leading speaker label are removed and recorded', () => {
  const cases = [
    ['Customer: I want a refund for order #ORD-1.', 'I want a refund for order #ORD-1.'],
    ['Customer message: "Hi, my order #ORD-789 never arrived"', 'Hi, my order #ORD-789 never arrived'],
    ['"Customer: Can you check my refund for order #ORD987654?"', 'Can you check my refund for order #ORD987654?'],
    ["Customer says: 'Hi, can you tell me the status of my order?'", 'Hi, can you tell me the status of my order?'],
    ['\u201CI need an emergency refund for order ORD999\u201D', 'I need an emergency refund for order ORD999'],
    ['customer: lowercase label works for my order #ORD-1', 'lowercase label works for my order #ORD-1'],
  ];
  for (const [raw, want] of cases) {
    const r = checkInput(raw);
    assert.equal(r.input, want, raw);
    assert.equal(r.normalized, true, raw);
    assert.equal(r.ok, true, raw);
    assert.equal(r.multiTurn, false, raw);
  }
});

test('an input that needs no cleanup is left alone', () => {
  const text = "I'd like a refund for my delivered order #ORD-123, it's broken.";
  const r = checkInput(text);
  assert.deepEqual(r, { ok: true, input: text, normalized: false, multiTurn: false, reasons: [] });
});

test('more than one speaker-labelled turn flags multiTurn and keeps the later turns', () => {
  const r = checkInput('Customer: My shirt is stained.\n\nCustomer: The order number is ORD-7332.\nCustomer: I want $45 back.');
  assert.equal(r.multiTurn, true);
  assert.equal(r.ok, true);
  assert.ok(r.input.startsWith('My shirt is stained.'));
  assert.ok(r.input.includes('Customer: I want $45 back.'));
  assert.equal(checkInput('Customer: Hi.\nAgent: Hello, how can I help you today?').multiTurn, true);
  assert.equal(checkInput('Customer: one turn only, with a colon: like this one').multiTurn, false);
});

test('unfilled placeholders in the expected output are flagged', () => {
  for (const out of [
    'I checked <lookup_order tool call for ORD-123> and it is fine',
    'Your order is currently [status] and was delivered [date]',
    'The $[TOTAL_AMOUNT] will be returned',
    'Refund of {order_total} issued',
    'I see ... the amount needs review',
    'string',
  ]) {
    assert.equal(checkExpectedOutput(out).placeholderOutput, true, out);
  }
  for (const out of ['Your order shipped on Tuesday.', 'Let me check...', 'Reach us at <help@example.com> any time', '', null, undefined]) {
    assert.equal(checkExpectedOutput(out).placeholderOutput, false, String(out));
  }
  assert.deepEqual(checkExpectedOutput('x [status] y').matches, ['[status]']);
});

test('near-duplicate inputs point at the first earlier case', () => {
  const dup = findDuplicates([
    'Hi, can you check the status of order #ORD12345? It was supposed to arrive yesterday.',
    'I want a refund for my damaged laptop from order ORD-99.',
    'Hi, can you check the status of order ORD12345 please? It was supposed to arrive yesterday.',
  ]);
  assert.equal(dup[0], null);
  assert.equal(dup[1], null);
  assert.equal(dup[2].of, 0);
  assert.ok(dup[2].similarity >= 0.6);
});

test('the duplicate threshold is adjustable and invalid inputs never become originals', () => {
  const a = 'please check my order status today';
  const b = 'please check my order shipping today';
  assert.equal(findDuplicates([a, b], 0.9)[1], null);
  assert.equal(findDuplicates([a, b], 0.5)[1].of, 0);
  const skipped = findDuplicates([null, '', a, a]);
  assert.deepEqual(skipped.slice(0, 3), [null, null, null]);
  assert.equal(skipped[3].of, 2);
  assert.throws(() => findDuplicates([a], 0), /threshold/);
});

test('a case that matches a duplicate also points at the original, not the duplicate', () => {
  const a = 'check order status for my package please';
  const dups = findDuplicates([a, a, a]);
  assert.deepEqual(dups.map((d) => d && d.of), [null, 0, 0]);
});
