import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryQueue } from '../src/queue/memory-queue.ts';
import { createPoller } from '../src/queue/poller.ts';

test('polls a bounded batch', async () => { const q = memoryQueue([{ id: 'a', payload: {}, attempt: 1 }]); assert.equal((await createPoller(q).pull()).length, 1); });
test('acknowledges ids', async () => { const q = memoryQueue(); await q.ack('a'); assert.deepEqual(q.acknowledged, ['a']); });
test('returns empty queue', async () => { assert.deepEqual(await memoryQueue().pull(2), []); });
test('poller exposes configured interval', () => assert.equal(createPoller(memoryQueue()).intervalMs, 500));
