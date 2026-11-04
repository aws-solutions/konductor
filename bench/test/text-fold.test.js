// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the shared text fold (finding I-D)
 *
 * Run: node --test bench/test/text-fold.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { foldedText, foldedForm, isBlankText, withoutInvisible } = require('../lib/text-fold');

test('I-D: characters that print nothing fold away whatever their category', () => {
  const invisible = [
    '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad', // format characters
    '\u034f', '\ufe0f', '\ufe00', '\u0301', // combining marks and variation selectors
    '\u3164', '\u115f', '\u1160', '\uffa0', '\u17b4', // Hangul and Khmer fillers (default ignorable)
    '\u2800', // Braille blank
    '\ud800', '\udc00\u0378', // lone surrogates (not adjacent as a high and a low, which would be one letter)
    '\ue000', '\u0378', // private use, unassigned
    '\u0000', '\u0007', // controls that are not whitespace
  ];
  for (const char of invisible) {
    assert.equal(foldedForm(`rolled${char} forward`), 'rolled forward', JSON.stringify(char));
    assert.equal(isBlankText(char), true, JSON.stringify(char));
    assert.equal(isBlankText(` ${char} ${char}`), true, JSON.stringify(char));
  }
  // Joined with spaces, so that a high and a low surrogate do not meet and become one visible letter.
  assert.equal(isBlankText(invisible.join(' ')), true);
});

test('I-D: text with any visible character is not blank', () => {
  for (const text of ['a', '0', '.', '\u2014', '\u4e2d', '\ud800\udc00', '\u2603', '\u00e9', '\u043f']) {
    assert.equal(isBlankText(text), false, JSON.stringify(text));
  }
});

test('the fold keeps what earlier rounds folded: case, compatibility forms, accents, look-alikes, apostrophes, whitespace', () => {
  assert.equal(foldedForm('  Rolled\t\n  FORWARD '), 'rolled forward');
  assert.equal(foldedForm('\uff32olled forward'), 'rolled forward');
  assert.equal(foldedForm('pl\u00e1n'), 'plan');
  assert.equal(foldedForm('pl\u0430n'), 'plan');
  assert.equal(foldedForm('don\u2019t'), 'dont');
  assert.equal(foldedForm("don't"), 'dont');
  assert.equal(foldedForm('a\u00a0b\u2003c\u2028d'), 'a b c d');
});

test('the fold does not join words that were separate', () => {
  assert.equal(foldedForm('rolled forward'), 'rolled forward');
  assert.notEqual(foldedForm('rolled forward'), foldedForm('rolledforward'));
  assert.equal(foldedText('a b').includes(' '), true);
});

test('withoutInvisible keeps the letters as written and drops only what prints nothing', () => {
  assert.equal(withoutInvisible('p\u200bl\u0430n\u3164'), 'pl\u0430n');
  assert.equal(withoutInvisible('Plan'), 'Plan');
});

test('the fold is total on a string: lone surrogates, huge input and the empty string do not throw', () => {
  assert.equal(foldedForm(''), '');
  assert.equal(foldedForm('\ud800\ud800\udc00\udc00'), '\ud800\udc00');
  assert.equal(foldedForm('x'.repeat(100000)).length, 100000);
});
