import test from 'node:test';
import assert from 'node:assert/strict';
import { counter } from '../src/metrics/collector.ts';
import { metric, metricNames } from '../src/metrics/catalog.ts';

test('counter starts at zero', () => assert.equal(counter().read(), 0));
test('counter adds values', () => { const c = counter(); c.add(); c.add(2); assert.equal(c.read(), 3); });
test('catalog has queue age', () => assert.ok(metricNames.includes('worker_queue_age_seconds')));
test('metric keeps value', () => assert.deepEqual(metric('worker_jobs_total', 2), { name: 'worker_jobs_total', value: 2 }));
