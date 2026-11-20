import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../lib/load-plugin.js';

test('loader finds the compact plugin by name', async () => {
  const compact = await loadPlugin('compact');
  assert.equal(compact('  many   spaces '), 'many spaces');
});

test('loader rejects malformed names', async () => {
  await assert.rejects(loadPlugin('../secret'), /Unknown plugin/);
});
