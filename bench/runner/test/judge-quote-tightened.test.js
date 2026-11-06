// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tightened lenient rule: a quote with 20 or more unsupported letters is refused, whichever path accepted it.
// In-process; nothing here starts bench.js or calls a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQuoteMatcher, unsupportedLetters, wordsOf, MAX_UNSUPPORTED_LETTERS, DEFAULT_QUOTE_RULE, QUOTE_RULES } = require('../../judge/quote.js');

const loose = (text) => ` ${wordsOf(text).join(' ')} `;
const letters = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;

// Invented words the output never holds, with an exact letter count.
const invented = (n) => {
  const pool = ['zqxjvkwy', 'qjzxwvk', 'xkqzjw', 'jqxzv', 'kzqx'];
  const out = [];
  let left = n;
  for (const w of pool) { if (left >= w.length) { out.push(w); left -= w.length; } }
  assert.equal(left, 0, `cannot spell ${n} letters`);
  const text = out.join(' ');
  assert.equal(letters(text), n);
  return text;
};

const A = 'the migration is additive and idempotent so the old version keeps working';
const B = 'fifty reserve requests fire at the same moment and exactly ten succeed';
const OUT_ORDERED = `Notes.\n${A}.\nMore text between them.\n${B}.\n`;

test('the default rule is lenient and strict stays selectable', () => {
  assert.equal(DEFAULT_QUOTE_RULE, 'lenient');
  assert.deepEqual(QUOTE_RULES, ['strict', 'lenient']);
  assert.equal(MAX_UNSUPPORTED_LETTERS, 20);
});

test('fragment path: 19 unsupported letters are accepted and 20 are refused', () => {
  const lenient = makeQuoteMatcher(OUT_ORDERED, { lenient: true });
  const strict = makeQuoteMatcher(OUT_ORDERED);
  // A, then 12 invented letters, then B, then the rest of the invented letters: no single stretch reaches 20.
  const quote = (n) => `${A} ${invented(12)} ${B} ${invented(n - 12)}`;
  assert.equal(lenient(quote(19)), true, '19 unsupported letters');
  assert.equal(lenient(quote(20)), false, '20 unsupported letters');
  assert.equal(strict(quote(19)), false, 'strict refuses both');
  assert.equal(unsupportedLetters(loose(OUT_ORDERED), quote(19)), 19);
  assert.equal(unsupportedLetters(loose(OUT_ORDERED), quote(20)), 20);
});

test('inner-span path: 19 unsupported letters are accepted and 20 are refused', () => {
  const S = 'the quick brown fox jumps over the lazy dog again and again today';
  const P = 'pack my box with five dozen liquor jugs';
  // P comes after S in the output, so the in-order fragment path fails for a quote that cites P first; only the quoted span can accept it.
  const out = `${S}.\nUnrelated filler words sit here.\n${P}.\n`;
  const lenient = makeQuoteMatcher(out, { lenient: true });
  const quote = (n) => `${P} "${S}" ${invented(n)}`;
  assert.equal(lenient(quote(0)), true, 'a clean quote is accepted');
  assert.equal(lenient(quote(19)), true, '19 unsupported letters');
  assert.equal(lenient(quote(20)), false, '20 unsupported letters');
  assert.equal(makeQuoteMatcher(out)(quote(0)), false, 'the strict rule refuses the same quote');
});

test('a quoted span with unsupported prose in one stretch: 19 letters accepted, 20 refused', () => {
  const S = 'the quick brown fox jumps over the lazy dog again and again today';
  const out = `${S}.\n`;
  const lenient = makeQuoteMatcher(out, { lenient: true });
  assert.equal(lenient(`"${S}" ${invented(19)}`), true);
  assert.equal(lenient(`"${S}" ${invented(20)}`), false);
  // Ordinary prose around the span counts too: "the judge says and" is not in the output as one stretch of 20 letters.
  assert.equal(lenient(`The judge says "${S}" and ${invented(19)}`), false);
});

test('words in the output count as supported only inside a stretch of 20 letters or more (the stricter reading)', () => {
  const out = `${A}. ${B}.`;
  // Each short piece below is in the output, but no stretch of 20 letters is, so every letter counts as unsupported.
  const pieces = 'migration is additive idempotent version';
  assert.equal(unsupportedLetters(loose(out), pieces), letters(pieces));
  assert.equal(unsupportedLetters(loose(out), A), 0);
});

test('operators are dropped by the lenient rule and kept by the strict rule (current behaviour, documented)', () => {
  const out = 'Inside the handler: if (qty < 0) { throw new RangeError("quantity must not be negative") } return stock';
  const same = 'if (qty > 0) { throw new RangeError("quantity must not be negative") } return stock';
  const lenient = makeQuoteMatcher(out, { lenient: true });
  assert.equal(lenient(same), true, 'qty > 0 and qty < 0 normalise to the same words, so the lenient rule cannot tell them apart');
  assert.equal(makeQuoteMatcher(out)(same), false, 'the strict rule compares the characters');
  assert.equal(makeQuoteMatcher(out)('if (qty < 0) { throw new RangeError("quantity must not be negative") } return stock'), true);
});

test('a quote the strict rule accepts is never refused by the lenient rule', () => {
  const lenient = makeQuoteMatcher(OUT_ORDERED, { lenient: true });
  for (const q of [A, B, `${A} ... ${B}`, 'Migration is additive']) assert.equal(lenient(q), true, q);
});
