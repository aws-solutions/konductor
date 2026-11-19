'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeManifest } = require('../src/manifest');

test('manifest keeps object order and count', () => {
  const manifest = makeManifest('2025-02-03', 4, ['a', 'b']);
  assert.deepEqual(manifest, {
    format: 'ledger-export-v2',
    date: '2025-02-03',
    recordCount: 4,
    objects: ['a', 'b']
  });
});
