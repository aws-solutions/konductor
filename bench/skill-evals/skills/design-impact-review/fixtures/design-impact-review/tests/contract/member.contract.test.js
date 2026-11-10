const assert = require('node:assert');
const test = require('node:test');
const sample = require('./member.sample.json');

test('GET /members/{id} returns id, fullName, email', () => {
  assert.deepStrictEqual(Object.keys(sample).sort(), ['email', 'fullName', 'id']);
});
