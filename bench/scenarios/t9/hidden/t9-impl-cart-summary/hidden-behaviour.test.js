import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartView } from './src/cart/view.js';

const cart = (...amounts) => ({ items: amounts.map((unitAmount, index) => ({ id: `item-${index}`, name: `Item ${index}`, quantity: 1, unitAmount })) });
const plain = (amounts, extra = {}) => buildCartView(cart(...amounts), { taxRate: 0, ...extra });

test('the summary keeps lines, totals, and a data-only progress record', () => {
  const view = plain([1200, 800]);
  assert.equal(view.subtotal.minor, 2000);
  assert.equal(view.total.minor, 2695);
  assert.equal(view.items[0].lineTotal.minor, 1200);
  assert.deepEqual(Object.getPrototypeOf(view.freeShippingProgress), Object.prototype);
  assert.equal(typeof view.freeShippingProgress.remainingMinor, 'number');
  assert.equal(view.freeShippingProgress.includes, undefined);
});

test('a percentage discount rounds once on the whole subtotal', () => {
  const view = plain([501, 509], { promoCode: 'SAVE15' });
  assert.equal(view.subtotal.minor, 1010);
  assert.equal(view.discount.minor, 152);
  assert.equal(view.total.minor, 1553);
});

test('a fixed discount cannot make the merchandise subtotal negative', () => {
  const view = plain([500], { promoCode: 'TAKE750' });
  assert.equal(view.discount.minor, 500);
  assert.equal(view.subtotal.minor, 500);
  assert.equal(view.total.minor, 695);
});

test('promo input ignores surrounding whitespace and case', () => {
  const view = plain([4000], { promoCode: '  take750  ' });
  assert.equal(view.promoCodeRow.code, 'TAKE750');
  assert.equal(view.promoCodeRow.applied, true);
  assert.equal(view.discount.minor, 750);
});

test('an unknown code reports an error without changing cart pricing', () => {
  const baseline = plain([4000]);
  const invalid = plain([4000], { promoCode: 'NO-SUCH-CODE' });
  assert.equal(invalid.promoCodeRow.applied, false);
  assert.match(invalid.promoCodeRow.message, /not available/i);
  assert.equal(invalid.subtotal.minor, baseline.subtotal.minor);
  assert.equal(invalid.shipping.amount.minor, baseline.shipping.amount.minor);
  assert.equal(invalid.total.minor, baseline.total.minor);
});

test('the expiry date is valid through the shop day and expires at its boundary', () => {
  const beforeClose = plain([2000], { promoCode: 'SAVE15', now: '2027-08-15T23:59:59Z', shopTimeZone: 'America/Los_Angeles' });
  const afterClose = plain([2000], { promoCode: 'SAVE15', now: '2027-08-16T07:00:01Z', shopTimeZone: 'America/Los_Angeles' });
  assert.equal(beforeClose.promoCodeRow.applied, true);
  assert.equal(afterClose.promoCodeRow.applied, false);
  assert.equal(afterClose.discount.minor, 0);
});

test('an expired code explains why it was rejected', () => {
  const view = plain([2000], { promoCode: 'SAVE15', now: '2027-08-16T12:00:00Z', shopTimeZone: 'UTC' });
  assert.match(view.promoCodeRow.message, /expired/i);
});

test('free-delivery progress uses the subtotal after a merchandise discount', () => {
  const view = plain([9000], { promoCode: 'SAVE15' });
  assert.equal(view.discount.minor, 1350);
  assert.equal(view.freeShippingProgress.qualifyingSubtotalMinor, 7650);
  assert.equal(view.freeShippingProgress.thresholdMinor, 8500);
  assert.equal(view.freeShippingProgress.remainingMinor, 850);
  assert.equal(view.shipping.amount.minor, 695);
});

test('the free-shipping promotion waives delivery directly', () => {
  const view = plain([6000], { promoCode: 'SHIPDAY' });
  assert.equal(view.promoCodeRow.applied, true);
  assert.equal(view.discount.minor, 0);
  assert.equal(view.shipping.amount.minor, 0);
  assert.equal(view.freeShippingProgress.reached, false);
});

test('progress reports a reached threshold with no remaining spend', () => {
  const view = plain([8500]);
  assert.equal(view.freeShippingProgress.remainingMinor, 0);
  assert.equal(view.freeShippingProgress.reached, true);
  assert.equal(view.freeShippingProgress.percentage, 100);
  assert.match(view.freeShippingProgress.message, /unlocked/i);
});

test('a zero-decimal currency has no fabricated fractional digits', () => {
  const view = buildCartView(cart(1234), { locale: 'ja-JP', currency: 'JPY', taxRate: 0 });
  assert.match(view.subtotal.formatted, /1,234/);
  assert.doesNotMatch(view.subtotal.formatted, /\.\d/);
});

test('a three-decimal currency preserves three fractional digits', () => {
  const view = buildCartView(cart(1234), { locale: 'en-US', currency: 'KWD', taxRate: 0 });
  assert.match(view.subtotal.formatted, /1\.234/);
});

test('empty and very long promo input stays a harmless invalid row', () => {
  const empty = plain([2000], { promoCode: '' });
  const long = plain([2000], { promoCode: 'x'.repeat(5000) });
  assert.equal(empty.promoCodeRow.status, 'none');
  assert.equal(long.promoCodeRow.applied, false);
  assert.match(long.promoCodeRow.message, /not available/i);
  assert.equal(long.total.minor, empty.total.minor);
});

test('a second view does not retain a prior promotion', () => {
  const applied = plain([4000], { promoCode: 'TAKE750' });
  const cleared = plain([4000], { promoCode: 'wrong' });
  assert.equal(applied.discount.minor, 750);
  assert.equal(cleared.discount.minor, 0);
  assert.equal(cleared.promoCodeRow.status, 'invalid');
  assert.equal(cleared.total.minor, 4695);
});

test('progress and totals respond to the actual cart amount', () => {
  const small = plain([1000]);
  const large = plain([7000]);
  assert.notEqual(small.subtotal.minor, large.subtotal.minor);
  assert.ok(large.freeShippingProgress.remainingMinor < small.freeShippingProgress.remainingMinor);
  assert.notEqual(large.total.formatted, small.total.formatted);
});
