const test = require('node:test');
const assert = require('node:assert/strict');
const { sectionLabel } = require('../src/labels.js');

test('known section keys have friendly labels', () => {
  assert.equal(sectionLabel('billing'), 'Billing');
  assert.equal(sectionLabel('unknown'), 'Section');
});
