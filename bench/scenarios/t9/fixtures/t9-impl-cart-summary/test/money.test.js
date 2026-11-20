import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, roundHalfAwayFromZero } from '../src/cart/money.js';

test('money formats common currencies', () => {
  assert.equal(formatMoney(12345, 'en-US', 'USD'), '$123.45');
  assert.equal(formatMoney(1234, 'ja-JP', 'JPY'), '￥1,234');
});

test('rounding is symmetric at a half', () => {
  assert.equal(roundHalfAwayFromZero(5, 2), 3);
  assert.equal(roundHalfAwayFromZero(-5, 2), -3);
});
