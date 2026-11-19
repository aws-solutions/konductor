'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { isoDate } = require('../src/format');
test('date formatter keeps the date portion', () => { assert.equal(isoDate('2025-01-15T00:00:00Z'), '2025-01-15'); });
