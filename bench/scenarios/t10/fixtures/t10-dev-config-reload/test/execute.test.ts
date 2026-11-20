import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJob } from '../src/jobs/execute.ts';

test('execute supplies timeout', async () => { const out = await executeJob({ payload: { x: 1 } }, async (_payload, timeout) => timeout); assert.equal(out.result, 5000); });
test('execute supplies attempt limit', async () => { const out = await executeJob({ payload: {} }, async () => 'done'); assert.equal(out.attempts, 3); });
test('execute returns handler result', async () => { const out = await executeJob({ payload: {} }, async () => 'ok'); assert.equal(out.result, 'ok'); });
