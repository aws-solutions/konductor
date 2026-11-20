'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { timing } = require('../src/diagnostics');

test('timing reports milliseconds', () => assert.deepEqual(timing(10, 25), { durationMs: 15 }));
test('timing never goes negative', () => assert.equal(timing(25, 10).durationMs, 0));
