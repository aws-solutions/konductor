'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { resources, REGIONS } = require('../config/stages');
test('both configured stages have regions', () => { assert.deepEqual(Object.keys(REGIONS), ['staging', 'prod']); assert.equal(resources('prod').createOrder.table.includes(':us-west-2:'), true); });
