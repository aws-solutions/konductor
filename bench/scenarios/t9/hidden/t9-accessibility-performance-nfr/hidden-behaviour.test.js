'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadSearch = async () => (await import('./src/search.js')).createSearch;

// A timer driven by hand. cancel() really removes the task; fire() runs what is left.
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
      for (const t of [...tasks]) {
        if (t.live) { t.live = false; t.fn(); }
      }
    },
    liveCount: () => tasks.filter((t) => t.live).length,
  };
}

const ids = (list) => list.map((o) => o.id);

const people = [
  { id: 'AB-100', customer: 'José Ferreira', city: 'Porto', items: [{ name: 'Wool blanket' }] },
  { id: 'AB-101', customer: 'Søren Lindqvist', city: 'Malmö', items: [{ name: 'Enamel kettle' }] },
  { id: 'AB-102', customer: 'Zoë Hughes', city: 'Leeds', items: [{ name: 'Enamel camp mug' }] },
  { id: 'AB-103', customer: 'Łukasz Nowak', city: 'Gdańsk', items: [{ name: 'Olive wood board' }, { name: 'Bread knife' }] },
  { id: 'AB-104', customer: 'Owen Quinn', city: 'Cork', items: [{ name: 'Linen tea towel' }] },
];

async function setup(orders, extra = {}) {
  const createSearch = await loadSearch();
  const timer = fakeTimer();
  const calls = [];
  const search = createSearch({ orders, schedule: timer.schedule, onResults: (r) => calls.push(r), ...extra });
  return { timer, calls, search };
}

test('a burst of keystrokes runs the filter once, after the configured delay', async () => {
  const a = await setup(people);
  for (const text of ['e', 'en', 'ena', 'enam', 'ename', 'enamel']) a.search.setQuery(text);
  assert.equal(a.calls.length, 0, 'nothing may run while the user is still typing');
  assert.ok(a.timer.tasks.every((t) => t.ms === 200), 'delayMs defaults to 200');
  assert.equal(a.timer.liveCount(), 1, 'only the last keystroke may still be waiting');
  a.timer.fire();
  assert.equal(a.calls.length, 1);
  assert.deepEqual(ids(a.calls[0]), ['AB-101', 'AB-102']);

  const b = await setup(people, { delayMs: 350 });
  b.search.setQuery('cork');
  b.search.setQuery('cork ');
  assert.ok(b.timer.tasks.every((t) => t.ms === 350), 'a custom delayMs is passed to schedule');
});

test('submit runs the filter at once and cancels the pending run', async () => {
  const { timer, calls, search } = await setup(people);
  search.setQuery('leeds');
  assert.equal(calls.length, 0);
  search.submit();
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(calls[0]), ['AB-102']);
  assert.equal(timer.liveCount(), 0, 'the pending timer must be cancelled');
  timer.fire();
  assert.equal(calls.length, 1, 'the cancelled run must not happen later');
});

test('a pending run for old text is cancelled when the query changes back', async () => {
  const { timer, calls, search } = await setup(people);
  search.setQuery('cork');
  search.submit();
  const before = calls.length;
  search.setQuery('leeds');
  search.setQuery('cork');
  assert.equal(timer.liveCount(), 1, 'the run for "leeds" must have been cancelled');
  timer.fire();
  const later = calls.slice(before);
  assert.ok(later.length <= 1);
  for (const r of later) assert.deepEqual(ids(r), ['AB-104']);
  assert.deepEqual(ids(calls[calls.length - 1]), ['AB-104']);
});

test('an empty or blank query returns every order, and replaces an earlier filter', async () => {
  const { calls, search } = await setup(people);
  search.setQuery('cork');
  search.submit();
  assert.equal(calls[0].length, 1);
  search.setQuery('');
  search.submit();
  assert.deepEqual(ids(calls[1]), ids(people));
  search.setQuery('   ');
  search.submit();
  assert.deepEqual(ids(calls[2]), ids(people));
});

test('matching reuses the shop rule: accents folded, every word needed, any order', async () => {
  const { calls, search } = await setup(people);
  const run = (q) => { search.setQuery(q); search.submit(); return ids(calls[calls.length - 1]); };
  assert.deepEqual(run('jose'), ['AB-100']);
  assert.deepEqual(run('ZOE'), ['AB-102']);
  assert.deepEqual(run('soren malmo'), ['AB-101']);
  assert.deepEqual(run('lukasz'), ['AB-103'], 'letters like ł have their own folding rule');
  assert.deepEqual(run('gdansk lukasz'), ['AB-103']);
  assert.deepEqual(run('porto ferreira'), ['AB-100']);
  assert.deepEqual(run('ab-104'), ['AB-104']);
  assert.deepEqual(run('knife board'), ['AB-103']);
  assert.deepEqual(run('enamel leeds'), ['AB-102']);
  assert.deepEqual(run('enamel cork'), []);
});
