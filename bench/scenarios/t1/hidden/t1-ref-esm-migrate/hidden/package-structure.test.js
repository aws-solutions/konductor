import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the package declares ES module semantics', () => {
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.main, './index.js');
});

test('the exports map names the library and CLI entry points', () => {
  assert.deepEqual(packageJson.exports['.'], './index.js');
  assert.deepEqual(packageJson.exports['./cli'], './cli.js');
  assert.deepEqual(packageJson.exports['./package.json'], './package.json');
});

test('the shell entry point is an executable node script', async () => {
  const source = await readFile(new URL('../bin/lantern.js', import.meta.url), 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node/);
});
