import test from 'node:test';
import assert from 'node:assert/strict';
import { countries } from '../src/countries.js';

test('country data has unique two-letter codes', () => {
  assert.ok(countries.length > 60);
  assert.equal(new Set(countries.map((country) => country.code)).size, countries.length);
  assert.ok(countries.every((country) => /^[A-Z]{2}$/.test(country.code)));
});

test('country labels include the event data needed by the page', () => {
  assert.ok(countries.some((country) => country.name === 'Côte d’Ivoire'));
  assert.ok(countries.some((country) => country.name.includes('<')));
});
