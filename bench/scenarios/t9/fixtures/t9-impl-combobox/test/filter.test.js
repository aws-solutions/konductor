import test from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/filter.js';

test('prefix matches come before substring matches', () => {
  const items = [{ name: 'Lima' }, { name: 'Alima Bay' }, { name: 'Limerick' }];
  assert.deepEqual(rank('lim', items).map((item) => item.name), ['Lima', 'Limerick', 'Alima Bay']);
});

test('matching ignores accents and keeps source order for ties', () => {
  const items = [{ name: 'Côte d’Ivoire' }, { name: 'Ivorian Coast' }, { name: 'Curaçao' }];
  assert.deepEqual(rank('cote', items).map((item) => item.name), ['Côte d’Ivoire']);
  assert.deepEqual(rank('o', items).map((item) => item.name), ['Côte d’Ivoire', 'Ivorian Coast', 'Curaçao']);
});

test('empty queries return no results', () => assert.deepEqual(rank('  ', [{ name: 'One' }]), []));
