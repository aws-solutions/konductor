'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { backoff, canRetry } = require('../src/retry');
test('retry delay is bounded', () => { assert.equal(backoff(99), 30000); assert.equal(canRetry(2), true); assert.equal(canRetry(3), false); });
