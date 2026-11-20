'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../config/service.json');
const rings = require('../ops/rings.json');
const flags = require('../ops/flag-registry.json');

test('service has UTC boundary', () => assert.equal(service.timezone, 'UTC'));
test('service port is numeric', () => assert.equal(typeof service.port, 'number'));
test('rings have names', () => assert.equal(rings.rings.every((r) => r.name), true));
test('ring order is explicit', () => assert.deepEqual(rings.rings.map((r) => r.order), [1, 2, 3, 4]));
test('flags follow registry naming', () => assert.equal(flags.flags.every((f) => f.name.startsWith('receipt.')), true));
