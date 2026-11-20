import test from 'node:test';
import assert from 'node:assert/strict';
import { countries } from '../src/countries.js';

test('alternate picker keeps the country data available', () => {
  assert.equal(countries.find((item) => item.code === 'CA').name, 'Canada');
});
