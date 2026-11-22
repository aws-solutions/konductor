import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseMoney } from '../src/currency.js';

test('formatMoney renders the configured currency', () => {
  assert.equal(formatMoney(1299, 'en-US'), '$12.99');
  assert.match(formatMoney(1299, 'de-DE'), /12,99/);
});

test('parseMoney rounds a decimal amount to cents', () => {
  assert.equal(parseMoney('12.345'), 1235);
  assert.equal(parseMoney('nope'), 0);
});
