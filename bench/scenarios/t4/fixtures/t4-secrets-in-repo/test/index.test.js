const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/index');

test('index exposes a start function', () => assert.equal(typeof main, 'function'));
