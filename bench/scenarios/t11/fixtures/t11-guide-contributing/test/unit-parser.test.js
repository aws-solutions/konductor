const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../src/parser');
test('parses a labeled cue', () => { assert.deepEqual(parse('00:01:02 Welcome | amber'), [{ line: 1, at: '00:01:02', text: 'Welcome', label: 'amber' }]); });
test('reports malformed lines', () => { assert.equal(parse('not a cue')[0].error, 'expected timestamp and text'); });
