'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let filter;
let data;
async function modules() {
  filter ||= await import('./src/filter.js');
  data ||= await import('./src/countries.js');
  return { filter, data };
}

test('ranking keeps prefix matches ahead of accented substring matches', async () => {
  const { filter } = await modules();
  const items = [{ name: 'Coast of Peru' }, { name: 'Côte d’Ivoire' }, { name: 'A Côte Memory' }];
  assert.deepEqual(filter.rank('cote', items).map((item) => item.name), ['Côte d’Ivoire', 'A Côte Memory']);
});

test('ranking does not mutate its source and treats blank input as empty', async () => {
  const { filter } = await modules();
  const items = [{ name: 'Beta' }, { name: 'Alpha' }];
  const original = items.slice();
  assert.deepEqual(filter.rank('a', items), [{ name: 'Alpha' }, { name: 'Beta' }]);
  assert.deepEqual(items, original);
  assert.deepEqual(filter.rank('   ', items), []);
});

test('country records have stable codes and include a literal angle-bracket label', async () => {
  const { data } = await modules();
  assert.ok(data.countries.length > 60);
  assert.equal(new Set(data.countries.map((country) => country.code)).size, data.countries.length);
  assert.equal(data.countries.find((country) => country.code === 'AX').name, 'Aland <North>');
});

test('country data preserves accent-bearing names for search results', async () => {
  const { data } = await modules();
  assert.equal(data.countries.find((country) => country.code === 'RE').name, 'Réunion');
  assert.equal(data.countries.find((country) => country.code === 'CW').name, 'Curaçao');
});
