import test from 'node:test';
import assert from 'node:assert/strict';
import lantern, { format, loadPlugin } from '../index.js';

test('the ESM entry exposes the callable default and named formatter', () => {
  assert.equal(lantern('ready'), '> ready');
  assert.equal(format('ready', { upper: true }), '> READY');
});

test('plugin loading remains asynchronous', async () => {
  assert.equal(typeof (await loadPlugin('verbose')), 'function');
});

test('the package default retains its function properties', () => {
  assert.equal(lantern.format, format);
  assert.equal(typeof lantern.loadPlugin, 'function');
});
