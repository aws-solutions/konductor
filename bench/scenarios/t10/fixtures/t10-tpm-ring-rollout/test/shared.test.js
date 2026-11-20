'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUtc, minuteKey } = require('../src/shared/time');
const { minorUnit } = require('../src/currency');
const { isRegistered, enabled } = require('../src/flags');

test('time normalizes offset', () => assert.equal(parseUtc('2025-01-01T02:00:00+02:00'), '2025-01-01T00:00:00.000Z'));
test('minute key truncates seconds', () => assert.equal(minuteKey('2025-01-01T00:03:22Z'), '2025-01-01T00:03:00.000Z'));
test('dollar minor unit rounds', () => assert.equal(minorUnit(2.35), 235));
test('registered flag is known', () => assert.equal(isRegistered('receipt.renderer.v2'), true));
test('unknown flag is disabled', () => assert.equal(enabled('receipt.missing', { 'receipt.missing': true }), false));
