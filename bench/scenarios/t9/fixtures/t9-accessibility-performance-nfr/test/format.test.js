import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, pluralize, itemSummary } from '../src/format.js';

test('formats cents with a thousands separator', () => {
  assert.equal(formatMoney(1450), '14.50');
  assert.equal(formatMoney(123456), '1,234.56');
  assert.equal(formatMoney(5), '0.05');
});

test('pluralize picks the singular only for one', () => {
  assert.equal(pluralize(1, 'item', 'items'), 'item');
  assert.equal(pluralize(0, 'item', 'items'), 'items');
});

test('itemSummary names the first item and counts the rest', () => {
  assert.equal(itemSummary([]), '');
  assert.equal(itemSummary([{ name: 'Mug' }]), 'Mug');
  assert.equal(itemSummary([{ name: 'Mug' }, { name: 'Pan' }, { name: 'Jar' }]), 'Mug + 2 more');
});
