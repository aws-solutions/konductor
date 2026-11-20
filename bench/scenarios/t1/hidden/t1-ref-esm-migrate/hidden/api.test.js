import test from 'node:test';
import assert from 'node:assert/strict';

async function api() {
  return import('lantern-kit');
}

test('the package default is callable and the named formatter is public', async () => {
  const { default: lantern, format } = await api();
  assert.equal(typeof lantern, 'function');
  assert.equal(lantern('  hello  '), '> hello');
  assert.equal(format('hello', { prefix: '#', upper: true }), '# HELLO');
});

test('the default keeps the documented function properties', async () => {
  const { default: lantern, format, loadPlugin, banner, manifest } = await api();
  assert.equal(lantern.format, format);
  assert.equal(lantern.loadPlugin, loadPlugin);
  assert.equal(lantern.banner, banner);
  assert.equal(manifest.name, 'lantern-kit');
  assert.equal(lantern.manifest.format, 'lantern-v1');
});

test('the package exports the cycle result', async () => {
  const { cycleValue } = await api();
  assert.equal(cycleValue(), 'cycle-a-cycle-b');
});
