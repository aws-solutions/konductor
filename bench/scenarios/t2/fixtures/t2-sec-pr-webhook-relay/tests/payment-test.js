import test from 'node:test';
import assert from 'node:assert/strict';
import { receivePayment } from '../src/payments/payment-handler.js';

test('payment status is normalized', () => {
  assert.equal(receivePayment({ status: 'paid' }).paymentStatus, 'paid');
  assert.equal(receivePayment({ status: 'lost' }).paymentStatus, 'unknown');
});
