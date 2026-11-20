import test from 'node:test';
import assert from 'node:assert/strict';
import { articleBySlug, articles } from '../src/content.js';

test('article catalog has stable labels and slugs', () => {
  assert.equal(articles.length, 4);
  assert.equal(articleBySlug('billing').label, 'Billing');
  assert.equal(articleBySlug('getting-started').eyebrow, 'First steps');
});

test('unknown articles return null', () => {
  assert.equal(articleBySlug('missing-page'), null);
});
