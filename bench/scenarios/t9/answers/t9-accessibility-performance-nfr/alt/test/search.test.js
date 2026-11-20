import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch } from '../src/search.js';

const orders = [
  { id: 'A-1', customer: 'Søren Lund', city: 'Malmö', items: [{ name: 'Kettle' }] },
  { id: 'A-2', customer: 'Owen Quinn', city: 'Cork', items: [{ name: 'Kettle' }, { name: 'Mug' }] },
  { id: 'A-3', customer: 'Zoë Hughes', city: 'Leeds', items: [{ name: 'Mug' }] },
];

function manualTimer() {
  const queue = [];
  return {
    schedule: (fn, ms) => { const t = { fn, ms, on: true }; queue.push(t); return () => { t.on = false; }; },
    pending: () => queue.filter((t) => t.on).length,
    flushAll: () => queue.forEach((t) => { if (t.on) { t.on = false; t.fn(); } }),
  };
}

function build(extra) {
  const timer = manualTimer();
  const seen = [];
  const search = createSearch({ orders, schedule: timer.schedule, onResults: (r) => seen.push(r.map((o) => o.id)), ...extra });
  return { timer, seen, search };
}

test('several keystrokes make one run', () => {
  const { timer, seen, search } = build();
  ['k', 'ke', 'ket'].forEach((t) => search.setQuery(t));
  assert.equal(timer.pending(), 1);
  timer.flushAll();
  assert.deepEqual(seen, [['A-1', 'A-2']]);
});

test('submit runs now and leaves nothing waiting', () => {
  const { timer, seen, search } = build();
  search.setQuery('mug');
  search.submit();
  assert.deepEqual(seen, [['A-2', 'A-3']]);
  assert.equal(timer.pending(), 0);
});

test('accents and word order do not matter', () => {
  const { seen, search } = build();
  search.setQuery('malmo soren');
  search.submit();
  assert.deepEqual(seen, [['A-1']]);
});

test('blank text returns every order', () => {
  const { seen, search } = build();
  search.setQuery('  ');
  search.submit();
  assert.deepEqual(seen, [['A-1', 'A-2', 'A-3']]);
});
