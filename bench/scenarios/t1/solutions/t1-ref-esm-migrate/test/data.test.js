import test from 'node:test';
import assert from 'node:assert/strict';
import { readBanner } from '../lib/read-banner.js';
import { manifest } from '../lib/manifest.js';

test('data files remain available to their modules', () => {
  assert.equal(readBanner(), 'Lantern Kit\n');
  assert.equal(manifest.format, 'lantern-v1');
});
