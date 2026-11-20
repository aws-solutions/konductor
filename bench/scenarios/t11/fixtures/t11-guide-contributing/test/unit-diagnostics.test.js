const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnostic } = require('../src/diagnostics');
test('gives diagnostics stable codes', () => { assert.deepEqual(diagnostic(8, 'quiet'), { line: 8, message: 'quiet', code: 'W008' }); });
