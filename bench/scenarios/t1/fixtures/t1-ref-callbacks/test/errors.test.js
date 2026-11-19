'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { optionsFor } = require('../src/config');

test('options reject an invalid concurrency', () => { assert.throws(() => optionsFor({ concurrency: 0 }), /positive integer/); });
