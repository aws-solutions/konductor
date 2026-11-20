import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEventDate, isWeekend } from '../src/date.js';

test('dates use a readable UTC format', () => assert.equal(formatEventDate('2025-07-18T00:00:00Z'), 'July 18, 2025'));
test('weekend helper recognizes Saturday', () => assert.equal(isWeekend('2025-07-19T00:00:00Z'), true));
