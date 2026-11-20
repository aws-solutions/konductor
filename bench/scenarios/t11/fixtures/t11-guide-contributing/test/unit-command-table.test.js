const test = require('node:test');
const assert = require('node:assert/strict');
const { hasCommand } = require('../src/command-table');
test('ships the generated command table', () => { assert.equal(hasCommand('check'), true); assert.equal(hasCommand('missing'), false); });
