import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPager, PAGE_SIZE } from '../src/pager.js';

test('shows at most one page at first', () => {
  const p = createPager();
  assert.equal(p.reset(1500), PAGE_SIZE);
  assert.equal(p.hasMore, true);
});

test('more adds the next page and stops at the total', () => {
  const p = createPager(50);
  p.reset(120);
  assert.deepEqual(p.more(), [50, 100]);
  assert.deepEqual(p.more(), [100, 120]);
  assert.equal(p.hasMore, false);
});

test('reset goes back to the first page', () => {
  const p = createPager(50);
  p.reset(300);
  p.more();
  p.reset(80);
  assert.equal(p.shown, 50);
  assert.equal(p.total, 80);
});

test('a short list has no more button', () => {
  const p = createPager(50);
  p.reset(7);
  assert.equal(p.shown, 7);
  assert.equal(p.hasMore, false);
});
