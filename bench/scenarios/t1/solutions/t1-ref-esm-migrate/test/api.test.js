import test from 'node:test';
import assert from 'node:assert/strict';
import lantern from '../index.js';

test('the callable API formats a trimmed message', () => {
  assert.equal(lantern('  hello  '), '> hello');
  assert.equal(lantern.format('hello', { prefix: '#' }), '# hello');
});

test('the callable carries package metadata', () => {
  assert.equal(lantern.manifest.name, 'lantern-kit');
  assert.equal(lantern.banner, 'Lantern Kit\n');
});
