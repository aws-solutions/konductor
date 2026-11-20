import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSubtotal, calculateTax, formatMoney } from '../src/cart/totals.js';

test('subtotal multiplies each price by quantity', () => assert.equal(calculateSubtotal([{ price: '4.50', quantity: 2 }]), 9));
test('tax uses the supplied rate', () => assert.equal(calculateTax(100, .1), 10));
test('money uses currency formatting', () => assert.equal(formatMoney(12.5), '$12.50'));
