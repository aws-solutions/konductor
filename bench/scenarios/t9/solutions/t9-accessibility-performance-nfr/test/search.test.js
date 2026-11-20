import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch } from '../src/search.js';

const orders = [
  { id: 'TW-3', customer: 'José Ferreira', city: 'Porto', items: [{ name: 'Wool blanket' }] },
  { id: 'TW-2', customer: 'Owen Quinn', city: 'Cork', items: [{ name: 'Enamel kettle' }] },
  { id: 'TW-1', customer: 'Zoë Hughes', city: 'Leeds', items: [{ name: 'Enamel camp mug' }] },
];

// A timer we can step by hand. cancel() really removes the task.
function fakeTimer() {
  const tasks = [];
  return {
    tasks,
    schedule(fn, ms) {
      const task = { fn, ms, live: true };
      tasks.push(task);
      return () => { task.live = false; };
    },
    fire() {
      for (const t of tasks) {
        if (t.live) { t.live = false; t.fn(); }
      }
    },
  };
}

function setup(extra = {}) {
  const timer = fakeTimer();
  const calls = [];
  const search = createSearch({ orders, schedule: timer.schedule, onResults: (r) => calls.push(r), ...extra });
  return { timer, calls, search };
}

const ids = (list) => list.map((o) => o.id);

test('a burst of keystrokes runs the filter once, with the last text', () => {
  const { timer, calls, search } = setup();
  for (const text of ['e', 'en', 'ena', 'enam']) search.setQuery(text);
  assert.equal(calls.length, 0);
  timer.fire();
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(calls[0]), ['TW-2', 'TW-1']);
});

test('waits delayMs, and 200 by default', () => {
  const a = setup();
  a.search.setQuery('x');
  assert.equal(a.timer.tasks[0].ms, 200);
  const b = setup({ delayMs: 75 });
  b.search.setQuery('x');
  assert.equal(b.timer.tasks[0].ms, 75);
});

test('submit runs at once and nothing runs again afterwards', () => {
  const { timer, calls, search } = setup();
  search.setQuery('cork');
  search.submit();
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(calls[0]), ['TW-2']);
  timer.fire();
  assert.equal(calls.length, 1);
});

test('changing the query back cancels the pending run for the other text', () => {
  const { timer, calls, search } = setup();
  search.setQuery('cork');
  search.submit();
  search.setQuery('leeds');
  search.setQuery('cork');
  timer.fire();
  assert.ok(calls.slice(1).every((r) => ids(r).join() === 'TW-2'));
});

test('an empty or blank query returns every order', () => {
  const { calls, search } = setup();
  search.setQuery('   ');
  search.submit();
  assert.equal(calls[0].length, orders.length);
});

test('matching ignores accents and word order', () => {
  const { calls, search } = setup();
  search.setQuery('PORTO jose');
  search.submit();
  assert.deepEqual(ids(calls[0]), ['TW-3']);
});
