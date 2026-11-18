'use strict';

// The fixed key of the review audit: three defects the review missed, two wrong claims, two severity errors and three
// findings that are right. Each item is one test; the audit's sections are found by their headings.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readDoc, section, parseItems, assign } = require('./review-key');

const C = 'src/cart.js';
const MISSED = [
  { id: 'M1', file: C, anchor: 'c.code === code', span: 2, phrases: [/case.?(in)?sensitiv|lower ?case|upper ?case|toLowerCase/i] },
  { id: 'M2', file: C, anchor: 'Cart of ${cart.ownerName}', span: 2, phrases: [/\bxss\b|cross.site|escap|inject|html/i] },
  { id: 'M3', file: C, anchor: 'coupon.percentOff', span: 2, phrases: [/percentOff.{0,60}(100|bound|limit|negative|valid)|negative total|above 100|over 100/i] },
];
const WRONG = ['R2', 'R5'];
const RIGHT = ['R1', 'R4', 'R6'];
const MAX_UNMATCHED = 2;

const doc = () => readDoc('docs/review-audit.md');
const missedItems = () => parseItems(section(doc(), /missed/i));
const ids = (text) => new Set([...text.matchAll(/\bR(\d)\b/g)].map((m) => `R${m[1]}`));

/** The severity a correction line gives finding `id`: `R4: low -> high`, `R4 low to high`, with or without bold. */
function correctedTo(id) {
  const re = new RegExp(`\\b${id}\\b[^\\n]*?\\b(critical|high|medium|low|nit)\\b[^\\n]*?(?:->|→|=>|\\bto\\b)[^\\n]*?\\b(critical|high|medium|low|nit)\\b`, 'i');
  const m = section(doc(), /severit/i).match(re);
  return m ? m[2].toLowerCase() : null;
}

for (const m of MISSED) {
  test(`lists the missed defect ${m.id}`, () => {
    assert.ok(assign(missedItems(), MISSED).get(m.id).length > 0, m.id);
  });
}

for (const id of WRONG) {
  test(`calls ${id} wrong`, () => {
    assert.ok(ids(section(doc(), /wrong|incorrect|false/i)).has(id));
  });
}

test('does not call a correct finding wrong', () => {
  const wrong = ids(section(doc(), /wrong|incorrect|false/i));
  assert.deepEqual(RIGHT.filter((id) => wrong.has(id)), []);
  assert.ok(section(doc(), /wrong|incorrect|false/i) !== '', 'a wrong-claims section exists');
});

test('raises R4 to medium or above', () => {
  assert.ok(['medium', 'high', 'critical'].includes(correctedTo('R4')), String(correctedTo('R4')));
});

test('lowers R3 to low or nit', () => {
  assert.ok(['low', 'nit'].includes(correctedTo('R3')), String(correctedTo('R3')));
});

test('says the approval does not stand', () => {
  assert.match(doc(), /^[\s>*_#-]*verdict[\s*_]*:[^\n]*(request changes|does not stand|overturn|reject|not approve)/im);
});

test(`lists at most ${MAX_UNMATCHED} missed items that match no planted defect`, () => {
  const items = missedItems();
  assert.ok(items.length > 0, 'missed defects use the "- [severity] file:line" form under a Missed heading');
  const a = assign(items, MISSED);
  const matched = new Set(MISSED.flatMap((m) => a.get(m.id)));
  assert.ok(items.filter((f) => !matched.has(f)).length <= MAX_UNMATCHED);
});
