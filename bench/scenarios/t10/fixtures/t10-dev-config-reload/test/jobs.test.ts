import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetry, nextDelay } from '../src/jobs/retry.ts';
import { firstDelivery, clearDeliveries } from '../src/jobs/idempotency.ts';

test('retry is below maximum', () => assert.equal(canRetry(1, 3), true));
test('maximum attempt stops retry', () => assert.equal(canRetry(3, 3), false));
test('backoff grows by attempt', () => assert.equal(nextDelay(3, 250), 500));
test('delivery id is idempotent', () => { clearDeliveries(); assert.equal(firstDelivery('x'), true); assert.equal(firstDelivery('x'), false); });
