const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, limitMessage, isPlainObject } = require('../src/utils');

test('normalizes phone values', () => assert.equal(normalizePhone('(555) 0100'), '+5550100'));
test('limits long messages', () => assert.equal(limitMessage('abcdef', 3), 'abc'));
test('recognizes plain objects', () => assert.equal(isPlainObject({}), true));
