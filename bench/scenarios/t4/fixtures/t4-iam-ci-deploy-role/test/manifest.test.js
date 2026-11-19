'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildManifest } = require('../scripts/lib/manifest');

test('manifest includes nested public assets in stable order', () => {
  const manifest = buildManifest(path.join(__dirname, '..', 'public'));
  const keys = manifest.map((entry) => entry.key);
  assert.ok(keys.includes('index.html'));
  assert.ok(keys.includes('assets/app.css'));
  assert.deepEqual(keys, [...keys].sort());
});
