import test from 'node:test';
import assert from 'node:assert/strict';

async function api() {
  return import('lantern-kit');
}

test('plugin lookup returns a promise for the compact plugin', async () => {
  const { loadPlugin } = await api();
  const pending = loadPlugin('compact');
  assert.equal(pending instanceof Promise, true);
  const compact = await pending;
  assert.equal(compact('  many\n  spaces '), 'many spaces');
});

test('the verbose plugin keeps the original text and appends its length', async () => {
  const { loadPlugin } = await api();
  const verbose = await loadPlugin('verbose');
  assert.equal(verbose('lamp'), 'lamp [4]');
});

test('unknown plugin names reject without loading arbitrary paths', async () => {
  const { loadPlugin } = await api();
  await assert.rejects(loadPlugin('missing'), /Unknown plugin/);
  await assert.rejects(loadPlugin('../manifest'), /Unknown plugin/);
});
