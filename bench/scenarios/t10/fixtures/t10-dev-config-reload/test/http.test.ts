import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/http/server.ts';

test('health is available', () => assert.equal(handleRequest('/health').status, 200));
test('ready is available', () => assert.equal(handleRequest('/ready').status, 200));
test('unknown route is not found', () => assert.equal(handleRequest('/missing').status, 404));
test('not found has stable code', () => assert.equal(handleRequest('/missing').body.error, 'not_found'));
