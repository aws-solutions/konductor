import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/loader.ts';

test('loads file configuration', () => assert.equal(loadConfig('.').queueName, 'harbor-delivery'));
test('keeps millisecond units', () => assert.equal(loadConfig('.').jobTimeoutMs, 5000));
test('environment overrides a number', () => assert.equal(loadConfig('.', { WORKER_MAX_ATTEMPTS: '8' }).maxAttempts, 8));
test('environment overrides text', () => assert.equal(loadConfig('.', { WORKER_REGION: 'bay-2' }).region, 'bay-2'));
