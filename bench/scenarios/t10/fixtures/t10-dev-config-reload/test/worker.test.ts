import test from 'node:test';
import assert from 'node:assert/strict';
import { leaseFor, leaseExpired } from '../src/worker/lease.ts';
import { mapPool } from '../src/worker/pool.ts';
import { workerSettings } from '../src/worker/runner.ts';

test('lease uses seconds as milliseconds', () => assert.equal(leaseFor('a', 1000, 30).expiresAt, 31000));
test('lease remains valid before expiry', () => assert.equal(leaseExpired(leaseFor('a', 0, 2), 1999), false));
test('lease expires at boundary', () => assert.equal(leaseExpired(leaseFor('a', 0, 2), 2000), true));
test('pool preserves input order', async () => assert.deepEqual(await mapPool([1, 2, 3], 2, async (x) => x * 2), [2, 4, 6]));
test('worker settings match bundle', () => assert.deepEqual(workerSettings(), { workerConcurrency: 4, maxAttempts: 3 }));
