const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../apps/dispatch/manifest');
const labeler = require('../apps/dispatch/labeler');
const header = require('../apps/dispatch/optional-header');

test('dispatch modules expose settings and derived values', () => {
  assert.deepEqual(manifest(), { timeout: 4500, deadline: 4800 });
  assert.deepEqual(labeler(), { prefix: 'D-', sample: 'D-001' });
  assert.deepEqual(header(), { header: '', wireValue: 'plain' });
});
