const test = require('node:test');
const assert = require('node:assert/strict');
const { memberSummary, titleCase } = require('../src/formatters.js');

test('formatters make display labels', () => {
  assert.equal(titleCase('signal workspace'), 'Signal Workspace');
  assert.equal(memberSummary(1), '1 member');
  assert.equal(memberSummary(4), '4 members');
});
