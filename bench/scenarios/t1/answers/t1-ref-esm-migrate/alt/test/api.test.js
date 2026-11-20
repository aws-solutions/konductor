import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import lantern from '../index.js';
import { format, loadPlugin, readBanner, banner, manifest, cycleValue } from '../index.js';

test('the callable API formats a trimmed message', () => {
  assert.equal(lantern('  hello  '), '> hello');
  assert.equal(lantern.format('hello', { prefix: '#' }), '# hello');
  assert.equal(format('hello', { prefix: '#' }), '# hello');
});

test('the callable carries package metadata', () => {
  assert.equal(lantern.manifest.name, 'lantern-kit');
  assert.equal(lantern.banner, 'Lantern Kit\n');
  assert.equal(manifest.name, 'lantern-kit');
  assert.equal(banner, 'Lantern Kit\n');
});

test('cycleValue returns cycle-a-cycle-b', () => {
  assert.equal(cycleValue(), 'cycle-a-cycle-b');
  assert.equal(lantern.cycleValue(), 'cycle-a-cycle-b');
});

test('loadPlugin async loads compact plugin', async () => {
  const plugin = await loadPlugin('compact');
  assert.equal(plugin('  many   spaces '), 'many spaces');
});

test('loadPlugin async loads verbose plugin', async () => {
  const plugin = await loadPlugin('verbose');
  assert.equal(plugin('hello'), 'hello [5]');
});

test('loadPlugin rejects unknown plugins', async () => {
  await assert.rejects(async () => loadPlugin('nonexistent'), /Unknown plugin/);
});

test('loadPlugin rejects malformed names', async () => {
  await assert.rejects(async () => loadPlugin('../secret'), /Unknown plugin/);
});

test('format supports upper option', () => {
  assert.equal(format('hello', { upper: true }), '> HELLO');
  assert.equal(lantern('hello', { upper: true }), '> HELLO');
});

test('format supports custom prefix option', () => {
  assert.equal(format('hello', { prefix: '#' }), '# hello');
  assert.equal(lantern('hello', { prefix: '#' }), '# hello');
});
