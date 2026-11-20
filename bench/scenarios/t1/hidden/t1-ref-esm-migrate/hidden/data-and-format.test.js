import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the banner comes from the data file beside its reader', async () => {
  const { banner, readBanner } = await import('lantern-kit');
  const disk = await readFile(new URL('../lib/banner.txt', import.meta.url), 'utf8');
  assert.equal(banner, disk);
  assert.equal(readBanner(), 'Lantern Kit\n');
});

test('the JSON manifest is exposed without changing its values', async () => {
  const { manifest } = await import('lantern-kit');
  assert.deepEqual(manifest, {
    name: 'lantern-kit',
    format: 'lantern-v1',
    maintainer: 'reporting team'
  });
});

test('the package JSON is available only through its declared subpath', async () => {
  const packageData = await import('lantern-kit/package.json', { with: { type: 'json' } });
  assert.equal(packageData.default.type, 'module');
  assert.equal(packageData.default.exports['./cli'], './cli.js');
});
