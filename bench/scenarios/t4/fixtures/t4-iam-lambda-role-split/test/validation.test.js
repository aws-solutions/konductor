'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { required } = require('../src/validate');
test('required rejects missing values', () => { assert.throws(() => required('', 'name'), /name is required/); });
