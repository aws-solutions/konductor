'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { root, publicDir, apiDir } = require('../scripts/lib/paths');

test('shared paths stay inside the repository', () => {
  assert.ok(publicDir.startsWith(root));
  assert.ok(apiDir.startsWith(root));
  assert.ok(publicDir.endsWith('/public'));
  assert.ok(apiDir.endsWith('/api'));
});
