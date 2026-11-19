import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrder } from '../src/orders/repository.js';
import { orderStore } from './helpers.js';

test('repository finds an order', () => assert.equal(findOrder(orderStore(), 'ord_test').id, 'ord_test'));
test('repository reports missing orders', () => assert.throws(() => findOrder(orderStore(), 'missing'), /not found/));
