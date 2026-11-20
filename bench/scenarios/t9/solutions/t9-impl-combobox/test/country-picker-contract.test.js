import test from 'node:test';
import assert from 'node:assert/strict';
import { countries } from '../src/countries.js';

test('picker source retains literal country labels', () => {
  assert.equal(countries.find((item) => item.code === 'AX').name, 'Aland <North>');
});
