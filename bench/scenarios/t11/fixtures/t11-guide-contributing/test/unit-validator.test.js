const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, validate } = require('../src');
test('accepts a normal cue', () => { assert.deepEqual(validate(parse('12:10:05 Door opens')), []); });
test('rejects an impossible hour', () => { assert.equal(validate([{ line: 2, at: '25:00:00', text: 'late' }])[0].message, 'timestamp is outside the day'); });
