'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { increment, snapshot } = require('../src/metrics');
test('metrics can be read', () => { increment('local-test'); assert.equal(snapshot()['local-test'] >= 1, true); });
