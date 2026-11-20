import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { loadPlugin } from '../lib/load-plugin.js';

test('loader finds the compact plugin by name', async () => {
  const plugin = await loadPlugin('compact');
  assert.equal(plugin('  many   spaces '), 'many spaces');
});

test('loader finds the verbose plugin by name', async () => {
  const plugin = await loadPlugin('verbose');
  assert.equal(plugin('hello'), 'hello [5]');
});

test('loader rejects malformed names', async () => {
  await assert.rejects(async () => loadPlugin('../secret'), /Unknown plugin/);
});

test('loader rejects unknown plugins', async () => {
  await assert.rejects(async () => loadPlugin('nonexistent'), /Unknown plugin/);
});
