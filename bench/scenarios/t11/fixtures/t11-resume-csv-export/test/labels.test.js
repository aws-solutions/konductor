const test = require('node:test');
const assert = require('node:assert/strict');
const { tidyLabels } = require('../src/labels');

test('labels are lowercased and trimmed', () => {
  assert.deepEqual(tidyLabels([' Client ', 'internal']), ['client', 'internal']);
});
