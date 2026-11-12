// SPDX-License-Identifier: Apache-2.0
// The shared name rules (scripts/bench/lib/names.js): what may become a path segment, and what a batch name may be.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SAFE_SEGMENT,
  SEAT_NAME,
  BATCH_NAME,
} = require('../../../scripts/bench/lib/names');
const { NAME_CASES } = require('./helpers');

test('SAFE_SEGMENT accepts names that are one path segment and refuses the rest', () => {
  for (const [name, isSegment] of NAME_CASES)
    assert.equal(SAFE_SEGMENT.test(name), isSegment, JSON.stringify(name));
});

test('BATCH_NAME is lowercase letters, digits and "-", starting with a letter or digit', () => {
  for (const [name, , isBatch] of NAME_CASES)
    assert.equal(BATCH_NAME.test(name), isBatch, JSON.stringify(name));
});

test('every batch name is also a safe path segment', () => {
  for (const [name] of NAME_CASES.filter(([, , isBatch]) => isBatch))
    assert.ok(SAFE_SEGMENT.test(name), name);
});

test('SEAT_NAME is a lowercase safe path segment without ".", at most 64 characters', () => {
  for (const [name, isSegment] of NAME_CASES)
    assert.equal(
      SEAT_NAME.test(name),
      isSegment &&
        !name.includes('.') &&
        name === name.toLowerCase() &&
        name.length <= 64,
      JSON.stringify(name),
    );
});

test('SEAT_NAME refuses a seat that differs from another only in case, and a seat too long for a judgment file name', () => {
  for (const seat of ['A', 'Xai', 'xAI', 'OpenAI', 'Z9', 'a-B', 'a_B'])
    assert.equal(SEAT_NAME.test(seat), false, seat);
  for (const seat of ['a', 'xai', 'gpt-6_1', '0', 'y'.repeat(64)])
    assert.equal(SEAT_NAME.test(seat), true, seat);
  assert.equal(SEAT_NAME.test('y'.repeat(65)), false);
});
