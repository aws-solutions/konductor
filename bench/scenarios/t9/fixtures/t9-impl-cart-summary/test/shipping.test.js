import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingAmount } from '../src/cart/shipping.js';

test('shipping uses flat rate below threshold', () => assert.equal(shippingAmount(8499, { flatMinor: 695, freeOverMinor: 8500 }), 695));
test('shipping uses zero at threshold', () => assert.equal(shippingAmount(8500, { flatMinor: 695, freeOverMinor: 8500 }), 0));
